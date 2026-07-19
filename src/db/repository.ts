import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import type { PhaseResult } from "../contracts/executor.js";
import type { PipelineSpec } from "../pipelines/definitions.js";

export interface PipelineDefinitionRow {
  id: string;
  name: string;
  version: number;
}

export interface RunRow {
  id: string;
  pipeline_definition_id: string;
  owner_id: string;
  project_id: string | null;
  current_phase: string | null;
  status: string;
  branch_name: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  handle: string;
  password_hash: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  repo_path: string;
  owner_id: string;
  created_at: string;
}

/**
 * Busca o crea la fila de `pipeline_definitions` para un `PipelineSpec` dado. La secuencia de
 * fases vive como datos (JSONB), no hardcodeada — este repositorio es agnóstico de qué pipeline
 * concreto se le pase (FEATURE-004, Regla Funcional 2).
 */
export async function ensurePipelineDefinition(spec: PipelineSpec): Promise<PipelineDefinitionRow> {
  const existing = await pool.query<PipelineDefinitionRow>(
    "select id, name, version from pipeline_definitions where name = $1 and version = $2",
    [spec.name, spec.version]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pool.query<PipelineDefinitionRow>(
    `insert into pipeline_definitions (name, version, definition)
     values ($1, $2, $3)
     returning id, name, version`,
    [spec.name, spec.version, spec.definition]
  );
  return inserted.rows[0];
}

export async function createRun(params: {
  id: string;
  pipelineDefinitionId: string;
  ownerId: string;
  projectId: string;
  firstPhase: string;
  branchName: string;
  worktreePath: string;
}): Promise<RunRow> {
  const result = await pool.query<RunRow>(
    `insert into runs (id, pipeline_definition_id, owner_id, project_id, current_phase, status, branch_name, worktree_path)
     values ($1, $2, $3, $4, $5, 'running', $6, $7)
     returning *`,
    [
      params.id,
      params.pipelineDefinitionId,
      params.ownerId,
      params.projectId,
      params.firstPhase,
      params.branchName,
      params.worktreePath,
    ]
  );
  return result.rows[0];
}

export async function findUserByHandle(handle: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>("select * from users where handle = $1", [handle]);
  return result.rows[0] ?? null;
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>("select * from users where id = $1", [userId]);
  return result.rows[0] ?? null;
}

export async function upsertUserPassword(handle: string, passwordHash: string): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `insert into users (handle, password_hash)
     values ($1, $2)
     on conflict (handle) do update set password_hash = excluded.password_hash
     returning *`,
    [handle, passwordHash]
  );
  return result.rows[0];
}

export async function getProjectForUser(userId: string, projectId?: string): Promise<ProjectRow | null> {
  const result = projectId
    ? await pool.query<ProjectRow>("select * from projects where id = $1 and owner_id = $2", [projectId, userId])
    : await pool.query<ProjectRow>(
        "select * from projects where owner_id = $1 order by created_at asc, name asc limit 1",
        [userId]
      );
  return result.rows[0] ?? null;
}

export async function updateRunCurrentPhase(runId: string, phase: string): Promise<void> {
  await pool.query("update runs set current_phase = $1, updated_at = now() where id = $2", [phase, runId]);
}

export async function recordRunEvent(
  runId: string,
  eventType: string,
  payload: unknown,
  client?: PoolClient
): Promise<void> {
  const db = client ?? pool;
  await db.query("insert into run_events (run_id, event_type, payload) values ($1, $2, $3)", [
    runId,
    eventType,
    payload,
  ]);
}

export async function recordArtifact(params: {
  runId: string;
  phase: string;
  kind: string;
  content: unknown;
}): Promise<void> {
  await pool.query(
    "insert into artifacts (run_id, phase, kind, content) values ($1, $2, $3, $4)",
    [params.runId, params.phase, params.kind, params.content]
  );
}

export async function finalizeRun(runId: string, result: PhaseResult): Promise<void> {
  const status = result.status === "escalated" ? "escalated" : result.status === "completed" ? "completed" : "failed";
  await pool.query("update runs set status = $1, updated_at = now() where id = $2", [status, runId]);
}

export async function getRunDetail(runId: string) {
  const run = await pool.query<RunRow>("select * from runs where id = $1", [runId]);
  if (!run.rows[0]) return null;

  const events = await pool.query(
    "select id, event_type, payload, created_at from run_events where run_id = $1 order by id asc",
    [runId]
  );
  const artifacts = await pool.query(
    "select id, phase, kind, content, created_at from artifacts where run_id = $1 order by created_at asc",
    [runId]
  );

  return { run: run.rows[0], events: events.rows, artifacts: artifacts.rows };
}

export async function getRunDetailForUser(runId: string, userId: string) {
  const detail = await getRunDetail(runId);
  if (!detail || detail.run.owner_id !== userId) return null;
  return detail;
}
