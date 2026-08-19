import type { RunRow, CaseRoadmapRow, CaseFeatureRow, CaseRunEventRow } from "../db/repository.js";
import type { RoadmapApprovalPayload, RoadmapReleaseEntry } from "../cli/escalation.js";

/**
 * FEATURE-045: proyección jerárquica y semántica de Casos de Negocio. Función pura (sin acceso a
 * DB) para que la clasificación sea determinística y testeable sin fixtures de Postgres -- el
 * repositorio (`src/db/repository.ts`) solo trae candidatos ya filtrados por proyecto+owner; toda
 * la lógica de pertenencia/herencia vive acá, siguiendo el mismo principio que
 * `resolveReleasePlanForActiveRelease` (función pura separada de su query en `runStart.ts`).
 */

export type CaseRunKind = "run" | "reentry";

export interface CaseTreeRun {
  id: string;
  status: string;
  currentPhase: string | null;
  createdAt: string;
  kind: CaseRunKind;
  children: CaseTreeRun[];
}

export interface CaseTreeFeature {
  id: string;
  featureCode: string;
  name: string;
  runs: CaseTreeRun[];
}

export interface CaseTreeRelease {
  id: string;
  nombre: string;
  estado: string;
  alcanceResumen: string;
  features: CaseTreeFeature[];
  runs: CaseTreeRun[];
}

export interface CaseTree {
  caseKey: string;
  displayName: string;
  createdAt: string;
  releases: CaseTreeRelease[];
  runs: CaseTreeRun[];
}

function caseKeyOf(run: RunRow): string {
  return run.root_run_id ?? run.id;
}

function shortCaseLabel(caseKey: string): string {
  return `Caso ${caseKey.slice(0, 8)}`;
}

function isRoadmapPayload(value: unknown): value is RoadmapApprovalPayload {
  const candidate = value as { releases?: unknown } | null;
  return !!candidate && Array.isArray(candidate.releases);
}

/**
 * Regla 9/10/11: un Run es Reingreso solo con evidencia estructural (`event_type` + campos
 * discretos del payload), nunca texto de summary/artifact.
 *
 * - Camino automático (`createArchitectReentryChildRun`, runStart.ts): el padre tiene
 *   `escalation_cross_pipeline_reentry_prepared` -- exclusivo de ese camino, nunca lo escribe un
 *   Approval Gate.
 * - Camino manual (`respondEscalation`, respondService.ts): TODO child creado por esa función
 *   escribe `escalation_retry_context_prepared` en sí mismo, sin importar si el humano aprobó un
 *   Gate (Roadmap/cierre de Release, Regla 10/12) o resolvió una escalación real (Regla 9) -- ambos
 *   casos son estructuralmente idénticos en ese evento. La única señal que distingue ambos casos es
 *   `escalation_gate_recognized` en el padre, escrito ANTES de que el humano responda
 *   (`classifyGateEscalation`, runStart.ts:630), correlacionado por `artifactId`
 *   (`escalation_gate_recognized.payload.artifactId` === el `parentArtifactId` que el child guardó).
 *   Si esa correlación existe, la respuesta cerró un Gate -> continuación normal, no Reingreso.
 */
export function classifyRunKind(params: {
  run: RunRow;
  parentEvents: CaseRunEventRow[];
  ownEvents: CaseRunEventRow[];
}): CaseRunKind {
  if (!params.run.originated_from_run_id) return "run";

  const parentHadAutoReentry = params.parentEvents.some(
    (event) => event.eventType === "escalation_cross_pipeline_reentry_prepared"
  );
  if (parentHadAutoReentry) return "reentry";

  const ownRetryContext = params.ownEvents.find((event) => event.eventType === "escalation_retry_context_prepared");
  if (!ownRetryContext) return "run";

  const parentArtifactId = (ownRetryContext.payload as { parentArtifactId?: unknown } | null)?.parentArtifactId;
  const parentClosedAsGate = params.parentEvents.some(
    (event) =>
      event.eventType === "escalation_gate_recognized" &&
      (event.payload as { artifactId?: unknown } | null)?.artifactId === parentArtifactId
  );
  return parentClosedAsGate ? "run" : "reentry";
}

