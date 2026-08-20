import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { getRunRootRunId, recordArtifact, recordRunEvent } from "../db/repository.js";
import { canonicalJson } from "./contracts.js";
import { normalizeLf, sha256, isWithinDocumentSizeLimit } from "./canonicalDocument.js";
import {
  ARCHITECTURE_DOCUMENT_PATH,
  ARCHITECTURE_TEMPLATE_KEY,
  architectureTemplateMetadata,
  renderArchitectureDocument,
} from "./architectureDocument.js";
import { isRoadmapApprovalPayload, type RoadmapApprovalPayload } from "../cli/escalation.js";
import type { ArchitecturePayload } from "./architectureContracts.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export class ArchitectureLifecycleEscalationError extends Error {}

export interface ArchitectureRow {
  id: string;
  project_id: string;
  source_event_key: string;
  template_key: string;
  template_version: string;
  canonical_artifact_id: string | null;
  final_document_path: string;
  document_hash: string | null;
  created_in_run_id: string;
  root_run_id: string;
}

/**
 * FEATURE-034: único productor (Architect), sin revisiones append-only en v1 (Rule 14) -- mismo
 * patrón que `persistProjectBrief`. Idempotencia (Rule 10/11) compara payload técnico Y Roadmap
 * aprobado juntos, no sólo el payload -- una transición legítima de release sin cambios técnicos
 * igual debe producir una versión canónica nueva (Rule 12/Scenario 11).
 *
 * Rule 7: si no existe un `release_roadmap` operacional válido en el momento de persistir, falla
 * cerrado -- nunca se genera una Architecture canónica sin sección 0.
 */
