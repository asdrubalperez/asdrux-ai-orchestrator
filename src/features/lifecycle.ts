import { readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { recordArtifact, recordRunEvent, setProjectConfig } from "../db/repository.js";
import type { AgentRole } from "../contracts/executor.js";
import {
  canonicalJson,
  type DeveloperImplementationPayload,
  type DeveloperReadinessPayload,
  type FeatureUpdatePayload,
  type FeaturesPayload,
  type QaResultPayload,
} from "./contracts.js";
import {
  FEATURE_TEMPLATE_KEY,
  featureDocumentPath,
  functionalTemplateMetadata,
  normalizeLf,
  renderFeatureDocument,
  sha256,
  type FeatureIdentityView,
  type FeatureRevisionView,
} from "./document.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

export class FeatureLifecycleEscalationError extends Error {}

export interface FeatureRow extends FeatureIdentityView {
  project_id: string;
  source_key: string;
  canonical_artifact_id: string | null;
  final_document_path: string;
  activated_at: string | null;
  document_hash: string | null;
  final_commit_sha: string | null;
  pushed_branch: string | null;
  pushed_at: string | null;
}

type Contribution =
  | { purpose: "developer-implementation"; sectionKey: "developer_implementation"; operation: "append_entry"; content: DeveloperImplementationPayload }
  | { purpose: "qa-result"; sectionKey: "qa_result"; operation: "record_qa_result"; content: QaResultPayload }
  | { purpose: "developer-readiness"; sectionKey: "developer_readiness"; operation: "record_readiness"; content: DeveloperReadinessPayload };

export async function persistFunctionalFeatureBatch(params: {
  projectId: string;
  runId: string;
  worktreePath: string;
  releaseKey: string;
  phaseFinishedEventId: string | number;
  payload: FeaturesPayload;
  templateAsset: RunbookTextAsset;
}): Promise<FeatureRow[]> {
  const templateMetadata = functionalTemplateMetadata(params.templateAsset);
  const names = await existingFeatureNames(params.worktreePath);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from projects where id = $1 for update", [params.projectId]);
    await assertRunProjectAndPinnedRelease(client, params.runId, params.projectId, params.releaseKey);
    const existingCodes = await client.query<{ feature_code: string }>(
      "select feature_code from features where project_id = $1",
      [params.projectId]
    );
    let nextNumber = maximumFeatureNumber([...existingCodes.rows.map((row) => row.feature_code), ...names]) + 1;
    const results: FeatureRow[] = [];

    for (const definition of params.payload.features) {
      const existing = await client.query<FeatureRow>(
        `select * from features
         where project_id = $1 and release_key = $2 and source_key = $3
         for update`,
        [params.projectId, params.releaseKey, definition.id]
      );
      let feature = existing.rows[0];
      if (!feature) {
        const featureCode = `FEATURE-${String(nextNumber++).padStart(3, "0")}`;
        const finalPath = featureDocumentPath(featureCode, definition.nombre);
        if (names.some((name) => normalizePath(name) === normalizePath(finalPath))) {
          throw new Error(`Colisión de ruta para ${finalPath}.`);
        }
        const inserted = await client.query<FeatureRow>(
          `insert into features (
             project_id, release_key, source_key, feature_code, name, priority,
             template_key, template_version, template_hash, template_snapshot,
             final_document_path, created_in_run_id
           )
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           returning *`,
          [
            params.projectId,
            params.releaseKey,
            definition.id,
            featureCode,
            definition.nombre,
            definition.prioridad,
            FEATURE_TEMPLATE_KEY,
            templateMetadata.templateVersion,
            templateMetadata.templateHash,
            templateMetadata.templateSnapshot,
            finalPath,
            params.runId,
          ]
        );
        feature = inserted.rows[0];
      }

      const currentFunctional = await latestRevisionContent(client, feature.id, "functional_definition");
      if (currentFunctional !== null && canonicalJson(currentFunctional) === canonicalJson(definition)) {
        results.push(feature);
        continue;
      }
      if (currentFunctional !== null && feature.activated_at !== null) {
        throw new FeatureLifecycleEscalationError(
          `${feature.feature_code} ya fue activada; Functional no puede redefinirla.`
        );
      }
      if (currentFunctional !== null) {
        const revisedPath = featureDocumentPath(feature.feature_code, definition.nombre);
        const collides = names.some(
          (name) =>
            normalizePath(name) === normalizePath(revisedPath) &&
            normalizePath(name) !== normalizePath(feature.final_document_path)
        );
        if (collides) throw new Error(`Colisión de ruta para ${revisedPath}.`);
        const revisedIdentity = await client.query<FeatureRow>(
          `update features
           set name = $1, priority = $2, final_document_path = $3, updated_at = now()
           where id = $4
           returning *`,
          [definition.nombre, definition.prioridad, revisedPath, feature.id]
        );
        feature = revisedIdentity.rows[0];
      }

      const contributionId = contributionKey(
        params.runId,
        params.phaseFinishedEventId,
        "functional-definition",
        feature.source_key
      );
      const inserted = await insertRevision(client, {
        feature,
        contributionId,
        sectionKey: "functional_definition",
        operation: "replace_section",
        content: definition,
        role: "functional",
        runId: params.runId,
        attempt: null,
      });
      if (inserted) feature = await refreshCanonicalArtifact(client, feature, params.runId, "functional");
      results.push(feature);
    }

    await recordRunEvent(
      params.runId,
      "feature_batch_persisted",
      { releaseKey: params.releaseKey, featureIds: results.map((feature) => feature.id) },
      client
    );
    await client.query("commit");
    return results;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistPlanningFeatureSelection(params: {
  projectId: string;
  runId: string;
  releaseKey: string;
  phaseFinishedEventId: string | number;
  releasePlan: unknown;
  featureActualId: string;
  update: FeatureUpdatePayload;
}): Promise<FeatureRow> {
  if (params.featureActualId !== params.update.sourceKey) {
    throw new FeatureLifecycleEscalationError("RELEASE_PLAN.featureActualId y FEATURE_UPDATE.sourceKey no coinciden.");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const featureResult = await client.query<FeatureRow>(
      `select * from features
       where project_id = $1 and release_key = $2 and source_key = $3
       for update`,
      [params.projectId, params.releaseKey, params.featureActualId]
    );
    let feature = featureResult.rows[0];
    if (!feature) throw new FeatureLifecycleEscalationError("Planning seleccionó una Feature inexistente en el release activo.");
    const run = await client.query<{ project_id: string | null }>(
      "select project_id from runs where id = $1 for update",
      [params.runId]
    );
    if (run.rows[0]?.project_id !== params.projectId) {
      throw new FeatureLifecycleEscalationError("Run y Feature no pertenecen al mismo proyecto.");
    }
    await setProjectConfig({
      projectId: params.projectId,
      configKey: "release_plan",
      value: params.releasePlan,
      changedInRunId: params.runId,
      client,
    });
    await client.query(
      "update runs set active_feature_id = $1, updated_at = now() where id = $2",
      [feature.id, params.runId]
    );
    await client.query(
      "update features set activated_at = coalesce(activated_at, now()), updated_at = now() where id = $1",
      [feature.id]
    );
    feature.activated_at = feature.activated_at ?? new Date().toISOString();
    const contributionId = contributionKey(
      params.runId,
      params.phaseFinishedEventId,
      "planning-update",
      feature.source_key
    );
    const inserted = await insertRevision(client, {
      feature,
      contributionId,
      sectionKey: "planning_update",
      operation: "replace_section",
      content: params.update,
      role: "planning",
      runId: params.runId,
      attempt: null,
    });
    if (inserted) feature = await refreshCanonicalArtifact(client, feature, params.runId, "planning");
    await recordRunEvent(
      params.runId,
      "active_feature_selected",
      { featureId: feature.id, featureCode: feature.feature_code, sourceKey: feature.source_key },
      client
    );
    await client.query("commit");
    return feature;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistActiveFeatureContribution(params: {
  runId: string;
  phaseFinishedEventId: string | number;
  role: "developer" | "qa";
  attempt: number;
  contribution: Contribution;
}): Promise<FeatureRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const featureResult = await client.query<FeatureRow>(
      `select feature.*
       from runs
       join features feature on feature.id = runs.active_feature_id
       where runs.id = $1 and runs.project_id = feature.project_id
       for update of feature`,
      [params.runId]
    );
    let feature = featureResult.rows[0];
    if (!feature) throw new FeatureLifecycleEscalationError("El run no tiene una Feature activa válida.");
    const contributionId = contributionKey(
      params.runId,
      params.phaseFinishedEventId,
      params.contribution.purpose,
      feature.source_key
    );
    const inserted = await insertRevision(client, {
      feature,
      contributionId,
      sectionKey: params.contribution.sectionKey,
      operation: params.contribution.operation,
      content: params.contribution.content,
      role: params.role,
      runId: params.runId,
      attempt: params.attempt,
    });
    if (inserted) feature = await refreshCanonicalArtifact(client, feature, params.runId, params.role);
    await client.query("commit");
    return feature;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function materializeActiveFeatureDocument(params: {
  runId: string;
  worktreePath: string;
}): Promise<{ feature: FeatureRow; markdown: string; hash: string }> {
  const result = await pool.query<FeatureRow & { artifact_content: unknown }>(
    `select feature.*, artifact.content as artifact_content
     from runs
     join features feature on feature.id = runs.active_feature_id
     join artifacts artifact on artifact.id = feature.canonical_artifact_id
     where runs.id = $1 and runs.project_id = feature.project_id`,
    [params.runId]
  );
  const feature = result.rows[0];
  if (!feature) throw new Error(`Run ${params.runId} sin documento canónico activo.`);
  const content = feature.artifact_content as { document?: unknown };
  if (typeof content?.document !== "string") throw new Error("Artifact canónico sin Markdown.");
  const markdown = normalizeLf(content.document);
  const target = path.resolve(params.worktreePath, feature.final_document_path);
  const root = path.resolve(params.worktreePath);
  if (!target.startsWith(root + path.sep)) throw new Error("Ruta documental fuera del worktree.");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, markdown, { encoding: "utf8", flag: feature.document_hash ? "w" : "wx" });
  const hash = sha256(markdown);
  await pool.query(
    "update features set document_hash = $1, updated_at = now() where id = $2",
    [hash, feature.id]
  );
  feature.document_hash = hash;
  return { feature, markdown, hash };
}

export async function recordFeatureCommit(params: {
  featureId: string;
  commitSha: string;
  documentHash: string;
}): Promise<void> {
  const result = await pool.query(
    `update features
     set final_commit_sha = $1, updated_at = now()
     where id = $2 and document_hash = $3`,
    [params.commitSha, params.featureId, params.documentHash]
  );
  if (result.rowCount !== 1) throw new Error("No se pudo correlacionar commit y hash del documento.");
}

export async function recordFeaturePush(params: {
  featureId: string;
  branch: string;
  commitSha: string;
}): Promise<void> {
  const result = await pool.query(
    `update features
     set pushed_branch = $1, pushed_at = now(), updated_at = now()
     where id = $2 and final_commit_sha = $3`,
    [params.branch, params.featureId, params.commitSha]
  );
  if (result.rowCount !== 1) throw new Error("No se pudo correlacionar push y commit de la Feature.");
}

export interface FeatureDocumentView {
  featureId: string;
  featureCode: string;
  name: string;
  publicationState: "not_materialized" | "materialized" | "committed" | "pushed";
  path: string;
  commitSha: string | null;
  canonicalArtifactId: string;
  approvalMode: "manual" | "auto";
  humanMergeAuthorization: "pending" | "not_required" | "approved" | "rejected";
  markdown: string | null;
  complete: boolean;
  reason: "CONTENT_TOO_LARGE" | null;
}

export async function getFeatureDocumentForRun(runId: string): Promise<FeatureDocumentView | null> {
  const result = await pool.query<FeatureRow & { run_status: string; artifact_content: unknown }>(
    `select feature.*, runs.status as run_status, artifact.content as artifact_content
     from runs
     join features feature on feature.id = runs.active_feature_id
     join artifacts artifact on artifact.id = feature.canonical_artifact_id
     where runs.id = $1 and runs.project_id = feature.project_id`,
    [runId]
  );
  const feature = result.rows[0];
  if (!feature || !feature.canonical_artifact_id) return null;
  const approvalMode = await pinnedApprovalMode(pool, runId);
  const markdownValue = (feature.artifact_content as { document?: unknown })?.document;
  const markdown = typeof markdownValue === "string" ? markdownValue : "";
  const complete = Buffer.byteLength(JSON.stringify(markdown), "utf8") <= 64 * 1024;
  return {
    featureId: feature.id,
    featureCode: feature.feature_code,
    name: feature.name,
    publicationState: publicationState(feature),
    path: feature.final_document_path,
    commitSha: feature.final_commit_sha,
    canonicalArtifactId: feature.canonical_artifact_id,
    approvalMode,
    humanMergeAuthorization:
      approvalMode === "auto"
        ? "not_required"
        : feature.run_status === "resolved"
          ? "approved"
          : feature.run_status === "aborted"
            ? "rejected"
            : "pending",
    markdown: complete ? markdown : null,
    complete,
    reason: complete ? null : "CONTENT_TOO_LARGE",
  };
}

export async function getApprovalModeForRun(runId: string): Promise<"manual" | "auto"> {
  return pinnedApprovalMode(pool, runId);
}

export async function getActiveFeatureForRun(runId: string): Promise<FeatureRow | null> {
  const result = await pool.query<FeatureRow>(
    `select feature.*
     from runs
     join features feature on feature.id = runs.active_feature_id
     where runs.id = $1 and runs.project_id = feature.project_id`,
    [runId]
  );
  return result.rows[0] ?? null;
}

async function insertRevision(
  client: PoolClient,
  params: {
    feature: FeatureRow;
    contributionId: string;
    sectionKey: string;
    operation: FeatureRevisionView["operation"];
    content: unknown;
    role: Exclude<AgentRole, "architect">;
    runId: string;
    attempt: number | null;
  }
): Promise<boolean> {
  const sequence = await client.query<{ next_sequence: string }>(
    "select (coalesce(max(sequence), 0) + 1)::text as next_sequence from feature_revisions where feature_id = $1",
    [params.feature.id]
  );
  const sourceEventKey = `${params.contributionId}:${params.sectionKey}`;
  const result = await client.query(
    `insert into feature_revisions (
       feature_id, sequence, contribution_id, source_event_key, section_key, operation,
       content, producer_role, producer_run_id, attempt
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (feature_id, source_event_key) do nothing`,
    [
      params.feature.id,
      Number(sequence.rows[0].next_sequence),
      params.contributionId,
      sourceEventKey,
      params.sectionKey,
      params.operation,
      params.content,
      params.role,
      params.runId,
      params.attempt,
    ]
  );
  return result.rowCount === 1;
}

async function refreshCanonicalArtifact(
  client: PoolClient,
  feature: FeatureRow,
  runId: string,
  phase: Exclude<AgentRole, "architect">
): Promise<FeatureRow> {
  const revisions = await client.query<FeatureRevisionView>(
    `select sequence, section_key, operation, content, producer_role, attempt
     from feature_revisions where feature_id = $1 order by sequence`,
    [feature.id]
  );
  const approvalMode = await pinnedApprovalMode(client, runId);
  const projection = renderFeatureDocument(feature, revisions.rows, approvalMode);
  const artifact = await recordArtifact({
    runId,
    phase,
    kind: "feature_document",
    content: {
      summary: projection.summary,
      featureId: feature.id,
      featureCode: feature.feature_code,
      templateKey: feature.template_key,
      templateVersion: feature.template_version,
      revisionSequence: projection.revisionSequence,
      document: projection.markdown,
    },
    client,
  });
  const updated = await client.query<FeatureRow>(
    "update features set canonical_artifact_id = $1, updated_at = now() where id = $2 returning *",
    [artifact.id, feature.id]
  );
  await recordRunEvent(
    runId,
    "feature_document_revised",
    { featureId: feature.id, artifactId: artifact.id, revisionSequence: projection.revisionSequence },
    client
  );
  return updated.rows[0];
}

async function latestRevisionContent(
  client: PoolClient,
  featureId: string,
  sectionKey: string
): Promise<unknown | null> {
  const result = await client.query<{ content: unknown }>(
    `select content from feature_revisions
     where feature_id = $1 and section_key = $2
     order by sequence desc limit 1`,
    [featureId, sectionKey]
  );
  return result.rows[0]?.content ?? null;
}

async function assertRunProjectAndPinnedRelease(
  client: PoolClient,
  runId: string,
  projectId: string,
  releaseKey: string
): Promise<void> {
  const run = await client.query<{ project_id: string | null }>(
    "select project_id from runs where id = $1",
    [runId]
  );
  if (run.rows[0]?.project_id !== projectId) throw new Error("Run y proyecto no coinciden.");
  const roadmap = await pinnedConfig(client, runId, "release_roadmap");
  const activeReleaseId = (roadmap as { activeReleaseId?: unknown } | null)?.activeReleaseId;
  if (activeReleaseId !== releaseKey) {
    throw new FeatureLifecycleEscalationError("El release activo cambió respecto del snapshot del run.");
  }
}

async function pinnedApprovalMode(
  db: PoolClient | typeof pool,
  runId: string
): Promise<"manual" | "auto"> {
  const value = await pinnedConfig(db, runId, "approval_mode");
  return (value as { mode?: unknown } | null)?.mode === "auto" ? "auto" : "manual";
}

async function pinnedConfig(
  db: PoolClient | typeof pool,
  runId: string,
  key: string
): Promise<unknown | null> {
  const result = await db.query<{ value: unknown }>(
    `select config.value
     from run_config_versions pinned
     join project_config_versions config on config.id = pinned.config_version_id
     where pinned.run_id = $1 and config.config_key = $2
     order by config.valid_from desc limit 1`,
    [runId, key]
  );
  return result.rows[0]?.value ?? null;
}

async function existingFeatureNames(worktreePath: string): Promise<string[]> {
  const directory = path.join(worktreePath, "docs", "features");
  try {
    return (await readdir(directory))
      .filter((name) => /^FEATURE-\d{3,}-.+\.md$/i.test(name))
      .map((name) => `docs/features/${name}`);
  } catch {
    return [];
  }
}

function maximumFeatureNumber(values: string[]): number {
  return values.reduce((maximum, value) => {
    const match = value.match(/FEATURE-(\d{3,})/i);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function contributionKey(
  runId: string,
  phaseFinishedEventId: string | number,
  purpose: Contribution["purpose"] | "functional-definition" | "planning-update",
  sourceKey: string
): string {
  return `${runId}:event:${phaseFinishedEventId}:${purpose}:${sourceKey}`;
}

function publicationState(feature: FeatureRow): FeatureDocumentView["publicationState"] {
  if (feature.pushed_at) return "pushed";
  if (feature.final_commit_sha) return "committed";
  if (feature.document_hash) return "materialized";
  return "not_materialized";
}