interface RunResolution {
  featureId: string | null;
  releaseId: string | null;
}

/**
 * Paso 6, P1-P4: resuelve Feature/Release de cada Run del Caso, en orden de creación (padres antes
 * que hijos) para que la herencia (P2) pueda apoyarse en la resolución ya calculada del padre.
 * Regla 7: la cadena de herencia nunca cruza `caseKey` -- ya garantizado acá porque `runsInCase`
 * solo contiene runs del mismo Caso; un `originated_from_run_id` que apunte fuera de ese conjunto
 * (Escenario 13, estado anómalo) simplemente no encuentra padre y no hereda nada.
 */
function resolveRunAssociations(
  runsInCase: RunRow[],
  featuresById: Map<string, CaseFeatureRow>,
  releaseIdByReleaseKey: Map<string, string>
): Map<string, RunResolution> {
  const byId = new Map(runsInCase.map((run) => [run.id, run]));
  const resolved = new Map<string, RunResolution>();
  const ordered = [...runsInCase].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const resolveOne = (run: RunRow): RunResolution => {
    const cached = resolved.get(run.id);
    if (cached) return cached;

    let featureId: string | null = null;
    let releaseId: string | null = null;

    if (run.active_feature_id && featuresById.has(run.active_feature_id)) {
      // P1: asociación explícita, autoritativa (Regla 4/6).
      featureId = run.active_feature_id;
      const feature = featuresById.get(run.active_feature_id)!;
      releaseId = releaseIdByReleaseKey.get(feature.releaseKey) ?? null;
    } else if (run.originated_from_run_id && byId.has(run.originated_from_run_id)) {
      // P2: herencia determinística por ancestry, acotada al mismo Caso (Regla 7).
      const parentResolution = resolveOne(byId.get(run.originated_from_run_id)!);
      featureId = parentResolution.featureId;
      releaseId = parentResolution.releaseId;
      // P3: si el padre no tenía Feature pero sí Release, ese Release se hereda igual (Regla 6,
      // "si solo conocemos Release, el Run aparece bajo Release").
    }

    const result = { featureId, releaseId };
    resolved.set(run.id, result);
    return result;
  };

  for (const run of ordered) resolveOne(run);
  return resolved;
}

/**
 * Paso 7: reconstruye genealogía local dentro de un mismo bucket (Feature, Release-sin-Feature, o
 * Caso). Regla 9/11: `originated_from_run_id` solo anida cuando el padre está en el MISMO bucket --
 * un padre de otro Release/Feature/Caso no se sigue (la jerarquía de negocio prevalece sobre la
 * genealogía técnica), el Run queda como raíz visual de su propio bucket.
 */