export async function persistArchitecture(params: {
  projectId: string;
  runId: string;
  phaseFinishedEventId: string | number;
  payload: ArchitecturePayload;
  templateAsset: RunbookTextAsset;
}): Promise<ArchitectureRow> {
  const templateMetadata = architectureTemplateMetadata(params.templateAsset);
  const sourceEventKey = `${params.runId}:event:${params.phaseFinishedEventId}:architect-architecture`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from projects where id = $1 for update", [params.projectId]);
    const run = await client.query<{ project_id: string | null }>(
      "select project_id from runs where id = $1",
      [params.runId]
    );
    if (run.rows[0]?.project_id !== params.projectId) {
      throw new ArchitectureLifecycleEscalationError("Run y proyecto no coinciden.");
    }

    // FEATURE-046: `release_roadmap` es config de Caso -- Architect solo debe ver el Roadmap de su
    // propio Caso de negocio, nunca el de un Caso ajeno concurrente en el mismo proyecto.
    const rootRunId = await getRunRootRunId(client, params.runId);
    const roadmap = await currentApprovedRoadmap(client, params.projectId, rootRunId);
    if (!roadmap) {
      throw new ArchitectureLifecycleEscalationError(
        `Proyecto ${params.projectId}: no hay release_roadmap operacional válido -- Architecture no puede componer su sección 0.`
      );
    }

    // FEATURE-047: `architectures` es de Caso, no de proyecto -- mismo criterio que
    // `project_briefs`; reutiliza el `rootRunId` ya resuelto arriba para `currentApprovedRoadmap`.
    const existing = await client.query<ArchitectureRow & { last_payload: unknown }>(
      `select architectures.*, artifacts.content -> 'payload' as last_payload
       from architectures
       left join artifacts on artifacts.id = architectures.canonical_artifact_id
       where architectures.project_id = $1 and architectures.root_run_id = $2
       for update of architectures`,
      [params.projectId, rootRunId]
    );
    const existingRow = existing.rows[0];
    let row: ArchitectureRow | undefined = existingRow;

    if (row && row.source_event_key === sourceEventKey) {
      await client.query("commit");
      return row;
    }
    const lastEquivalent =
      existingRow && existingRow.last_payload !== undefined && existingRow.last_payload !== null
        ? canonicalJson({ payload: existingRow.last_payload, roadmap: roadmapForComparison(roadmap) })
        : null;
    const nextEquivalent = canonicalJson({ payload: params.payload, roadmap: roadmapForComparison(roadmap) });
    if (row && lastEquivalent !== null && lastEquivalent === nextEquivalent) {
      const updated = await client.query<ArchitectureRow>(
        "update architectures set source_event_key = $1, updated_at = now() where id = $2 returning *",
        [sourceEventKey, row.id]
      );
      await client.query("commit");
      return updated.rows[0];
    }

    if (!row) {
      const inserted = await client.query<ArchitectureRow>(
        `insert into architectures (
           project_id, source_event_key, template_key, template_version, template_hash,
           template_snapshot, final_document_path, created_in_run_id, root_run_id
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning *`,
        [
          params.projectId,
          sourceEventKey,
          ARCHITECTURE_TEMPLATE_KEY,
          templateMetadata.templateVersion,
          templateMetadata.templateHash,
          templateMetadata.templateSnapshot,
          ARCHITECTURE_DOCUMENT_PATH,
          params.runId,
          rootRunId,
        ]
      );
      row = inserted.rows[0];
    }
    const architectureRow: ArchitectureRow = row;

    const projection = renderArchitectureDocument(params.payload, roadmap);
    const artifact = await recordArtifact({
      runId: params.runId,
      phase: "architect",
      kind: "architecture_document",
      content: {
        summary: projection.summary,
        projectId: params.projectId,
        templateKey: ARCHITECTURE_TEMPLATE_KEY,
        templateVersion: templateMetadata.templateVersion,
        payload: params.payload,
        approvedRoadmap: roadmap,
        document: projection.markdown,
      },
      client,
    });
    const updated = await client.query<ArchitectureRow>(
      `update architectures
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
        architectureRow.id,
      ]
    );
    await recordRunEvent(
      params.runId,
      "architecture_document_revised",
      { projectId: params.projectId, artifactId: artifact.id },
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

export async function materializeArchitectureDocument(params: {
  projectId: string;
  runId: string;
  worktreePath: string;
}): Promise<{ architecture: ArchitectureRow; markdown: string; hash: string } | null> {
  const rootRunId = await getRunRootRunId(pool, params.runId);
  const result = await pool.query<ArchitectureRow & { artifact_content: unknown }>(
    `select architectures.*, artifacts.content as artifact_content
     from architectures
     join artifacts on artifacts.id = architectures.canonical_artifact_id
     where architectures.project_id = $1 and architectures.root_run_id = $2`,
    [params.projectId, rootRunId]
  );
  const architecture = result.rows[0];
  if (!architecture) return null;
  const content = architecture.artifact_content as { document?: unknown };
  if (typeof content?.document !== "string") throw new Error("Artifact canónico de Architecture sin Markdown.");
  const markdown = normalizeLf(content.document);
  const target = path.resolve(params.worktreePath, architecture.final_document_path);
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
    "update architectures set document_hash = $1, updated_at = now() where id = $2",
    [hash, architecture.id]
  );
  architecture.document_hash = hash;
  return { architecture, markdown, hash };
}

export interface ArchitectureDocumentView {
  projectId: string;
  templateKey: string;
  templateVersion: string;
  path: string;
  canonicalArtifactId: string;
  materialized: boolean;
  markdown: string | null;
  complete: boolean;
  reason: "CONTENT_TOO_LARGE" | null;
}

/** FEATURE-034: mismo contrato de truncado que Feature/Project Brief (64 KiB, FEATURE-022). */
export async function getArchitectureDocumentForRun(runId: string): Promise<ArchitectureDocumentView | null> {
  const result = await pool.query<ArchitectureRow & { artifact_content: unknown }>(
    `select architectures.*, artifacts.content as artifact_content
     from runs
     join architectures
       on architectures.project_id = runs.project_id
      and architectures.root_run_id = coalesce(runs.root_run_id, runs.id)
     join artifacts on artifacts.id = architectures.canonical_artifact_id
     where runs.id = $1`,
    [runId]
  );
  const architecture = result.rows[0];
  if (!architecture || !architecture.canonical_artifact_id) return null;
  const markdownValue = (architecture.artifact_content as { document?: unknown })?.document;
  const markdown = typeof markdownValue === "string" ? markdownValue : "";
  const complete = isWithinDocumentSizeLimit(markdown);
  return {
    projectId: architecture.project_id,
    templateKey: architecture.template_key,
    templateVersion: architecture.template_version,
    path: architecture.final_document_path,
    canonicalArtifactId: architecture.canonical_artifact_id,
    materialized: Boolean(architecture.document_hash),
    markdown: complete ? markdown : null,
    complete,
    reason: complete ? null : "CONTENT_TOO_LARGE",
  };
}

async function currentApprovedRoadmap(
  client: PoolClient,
  projectId: string,
  rootRunId: string
): Promise<RoadmapApprovalPayload | null> {
  const result = await client.query<{ value: unknown }>(
    `select value from project_config_versions
     where project_id = $1 and config_key = 'release_roadmap' and valid_to is null
       and root_run_id = $2`,
    [projectId, rootRunId]
  );
  const value = result.rows[0]?.value ?? null;
  return isRoadmapApprovalPayload(value) ? value : null;
}

/** Excluye campos irrelevantes para la comparación de idempotencia (nada hoy, reservado por claridad de intención). */
function roadmapForComparison(roadmap: RoadmapApprovalPayload): RoadmapApprovalPayload {
  return roadmap;
}
