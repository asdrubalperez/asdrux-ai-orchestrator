import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import type { AgentRole, PhaseResult } from "../contracts/executor.js";
import type { PipelineSpec } from "../pipelines/definitions.js";

export interface PipelineDefinitionRow {
  id: string;
  name: string;
  version: number;
  definition?: unknown;
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
  originated_from_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  phase: string;
  kind: string;
  content: unknown;
  commit_ref: string | null;
  created_at: string;
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

export interface ProjectConfigVersionRow {
  id: string;
  project_id: string;
  config_key: string;
  value: unknown;
  valid_from: string;
  valid_to: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export type ExecutorProviderName = "claude" | "codex";
export type AuthMode = "api_key" | "cli_session";

export interface AgentConfig {
  executorProvider: ExecutorProviderName;
  authMode: AuthMode;
}

export interface UserAgentConfigRow {
  id: string;
  user_id: string;
  role: AgentRole | null;
  executor_provider: ExecutorProviderName;
  auth_mode: AuthMode;
  created_at: string;
  updated_at: string;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = { executorProvider: "claude", authMode: "api_key" };

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

export async function getPipelineDefinitionById(id: string, client?: PoolClient): Promise<PipelineDefinitionRow | null> {
  const db = client ?? pool;
  const result = await db.query<PipelineDefinitionRow>(
    "select id, name, version, definition from pipeline_definitions where id = $1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createRun(params: {
  id: string;
  pipelineDefinitionId: string;
  ownerId: string;
  projectId: string;
  firstPhase: string;
  branchName: string;
  worktreePath: string;
  originatedFromRunId?: string;
  client?: PoolClient;
}): Promise<RunRow> {
  const db = params.client ?? pool;
  const result = await db.query<RunRow>(
    `insert into runs (
       id, pipeline_definition_id, owner_id, project_id, current_phase, status,
       branch_name, worktree_path, originated_from_run_id
     )
     values ($1, $2, $3, $4, $5, 'running', $6, $7, $8)
     returning *`,
    [
      params.id,
      params.pipelineDefinitionId,
      params.ownerId,
      params.projectId,
      params.firstPhase,
      params.branchName,
      params.worktreePath,
      params.originatedFromRunId ?? null,
    ]
  );
  return result.rows[0];
}

export async function getCurrentProjectConfig(
  projectId: string,
  configKey: string
): Promise<ProjectConfigVersionRow | null> {
  const result = await pool.query<ProjectConfigVersionRow>(
    `select id, project_id, config_key, value, valid_from, valid_to
     from project_config_versions
     where project_id = $1 and config_key = $2 and valid_to is null`,
    [projectId, configKey]
  );
  return result.rows[0] ?? null;
}

export async function getCurrentProjectConfigs(
  projectId: string,
  client?: PoolClient
): Promise<ProjectConfigVersionRow[]> {
  const db = client ?? pool;
  const result = await db.query<ProjectConfigVersionRow>(
    `select id, project_id, config_key, value, valid_from, valid_to
     from project_config_versions
     where project_id = $1 and valid_to is null`,
    [projectId]
  );
  return result.rows;
}

export async function setProjectConfig(params: {
  projectId: string;
  configKey: string;
  value: unknown;
  changedByUserId?: string;
  changedInRunId?: string;
  changeReason?: string;
}): Promise<ProjectConfigVersionRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update project_config_versions
       set valid_to = now()
       where project_id = $1 and config_key = $2 and valid_to is null`,
      [params.projectId, params.configKey]
    );
    const inserted = await client.query<ProjectConfigVersionRow>(
      `insert into project_config_versions (
         project_id, config_key, value, changed_by_user_id, changed_in_run_id, change_reason
       )
       values ($1, $2, $3, $4, $5, $6)
       returning id, project_id, config_key, value, valid_from, valid_to`,
      [
        params.projectId,
        params.configKey,
        params.value,
        params.changedByUserId ?? null,
        params.changedInRunId ?? null,
        params.changeReason ?? null,
      ]
    );
    await client.query("commit");
    return inserted.rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function getProjectConfigHistory(
  projectId: string,
  configKey: string
): Promise<ProjectConfigVersionRow[]> {
  const result = await pool.query<ProjectConfigVersionRow>(
    `select id, project_id, config_key, value, valid_from, valid_to
     from project_config_versions
     where project_id = $1 and config_key = $2
     order by valid_from desc`,
    [projectId, configKey]
  );
  return result.rows;
}

// FEATURE-016: preferencia de agente (claude|codex) + authMode (api_key|cli_session) por usuario,
// global (role IS NULL) y con override opcional por rol. Sin versionado a diferencia de
// project_config_versions — ver Scope/Excluido de FEATURE-016 para la justificación.
function toAgentConfig(row: UserAgentConfigRow): AgentConfig {
  return { executorProvider: row.executor_provider, authMode: row.auth_mode };
}

export async function getGlobalAgentConfig(userId: string): Promise<AgentConfig | null> {
  const result = await pool.query<UserAgentConfigRow>(
    `select id, user_id, role, executor_provider, auth_mode, created_at, updated_at
     from user_agent_config
     where user_id = $1 and role is null`,
    [userId]
  );
  return result.rows[0] ? toAgentConfig(result.rows[0]) : null;
}

export async function getRoleAgentConfigOverride(userId: string, role: AgentRole): Promise<AgentConfig | null> {
  const result = await pool.query<UserAgentConfigRow>(
    `select id, user_id, role, executor_provider, auth_mode, created_at, updated_at
     from user_agent_config
     where user_id = $1 and role = $2`,
    [userId, role]
  );
  return result.rows[0] ? toAgentConfig(result.rows[0]) : null;
}

/**
 * Regla 2 de FEATURE-016 (sin el flag de CLI, resuelto antes de llamar a esta función):
 * override de rol -> global -> default (claude + api_key).
 */
export async function resolveAgentConfig(userId: string, role: AgentRole): Promise<AgentConfig> {
  const override = await getRoleAgentConfigOverride(userId, role);
  if (override) return override;
  const global = await getGlobalAgentConfig(userId);
  if (global) return global;
  return DEFAULT_AGENT_CONFIG;
}

export async function setGlobalAgentConfig(userId: string, config: AgentConfig): Promise<AgentConfig> {
  const result = await pool.query<UserAgentConfigRow>(
    `insert into user_agent_config (user_id, role, executor_provider, auth_mode)
     values ($1, null, $2, $3)
     on conflict (user_id) where role is null
     do update set executor_provider = excluded.executor_provider,
                   auth_mode = excluded.auth_mode,
                   updated_at = now()
     returning id, user_id, role, executor_provider, auth_mode, created_at, updated_at`,
    [userId, config.executorProvider, config.authMode]
  );
  return toAgentConfig(result.rows[0]);
}

export async function setRoleAgentConfigOverride(
  userId: string,
  role: AgentRole,
  config: AgentConfig
): Promise<AgentConfig> {
  const result = await pool.query<UserAgentConfigRow>(
    `insert into user_agent_config (user_id, role, executor_provider, auth_mode)
     values ($1, $2, $3, $4)
     on conflict (user_id, role) where role is not null
     do update set executor_provider = excluded.executor_provider,
                   auth_mode = excluded.auth_mode,
                   updated_at = now()
     returning id, user_id, role, executor_provider, auth_mode, created_at, updated_at`,
    [userId, role, config.executorProvider, config.authMode]
  );
  return toAgentConfig(result.rows[0]);
}

export async function recordRunConfigVersions(runId: string, client?: PoolClient): Promise<void> {
  const db = client ?? pool;
  const run = await db.query<Pick<RunRow, "project_id">>("select project_id from runs where id = $1", [runId]);
  if (!run.rows[0]) {
    throw new Error(`Run inexistente: ${runId}`);
  }
  if (run.rows[0].project_id === null) {
    return;
  }

  const configs = await getCurrentProjectConfigs(run.rows[0].project_id, client);
  for (const config of configs) {
    await db.query("insert into run_config_versions (run_id, config_version_id) values ($1, $2)", [
      runId,
      config.id,
    ]);
  }
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

export async function updateRunStatus(runId: string, status: "running" | "retrying"): Promise<void> {
  await pool.query("update runs set status = $1, updated_at = now() where id = $2", [status, runId]);
}

export async function resolveEscalatedRunStatus(
  runId: string,
  status: "aborted" | "resolved",
  client: PoolClient
): Promise<RunRow | null> {
  const result = await client.query<RunRow>(
    "update runs set status = $1, updated_at = now() where id = $2 and status = 'escalated' returning *",
    [status, runId]
  );
  return result.rows[0] ?? null;
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
}): Promise<ArtifactRow> {
  const result = await pool.query<ArtifactRow>(
    "insert into artifacts (run_id, phase, kind, content) values ($1, $2, $3, $4) returning *",
    [params.runId, params.phase, params.kind, params.content]
  );
  return result.rows[0];
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

export async function getRunEventsAfterForUser(runId: string, userId: string, afterEventId: number) {
  const run = await pool.query<Pick<RunRow, "owner_id">>("select owner_id from runs where id = $1", [runId]);
  if (!run.rows[0] || run.rows[0].owner_id !== userId) return null;

  const events = await pool.query(
    "select id, event_type, payload, created_at from run_events where run_id = $1 and id > $2 order by id asc",
    [runId, afterEventId]
  );
  return events.rows;
}

export async function createSessionRow(params: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<SessionRow> {
  const result = await pool.query<SessionRow>(
    `insert into sessions (user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning id, user_id, token_hash, created_at, expires_at, revoked_at`,
    [params.userId, params.tokenHash, params.expiresAt.toISOString()]
  );
  return result.rows[0];
}

export async function getSessionById(sessionId: string): Promise<SessionRow | null> {
  const result = await pool.query<SessionRow>(
    "select id, user_id, token_hash, created_at, expires_at, revoked_at from sessions where id = $1",
    [sessionId]
  );
  return result.rows[0] ?? null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await pool.query("update sessions set revoked_at = now() where id = $1 and revoked_at is null", [sessionId]);
}
