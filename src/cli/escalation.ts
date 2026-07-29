import type { AgentRole, PhaseInvocation } from "../contracts/executor.js";
import type { PipelineSpec } from "../pipelines/definitions.js";

/**
 * FEATURE-018: forma persistida en project_config_versions bajo config_key = "release_roadmap".
 * Vive acá (no en respondService.ts/runStart.ts) porque ambos módulos la necesitan y se importan
 * mutuamente (runStart.executePipelineRun es llamado desde respondService, que a su vez llama a
 * runStart) — este módulo ya es una dependencia compartida de los dos.
 */
export interface RoadmapReleaseEntry {
  id: string;
  nombre: string;
  alcanceResumen: string;
  estado: "Activo" | "Pendiente" | "Completado";
}

export interface RoadmapApprovalPayload {
  releases: RoadmapReleaseEntry[];
  activeReleaseId: string;
}

export function isRoadmapApprovalPayload(value: unknown): value is RoadmapApprovalPayload {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { releases?: unknown; activeReleaseId?: unknown };
  if (typeof candidate.activeReleaseId !== "string" || !Array.isArray(candidate.releases) || candidate.releases.length === 0) {
    return false;
  }
  if (!candidate.releases.every(isRoadmapReleaseEntry)) return false;
  return candidate.releases.some((release) => release.id === candidate.activeReleaseId);
}

function isRoadmapReleaseEntry(value: unknown): value is RoadmapReleaseEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.nombre === "string" &&
    typeof candidate.alcanceResumen === "string" &&
    (candidate.estado === "Activo" || candidate.estado === "Pendiente" || candidate.estado === "Completado")
  );
}

/** El release marcado como activo dentro de un roadmap ya persistido, o null si no hay ninguno. */
export function activeReleaseFromRoadmap(value: unknown): RoadmapReleaseEntry | null {
  if (!isRoadmapApprovalPayload(value)) return null;
  return value.releases.find((release) => release.id === value.activeReleaseId) ?? null;
}

/**
 * FEATURE-019: forma persistida en project_config_versions bajo config_key = "release_plan".
 * `ramaBaseTrabajo` no la declara Planning — la agrega el runtime (ver runStart.ts) al persistir,
 * tomada del business_case del run raíz (primera versión) o carried-forward de la versión anterior
 * (versiones siguientes).
 */
export interface ReleasePlanFeatureEntry {
  id: string;
  nombre: string;
  estado: "Pendiente" | "En curso" | "Completada";
}

export interface ReleasePlanPayload {
  ramaBaseTrabajo: string;
  features: ReleasePlanFeatureEntry[];
  featureActualId: string | null;
}

/** Forma que Planning declara en RELEASE_PLAN — sin `ramaBaseTrabajo`, la agrega el runtime. */
export type ReleasePlanDeclaration = Omit<ReleasePlanPayload, "ramaBaseTrabajo">;

export function isReleasePlanDeclaration(value: unknown): value is ReleasePlanDeclaration {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { features?: unknown; featureActualId?: unknown };
  if (!Array.isArray(candidate.features)) return false;
  if (candidate.featureActualId !== null && typeof candidate.featureActualId !== "string") return false;
  return candidate.features.every(isReleasePlanFeatureEntry);
}

function isReleasePlanFeatureEntry(value: unknown): value is ReleasePlanFeatureEntry {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.nombre === "string" &&
    (candidate.estado === "Pendiente" || candidate.estado === "En curso" || candidate.estado === "Completada")
  );
}

/**
 * Parsea el RELEASE_PLAN que Planning boltea a `outputArtifact` (mismo patrón que
 * `comandoTest`/`roadmap`/`features`). Devuelve null si el rol no es Planning, si no hay
 * `releasePlan` en el artifact, o si el JSON es inválido/malformado — riesgo H12 aceptado, mismo
 * criterio que `extractRoadmapApproval` de FEATURE-018: se trata como "sin declaración", no crashea.
 */
