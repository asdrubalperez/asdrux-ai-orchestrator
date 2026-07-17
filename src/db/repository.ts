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
  current_phase: string | null;
  status: string;
  branch_name: string | null;
  worktree_path: string | null;
  created_at: string;
  updated_at: string;
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
  firstPhase: string;
  branchName: string;
  worktreePath: string;
}): Promise<RunRow> {
  const result = await pool.query<RunRow>(
    `insert into runs (id, pipeline_definition_id, owner_id, current_phase, status, branch_name, worktree_path)
     values ($1, $2, $3, $4, 'running', $5, $6)
     returning *`,
    [params.id, params.pipelineDefinitionId, params.ownerId, params.firstPhase, params.branchName, params.worktreePath]
  );
  return result.rows[0];
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
