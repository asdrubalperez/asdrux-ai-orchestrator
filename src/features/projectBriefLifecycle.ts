import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db/pool.js";
import { getRunRootRunId, recordArtifact, recordRunEvent } from "../db/repository.js";
import { canonicalJson } from "./contracts.js";
import {
  PROJECT_BRIEF_DOCUMENT_PATH,
  PROJECT_BRIEF_TEMPLATE_KEY,
  projectBriefTemplateMetadata,
  renderProjectBriefDocument,
} from "./projectBriefDocument.js";
import { normalizeLf, sha256 } from "./document.js";
import type { ProjectBriefPayload } from "./projectBriefContracts.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export class ProjectBriefLifecycleEscalationError extends Error {}

export interface ProjectBriefRow {
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
 * FEATURE-033: único productor (Architect), sin revisiones append-only (a diferencia de
 * `persistFunctionalFeatureBatch`/FEATURE-023) — no hay evidencia de contribución incremental
 * multirol para Project Brief. Idempotencia vía `source_event_key`: si el mismo evento durable de
 * Architect (mismo `phaseFinishedEventId`) ya fue aplicado con contenido idéntico, no se genera un
 * nuevo artifact canónico ni se reescribe el puntero vigente.
 */
export async function persistProjectBrief(params: {
  projectId: string;
  runId: string;
  phaseFinishedEventId: string | number;
  payload: ProjectBriefPayload;
  templateAsset: RunbookTextAsset;
}): Promise<ProjectBriefRow> {
  const templateMetadata = projectBriefTemplateMetadata(params.templateAsset);
  const sourceEventKey = `${params.runId}:event:${params.phaseFinishedEventId}:architect-project-brief`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from projects where id = $1 for update", [params.projectId]);
    const run = await client.query<{ project_id: string | null }>(
      "select project_id from runs where id = $1",
      [params.runId]
    );
    if (run.rows[0]?.project_id !== params.projectId) {
      throw new ProjectBriefLifecycleEscalationError("Run y proyecto no coinciden.");
    }

    // FEATURE-047: `project_briefs` es de Caso, no de proyecto -- un segundo Caso de negocio del
    // mismo proyecto nunca debe encontrar (y por lo tanto sobrescribir) la fila de otro Caso.
    const rootRunId = await getRunRootRunId(client, params.runId);

    const existing = await client.query<ProjectBriefRow & { last_payload: unknown }>(
      `select project_briefs.*, artifacts.content -> 'payload' as last_payload
       from project_briefs
       left join artifacts on artifacts.id = project_briefs.canonical_artifact_id
       where project_briefs.project_id = $1 and project_briefs.root_run_id = $2
       for update of project_briefs`,
      [params.projectId, rootRunId]
    );
    let row = existing.rows[0] as ProjectBriefRow | undefined;

    if (row && row.source_event_key === sourceEventKey) {
      await client.query("commit");
      return row;
    }
    if (row && existing.rows[0].last_payload !== undefined && canonicalJson(existing.rows[0].last_payload) === canonicalJson(params.payload)) {
      const updated = await client.query<ProjectBriefRow>(
        "update project_briefs set source_event_key = $1, updated_at = now() where id = $2 returning *",
        [sourceEventKey, row.id]
      );
      await client.query("commit");
      return updated.rows[0];
    }

    if (!row) {
      const inserted = await client.query<ProjectBriefRow>(
        `insert into project_briefs (
           project_id, source_event_key, template_key, template_version, template_hash,
           template_snapshot, final_document_path, created_in_run_id, root_run_id
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning *`,
        [
          params.projectId,
          sourceEventKey,
          PROJECT_BRIEF_TEMPLATE_KEY,
          templateMetadata.templateVersion,
          templateMetadata.templateHash,
          templateMetadata.templateSnapshot,
          PROJECT_BRIEF_DOCUMENT_PATH,
          params.runId,
          rootRunId,
        ]
      );
      row = inserted.rows[0];
    }

    const projection = renderProjectBriefDocument(params.payload);
    const artifact = await recordArtifact({
      runId: params.runId,
      phase: "architect",
      kind: "project_brief_document",
      content: {
        summary: projection.summary,
        projectId: params.projectId,
        templateKey: PROJECT_BRIEF_TEMPLATE_KEY,
        templateVersion: templateMetadata.templateVersion,
        payload: params.payload,
        document: projection.markdown,
      },
      client,
    });
    const updated = await client.query<ProjectBriefRow>(
      `update project_briefs
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
        row.id,
      ]
    );
    await recordRunEvent(
      params.runId,
      "project_brief_document_revised",
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

export async function materializeProjectBriefDocument(params: {
  projectId: string;
  runId: string;
  worktreePath: string;
}): Promise<{ projectBrief: ProjectBriefRow; markdown: string; hash: string } | null> {
  const rootRunId = await getRunRootRunId(pool, params.runId);
  const result = await pool.query<ProjectBriefRow & { artifact_content: unknown }>(
    `select project_briefs.*, artifacts.content as artifact_content
     from project_briefs
     join artifacts on artifacts.id = project_briefs.canonical_artifact_id
     where project_briefs.project_id = $1 and project_briefs.root_run_id = $2`,
    [params.projectId, rootRunId]
  );
  const projectBrief = result.rows[0];
  if (!projectBrief) return null;
  const content = projectBrief.artifact_content as { document?: unknown };
  if (typeof content?.document !== "string") throw new Error("Artifact canónico de Project Brief sin Markdown.");
  const markdown = normalizeLf(content.document);
  const target = path.resolve(params.worktreePath, projectBrief.final_document_path);
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
    "update project_briefs set document_hash = $1, updated_at = now() where id = $2",
    [hash, projectBrief.id]
  );
  projectBrief.document_hash = hash;
  return { projectBrief, markdown, hash };
}

export interface ProjectBriefDocumentView {
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

/** FEATURE-033: mismo contrato de truncado que `getFeatureDocumentForRun` (64 KiB, FEATURE-022). */
export async function getProjectBriefDocumentForRun(runId: string): Promise<ProjectBriefDocumentView | null> {
  const result = await pool.query<ProjectBriefRow & { artifact_content: unknown }>(
    `select project_briefs.*, artifacts.content as artifact_content
     from runs
     join project_briefs
       on project_briefs.project_id = runs.project_id
      and project_briefs.root_run_id = coalesce(runs.root_run_id, runs.id)
     join artifacts on artifacts.id = project_briefs.canonical_artifact_id
     where runs.id = $1`,
    [runId]
  );
  const projectBrief = result.rows[0];
  if (!projectBrief || !projectBrief.canonical_artifact_id) return null;
  const markdownValue = (projectBrief.artifact_content as { document?: unknown })?.document;
  const markdown = typeof markdownValue === "string" ? markdownValue : "";
  const complete = Buffer.byteLength(JSON.stringify(markdown), "utf8") <= 64 * 1024;
  return {
    projectId: projectBrief.project_id,
    templateKey: projectBrief.template_key,
    templateVersion: projectBrief.template_version,
    path: projectBrief.final_document_path,
    canonicalArtifactId: projectBrief.canonical_artifact_id,
    materialized: Boolean(projectBrief.document_hash),
    markdown: complete ? markdown : null,
    complete,
    reason: complete ? null : "CONTENT_TOO_LARGE",
  };
}