export function extractReleasePlanDeclaration(
  artifact: { phase: AgentRole },
  content: { outputArtifact: unknown }
): ReleasePlanDeclaration | null {
  if (artifact.phase !== "planning") return null;
  if (content.outputArtifact === null || typeof content.outputArtifact !== "object") return null;

  const raw = (content.outputArtifact as { releasePlan?: unknown }).releasePlan;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return isReleasePlanDeclaration(parsed) ? parsed : null;
}

/**
 * FEATURE-019: distingue la escalación de "release completo" (Planning no tiene más Features para
 * asignar) de una ambigüedad genérica de Planning — mismo criterio de distinción por contenido que
 * `extractRoadmapApproval`.
 */
export function isReleaseCompletionEscalation(
  artifact: { phase: AgentRole },
  content: { outputArtifact: unknown }
): boolean {
  if (artifact.phase !== "planning") return false;
  if (content.outputArtifact === null || typeof content.outputArtifact !== "object") return false;
  return (content.outputArtifact as { releaseCompleto?: unknown }).releaseCompleto === "true";
}

/**
 * FEATURE-019: artifact sintético (no producido por ningún PhaseResult de agente) que registra que
 * una Feature fue aprobada por QA y su sub-rama pusheada, pendiente de aprobación humana para
 * mergearla a la rama base del release (Modo Manual). Atribuido a `phase: "developer"` (dueño real
 * del código a mergear, Regla 10) — `mergeApproval: true` lo distingue de una escalación real de
 * ambigüedad de Developer, que también usa `phase: "developer"` pero nunca trae este campo.
 */
export interface MergeApprovalPayload {
  mergeApproval: true;
  baseBranch: string;
  featureBranch: string;
  featureActualId: string | null;
}

export function isMergeApprovalPayload(value: unknown): value is MergeApprovalPayload {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.mergeApproval === true &&
    typeof candidate.baseBranch === "string" &&
    typeof candidate.featureBranch === "string" &&
    (candidate.featureActualId === null || typeof candidate.featureActualId === "string")
  );
}

export function extractMergeApproval(
  artifact: { phase: AgentRole },
  content: { outputArtifact: unknown }
): MergeApprovalPayload | null {
  if (artifact.phase !== "developer") return null;
  return isMergeApprovalPayload(content.outputArtifact) ? content.outputArtifact : null;
}

/**
 * FEATURE-020, Regla 2/9: el reintento en el mismo run (`handleLinearEscalation`, sin cambios de
 * mecanismo) ahora incluye `businessCase` (vía `getBusinessCaseForRun`/`root_run_id`) — arregla el
 * bug original de FEATURE-019 (Architect reinterpretando sin poder contrastar contra el caso de
 * negocio real) sin tocar el resto del mecanismo.
 */
export interface EscalationContext {
  businessCase: unknown;
  escalationReason: string;
  rejectedArtifact: unknown;
  originAgentRole: AgentRole;
  humanSolution: string | null;
}

export function buildEscalationContext(params: {
  businessCase: unknown;
  escalationReason: string | null;
  rejectedArtifact: unknown;
  originAgentRole: AgentRole;
  humanSolution: string | null;
}): EscalationContext {
  return {
    businessCase: params.businessCase,
    escalationReason: params.escalationReason ?? "Escalamiento sin razón explícita persistida.",
    rejectedArtifact: params.rejectedArtifact,
    originAgentRole: params.originAgentRole,
    humanSolution: params.humanSolution,
  };
}

/**
 * FEATURE-020, sección 6.3: tabla estática de predecesor por rol en el orden del pipeline —
 * `architect` no tiene entrada, sus escalaciones no usan el mecanismo de reingreso encadenado
 * (Regla 9). Calculada mecánicamente por el orquestador, nunca por el LLM.
 */
const PREDECESSOR_ROLE: Partial<Record<AgentRole, AgentRole>> = {
  functional: "architect",
  planning: "functional",
  developer: "planning",
  qa: "developer",
};

export function predecessorRoleFor(role: AgentRole): AgentRole | null {
  return PREDECESSOR_ROLE[role] ?? null;
}

/**
 * FEATURE-020, sección 6.4: contexto de reingreso encadenado — usado por el camino genérico de
 * `respondService.ts` (todo lo que no sea `mergeApproval`). Se distingue de un artifact normal por
 * su forma (siempre tiene `escalationReason` + `targetAgentRole`, ver `isReentryContext`).
 */