function buildLocalForest(
  runsInBucket: RunRow[],
  kindOf: Map<string, CaseRunKind>
): CaseTreeRun[] {
  const idsInBucket = new Set(runsInBucket.map((run) => run.id));
  const nodeById = new Map<string, CaseTreeRun>();
  for (const run of runsInBucket) {
    nodeById.set(run.id, {
      id: run.id,
      status: run.status,
      currentPhase: run.current_phase,
      createdAt: run.created_at,
      kind: kindOf.get(run.id) ?? "run",
      children: [],
    });
  }

  const roots: CaseTreeRun[] = [];
  const ordered = [...runsInBucket].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const run of ordered) {
    const node = nodeById.get(run.id)!;
    const parentId = run.originated_from_run_id;
    if (parentId && idsInBucket.has(parentId)) {
      nodeById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function buildCaseTrees(params: {
  runs: RunRow[];
  roadmaps: CaseRoadmapRow[];
  features: CaseFeatureRow[];
  events: CaseRunEventRow[];
}): CaseTree[] {
  const runsByCaseKey = new Map<string, RunRow[]>();
  for (const run of params.runs) {
    const key = caseKeyOf(run);
    const bucket = runsByCaseKey.get(key) ?? [];
    bucket.push(run);
    runsByCaseKey.set(key, bucket);
  }

  // Paso 3: última versión del roadmap por Caso (Regla 3, contexto histórico, no "el vigente hoy").
  const latestRoadmapByCaseKey = new Map<string, CaseRoadmapRow>();
  for (const roadmap of params.roadmaps) {
    const current = latestRoadmapByCaseKey.get(roadmap.caseKey);
    if (!current || new Date(roadmap.validFrom).getTime() > new Date(current.validFrom).getTime()) {
      latestRoadmapByCaseKey.set(roadmap.caseKey, roadmap);
    }
  }

  const featuresByCaseKey = new Map<string, CaseFeatureRow[]>();
  for (const feature of params.features) {
    const bucket = featuresByCaseKey.get(feature.caseKey) ?? [];
    bucket.push(feature);
    featuresByCaseKey.set(feature.caseKey, bucket);
  }

  const eventsByRunId = new Map<string, CaseRunEventRow[]>();
  for (const event of params.events) {
    const bucket = eventsByRunId.get(event.runId) ?? [];
    bucket.push(event);
    eventsByRunId.set(event.runId, bucket);
  }

  const trees: CaseTree[] = [];

  for (const [caseKey, runsInCase] of runsByCaseKey) {
    const rootRun = runsInCase.find((run) => run.id === caseKey) ?? runsInCase[0];
    const displayName = rootRun.base_branch_name ?? shortCaseLabel(caseKey);

    const roadmap = latestRoadmapByCaseKey.get(caseKey);
    const roadmapValue = roadmap && isRoadmapPayload(roadmap.value) ? roadmap.value : null;
    const releaseEntries: RoadmapReleaseEntry[] = roadmapValue?.releases ?? [];

    const featuresInCase = featuresByCaseKey.get(caseKey) ?? [];
    const featuresById = new Map(featuresInCase.map((feature) => [feature.id, feature]));
    const releaseIdByReleaseKey = new Map(releaseEntries.map((release) => [release.id, release.id]));

    const associations = resolveRunAssociations(runsInCase, featuresById, releaseIdByReleaseKey);

    const kindByRunId = new Map<string, CaseRunKind>();
    for (const run of runsInCase) {
      const parentEvents = run.originated_from_run_id ? (eventsByRunId.get(run.originated_from_run_id) ?? []) : [];
      const ownEvents = eventsByRunId.get(run.id) ?? [];
      kindByRunId.set(run.id, classifyRunKind({ run, parentEvents, ownEvents }));
    }

    const featuresByReleaseKey = new Map<string, CaseFeatureRow[]>();
    for (const feature of featuresInCase) {
      const bucket = featuresByReleaseKey.get(feature.releaseKey) ?? [];
      bucket.push(feature);
      featuresByReleaseKey.set(feature.releaseKey, bucket);
    }

    const runsByFeatureId = new Map<string, RunRow[]>();
    const runsByReleaseIdOnly = new Map<string, RunRow[]>();
    const runsAtCaseLevel: RunRow[] = [];

    for (const run of runsInCase) {
      const resolution = associations.get(run.id)!;
      if (resolution.featureId) {
        const bucket = runsByFeatureId.get(resolution.featureId) ?? [];
        bucket.push(run);
        runsByFeatureId.set(resolution.featureId, bucket);
      } else if (resolution.releaseId) {
        const bucket = runsByReleaseIdOnly.get(resolution.releaseId) ?? [];
        bucket.push(run);
        runsByReleaseIdOnly.set(resolution.releaseId, bucket);
      } else {
        runsAtCaseLevel.push(run);
      }
    }

    const releases: CaseTreeRelease[] = releaseEntries.map((release) => {
      const featuresOfRelease = featuresByReleaseKey.get(release.id) ?? [];
      return {
        id: release.id,
        nombre: release.nombre,
        estado: release.estado,
        alcanceResumen: release.alcanceResumen,
        features: featuresOfRelease.map((feature) => ({
          id: feature.id,
          featureCode: feature.featureCode,
          name: feature.name,
          runs: buildLocalForest(runsByFeatureId.get(feature.id) ?? [], kindByRunId),
        })),
        runs: buildLocalForest(runsByReleaseIdOnly.get(release.id) ?? [], kindByRunId),
      };
    });

    trees.push({
      caseKey,
      displayName,
      createdAt: rootRun.created_at,
      releases,
      runs: buildLocalForest(runsAtCaseLevel, kindByRunId),
    });
  }

  return trees.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
