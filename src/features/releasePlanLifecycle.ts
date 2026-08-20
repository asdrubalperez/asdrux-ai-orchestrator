import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db/pool.js";
import { getRunRootRunId, recordArtifact, recordRunEvent } from "../db/repository.js";
import { canonicalJson } from "./contracts.js";
import { normalizeLf, sha256, isWithinDocumentSizeLimit } from "./canonicalDocument.js";
import {
  releasePlanDocumentPath,
  releasePlanTemplateMetadata,
  renderReleasePlanDocument,
  RELEASE_PLAN_TEMPLATE_KEY,
} from "./releasePlanDocument.js";
import type { FeaturePlan, ReleasePlanDocumentPayload } from "./releasePlanContracts.js";
import type { ReleasePlanFeatureEntry } from "../cli/escalation.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export class ReleasePlanLifecycleEscalationError extends Error {}

export interface ReleasePlanRow {
  id: string;
  project_id: string;
  release_key: string;
  source_event_key: string;
  template_key: string;
  template_version: string;
  canonical_artifact_id: string | null;
  final_document_path: string;
  document_hash: string | null;
  created_in_run_id: string;
  /** FEATURE-046: epoch (Caso de negocio) dueño de esta fila -- fijado una única vez al crearla. */
  root_run_id: string;
}

interface StoredReleasePlanContent {
  featurePlans?: FeaturePlan[];
}

/**
 * FEATURE-035: único productor (Planning), sin `release_plan_revisions` -- el runtime acumula los
 * bloques de §2 directamente en el `payload` del artifact canónico sucesivo (cada artifact ya es
 * la proyección completa acumulada hasta ese punto), en vez de exigirle al modelo redeclarar
 * bloques de Features ya planificadas. Idempotencia (Rule 9/10) compara el estado operacional
 * (`operationalFeatures`) + el payload rico acumulado -- un cambio de estado de Feature sin cambio
 * técnico igual cuenta como cambio real (Rule 10).
 */