export interface ReentryContext extends EscalationContext {
  targetAgentRole: AgentRole | null;
  /** Contador de recorridos completos (tope 3, Regla 8) — viaja en el contexto, no en memoria. */
  attempt: number;
  /** `id` de la versión vigente del artefacto relevante al momento de escalar (Regla 7/6.5). */
  originalVersionRef: string | null;
}

export function buildReentryContext(params: {
  businessCase: unknown;
  escalationReason: string | null;
  rejectedArtifact: unknown;
  originAgentRole: AgentRole;
  humanSolution: string | null;
  attempt: number;
  originalVersionRef: string | null;
}): ReentryContext {
  return {
    ...buildEscalationContext(params),
    targetAgentRole: predecessorRoleFor(params.originAgentRole),
    attempt: params.attempt,
    originalVersionRef: params.originalVersionRef,
  };
}

/**
 * Distingue un contexto de reingreso de cualquier otro contenido que viaje como `context` de una
 * fase (el `outputArtifact` normal de un rol, o el `business_case` crudo) — ningún artifact de rol
 * declara `escalationReason`/`targetAgentRole` como campos propios (confirmado por grep sobre los 5
 * prompts de rol en la ronda 3 de validación de FEATURE-020).
 */
export function isReentryContext(value: unknown): value is ReentryContext {
  if (value === null || typeof value !== "object") return false;
  return "escalationReason" in value && "targetAgentRole" in value;
}

/**
 * FEATURE-020, Regla 5: marcador que un rol usa para indicar que una escalación en revisión no le
 * corresponde — el orquestador reconoce esta forma exacta para avanzar de fase sin tratarla como
 * un artifact normal. Acepta booleano real (`CodexExecutor`, JSON nativo) o el string `"true"`
 * (`ClaudeCodeExecutor`, convención de texto plano — mismo patrón que `RELEASE_COMPLETO`).
 */
export function isNotApplicableOutput(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const notApplicable = (value as { notApplicable?: unknown }).notApplicable;
  return notApplicable === true || notApplicable === "true";
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }

  return value;
}

export function artifactsAreEquivalent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function parsePipelineDefinitionRow(row: {
  name: string;
  version: number;
  definition?: unknown;
}): PipelineSpec {
  const definition = row.definition;
  if (!isPipelineDefinition(definition)) {
    throw new Error(`Definición de pipeline inválida para ${row.name}@${row.version}.`);
  }

  return {
    name: row.name,
    version: row.version,
    definition,
  };
}

function isPipelineDefinition(value: unknown): value is PipelineSpec["definition"] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { phases?: unknown; loop?: unknown };
  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0) return false;

  if (!candidate.phases.every(isPipelinePhase)) return false;
  if (candidate.loop !== undefined && !isLoopSpec(candidate.loop)) return false;
  return true;
}

function isPipelinePhase(value: unknown): value is PipelineSpec["definition"]["phases"][number] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { agentRole?: unknown; permissions?: unknown };
  return isAgentRole(candidate.agentRole) && isPermissions(candidate.permissions);
}

function isLoopSpec(value: unknown): value is NonNullable<PipelineSpec["definition"]["loop"]> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { developerRole?: unknown; qaRole?: unknown; maxAttempts?: unknown };
  return candidate.developerRole === "developer" && candidate.qaRole === "qa" && typeof candidate.maxAttempts === "number";
}

export function isAgentRole(value: unknown): value is AgentRole {
  return value === "architect" || value === "functional" || value === "planning" || value === "developer" || value === "qa";
}

function isPermissions(value: unknown): value is PhaseInvocation["permissions"] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { filesystem?: unknown; writableRoots?: unknown; allowedCommands?: unknown };
  if (candidate.filesystem !== "read-only" && candidate.filesystem !== "workspace-write") return false;
  if (candidate.writableRoots !== undefined && !isStringArray(candidate.writableRoots)) return false;
  if (candidate.allowedCommands !== undefined && !isStringArray(candidate.allowedCommands)) return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