export async function persistReleasePlanDocument(params: {
  projectId: string;
  runId: string;
  releaseKey: string;
  phaseFinishedEventId: string | number;
  payload: ReleasePlanDocumentPayload;
  operationalFeatures: ReleasePlanFeatureEntry[];
  templateAsset: RunbookTextAsset;
}): Promise<ReleasePlanRow> {
  const templateMetadata = releasePlanTemplateMetadata(params.templateAsset);
  const sourceEventKey = `${params.runId}:event:${params.phaseFinishedEventId}:planning-release-plan`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from projects where id = $1 for update", [params.projectId]);
    const run = await client.query<{ project_id: string | null }>(
      "select project_id from runs where id = $1",
      [params.runId]
    );
    if (run.rows[0]?.project_id !== params.projectId) {
      throw new ReleasePlanLifecycleEscalationError("Run y proyecto no coinciden.");
    }
    // FEATURE-046: dos Casos de negocio distintos del mismo proyecto que reutilicen `releaseKey`
    // nunca comparten fila -- el lookup/insert de abajo se acota al epoch de este run.
    const rootRunId = await getRunRootRunId(client, params.runId);

    if (params.payload.featurePlan) {
      const secuenciaKeys = new Set(params.payload.secuencia.map((entry) => entry.sourceKey));
      if (!secuenciaKeys.has(params.payload.featurePlan.sourceKey)) {
        throw new ReleasePlanLifecycleEscalationError(
          `featurePlan.sourceKey "${params.payload.featurePlan.sourceKey}" no pertenece a la secuencia declarada del release ${params.releaseKey}.`
        );
      }
    }

    const existing = await client.query<ReleasePlanRow & { last_content: unknown }>(
      `select release_plans.*, artifacts.content as last_content
       from release_plans
       left join artifacts on artifacts.id = release_plans.canonical_artifact_id
       where release_plans.project_id = $1 and release_plans.release_key = $2
         and release_plans.root_run_id = $3
       for update of release_plans`,
      [params.projectId, params.releaseKey, rootRunId]
    );
    const existingRow = existing.rows[0];
    let row: ReleasePlanRow | undefined = existingRow;

    if (row && row.source_event_key === sourceEventKey) {
      await client.query("commit");
      return row;
    }

    const previousFeaturePlans: FeaturePlan[] =
      (existingRow?.last_content as StoredReleasePlanContent | undefined)?.featurePlans ?? [];
    const accumulatedFeaturePlans = mergeFeaturePlan(previousFeaturePlans, params.payload.featurePlan);

    const nextEquivalent = canonicalJson({
      evaluacionTamano: params.payload.evaluacionTamano,
      secuencia: params.payload.secuencia,
      featurePlans: accumulatedFeaturePlans,
      operationalFeatures: params.operationalFeatures,
    });
    const lastEquivalent = existingRow
      ? canonicalJson({
          evaluacionTamano: (existingRow.last_content as { evaluacionTamano?: unknown })?.evaluacionTamano ?? null,
          secuencia: (existingRow.last_content as { secuencia?: unknown })?.secuencia ?? null,
          featurePlans: previousFeaturePlans,
          operationalFeatures:
            (existingRow.last_content as { operationalFeatures?: unknown })?.operationalFeatures ?? null,
        })
      : null;
    if (existingRow && lastEquivalent === nextEquivalent) {
      const updated = await client.query<ReleasePlanRow>(
        "update release_plans set source_event_key = $1, updated_at = now() where id = $2 returning *",
        [sourceEventKey, existingRow.id]
      );
      await client.query("commit");
      return updated.rows[0];
    }

    if (!row) {
      const inserted = await client.query<ReleasePlanRow>(
        `insert into release_plans (
           project_id, release_key, source_event_key, template_key, template_version, template_hash,
           template_snapshot, final_document_path, created_in_run_id, root_run_id
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning *`,
        [
          params.projectId,
          params.releaseKey,
          sourceEventKey,
          RELEASE_PLAN_TEMPLATE_KEY,
          templateMetadata.templateVersion,
          templateMetadata.templateHash,
          templateMetadata.templateSnapshot,
          releasePlanDocumentPath(params.releaseKey),
          params.runId,
          rootRunId,
        ]
      );
      row = inserted.rows[0];
    }
    const releasePlanRow: ReleasePlanRow = row;

    const projection = renderReleasePlanDocument({
      evaluacionTamano: params.payload.evaluacionTamano,
      secuencia: params.payload.secuencia,
      featurePlans: accumulatedFeaturePlans,
      operationalFeatures: params.operationalFeatures,
      hallazgos: params.payload.hallazgos,
    });
    const artifact = await recordArtifact({
      runId: params.runId,
      phase: "planning",
      kind: "release_plan_document",
      content: {
        summary: projection.summary,
        projectId: params.projectId,
        releaseKey: params.releaseKey,
        templateKey: RELEASE_PLAN_TEMPLATE_KEY,
        templateVersion: templateMetadata.templateVersion,
        evaluacionTamano: params.payload.evaluacionTamano,
        secuencia: params.payload.secuencia,
        featurePlans: accumulatedFeaturePlans,
        operationalFeatures: params.operationalFeatures,
        document: projection.markdown,
      },
      client,
    });
    const updated = await client.query<ReleasePlanRow>(
      `update release_plans
       set canonical_artifact_id = $1, source_event_key = $2, template_version = $3, template_hash = $4,
           template_snapshot = $5, updated_at = now()
       where id = $6
       returning *`,
      [
        artifact.id,
        sourceEventKey,
        templateMetadata.templateVersion,
        templateMetadata.templateHash,
        templateMetadata.templateSnapshot,
        releasePlanRow.id,
      ]
    );
    await recordRunEvent(
      params.runId,
      "release_plan_document_revised",
      { projectId: params.projectId, releaseKey: params.releaseKey, artifactId: artifact.id },
      client
    );
    await client.query("commit");
    return updated.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mergeFeaturePlan(previous: FeaturePlan[], incoming: FeaturePlan | null): FeaturePlan[] {
  if (!incoming) return previous;
  const withoutIncoming = previous.filter((plan) => plan.sourceKey !== incoming.sourceKey);
  return [...withoutIncoming, incoming];
}

export async function materializeReleasePlanDocument(params: {
  projectId: string;
  /** FEATURE-046: epoch (Caso de negocio) del run que dispara la materialización. */
  rootRunId: string;
  releaseKey: string;
  worktreePath: string;
}): Promise<{ releasePlan: ReleasePlanRow; markdown: string; hash: string } | null> {
  const result = await pool.query<ReleasePlanRow & { artifact_content: unknown }>(
    `select release_plans.*, artifacts.content as artifact_content
     from release_plans
     join artifacts on artifacts.id = release_plans.canonical_artifact_id
     where release_plans.project_id = $1 and release_plans.release_key = $2
       and release_plans.root_run_id = $3`,
    [params.projectId, params.releaseKey, params.rootRunId]
  );
  const releasePlan = result.rows[0];
  if (!releasePlan) return null;
  const content = releasePlan.artifact_content as { document?: unknown };
  if (typeof content?.document !== "string") throw new Error("Artifact canónico de Release Plan sin Markdown.");
  const markdown = normalizeLf(content.document);
  const target = path.resolve(params.worktreePath, releasePlan.final_document_path);
  const root = path.resolve(params.worktreePath);
  if (!target.startsWith(root + path.sep)) throw new Error("Ruta documental fuera del worktree.");
  await mkdir(path.dirname(target), { recursive: true });
  // Fix (2026-08-17), hallazgo en vivo: mismo criterio que features/lifecycle.ts -- "wx" fallaba
  // con EEXIST en un worktree fresco cuyo branch base ya tenía el documento commiteado por un run
  // anterior. `document_hash` describe la fila en DB, no el filesystem del worktree. Sobrescribir
  // siempre es correcto: el path es determinístico y el contenido es la fuente canónica de verdad.
  await writeFile(target, markdown, { encoding: "utf8", flag: "w" });
  const hash = sha256(markdown);
  await pool.query(
    "update release_plans set document_hash = $1, updated_at = now() where id = $2",
    [hash, releasePlan.id]
  );
  releasePlan.document_hash = hash;
  return { releasePlan, markdown, hash };
}

export interface ReleasePlanDocumentView {
  projectId: string;
  releaseKey: string;
  templateKey: string;
  templateVersion: string;
  path: string;
  canonicalArtifactId: string;
  materialized: boolean;
  markdown: string | null;
  complete: boolean;
  reason: "CONTENT_TOO_LARGE" | null;
}

/**
 * FEATURE-035: a diferencia de Project Brief/Architecture (uno por proyecto), Release Plan
 * depende también del release -- se resuelve vía `runs.active_feature_id -> features.release_key`
 * (mismo join que ya usa `getActiveFeatureForRun` de FEATURE-023).
 */
export async function getReleasePlanDocumentForRun(runId: string): Promise<ReleasePlanDocumentView | null> {
  const result = await pool.query<ReleasePlanRow & { artifact_content: unknown }>(
    `select release_plans.*, artifacts.content as artifact_content
     from runs
     join features on features.id = runs.active_feature_id
     join release_plans on release_plans.project_id = runs.project_id and release_plans.release_key = features.release_key
      and release_plans.root_run_id = coalesce(runs.root_run_id, runs.id)
     join artifacts on artifacts.id = release_plans.canonical_artifact_id
     where runs.id = $1`,
    [runId]
  );
  const releasePlan = result.rows[0];
  if (!releasePlan || !releasePlan.canonical_artifact_id) return null;
  const markdownValue = (releasePlan.artifact_content as { document?: unknown })?.document;
  const markdown = typeof markdownValue === "string" ? markdownValue : "";
  const complete = isWithinDocumentSizeLimit(markdown);
  return {
    projectId: releasePlan.project_id,
    releaseKey: releasePlan.release_key,
    templateKey: releasePlan.template_key,
    templateVersion: releasePlan.template_version,
    path: releasePlan.final_document_path,
    canonicalArtifactId: releasePlan.canonical_artifact_id,
    materialized: Boolean(releasePlan.document_hash),
    markdown: complete ? markdown : null,
    complete,
    reason: complete ? null : "CONTENT_TOO_LARGE",
  };
}
