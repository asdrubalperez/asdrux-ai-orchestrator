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
  /**
   * FEATURE-020, Regla 1: resuelto una única vez al crear el run — self si es raíz, heredado del
   * padre si no. NULL para runs creados antes de esta Feature (sin backfill, Regla 13).
   */
  root_run_id: string | null;
  active_feature_id: string | null;
  business_case: unknown;
  /**
   * FEATURE-043, sección 5.8: rama base de trabajo solicitada/confirmada para el caso -- distinta
   * de `branch_name` (rama efectiva del worktree/checkout). NULL para runs históricos (sin
   * backfill) o para runs creados fuera del flujo de proyecto (`run:start --case`, que sigue
   * resolviendo la rama desde el JSON crudo del caso).
   */
  base_branch_name: string | null;
  created_at: string;
  updated_at: string;
}

export type IntakeFieldType = "text" | "textarea" | "select" | "list";

export interface IntakeFieldDefinitionRow {
  id: string;
  field_key: string;
  field_order: number;
  label: string;
  description: string;
  field_type: IntakeFieldType;
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

// FEATURE-042: repository_* son los campos canónicos del repositorio GitHub del proyecto (sección
// A.1/A.2 del diseño aprobado) -- nullable porque un proyecto puede crearse sin repositorio.
// `repo_path` se conserva nullable por compatibilidad con el comando CLI legacy
// (`run:start --case`, cleanupStrategy "shared-worktree") -- el flujo web no la usa.
export type GitHubRepositoryVisibility = "public" | "private" | "internal";

export interface ProjectRow {
  id: string;
  name: string;
  repo_path: string | null;
  owner_id: string;
  repository_provider: "github" | null;
  repository_external_id: string | null;
  repository_owner: string | null;
  repository_name: string | null;
  repository_full_name: string | null;
  repository_clone_url: string | null;
  repository_visibility: GitHubRepositoryVisibility | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectConfigVersionRow {
  id: string;
  project_id: string;
  config_key: string;
  value: unknown;
  valid_from: string;
  valid_to: string | null;
}

export interface ReleasePlanByReleaseRow {
  release_id: string;
  value: unknown;
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
  const rootRunId = await resolveRootRunId(db, params.id, params.originatedFromRunId ?? null);
  const result = await db.query<RunRow>(
    `insert into runs (
       id, pipeline_definition_id, owner_id, project_id, current_phase, status,
       branch_name, worktree_path, originated_from_run_id, root_run_id
     )
     values ($1, $2, $3, $4, $5, 'running', $6, $7, $8, $9)
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
      rootRunId,
    ]
  );
  return result.rows[0];
}

/**
 * FEATURE-020, Regla 1: self si es raíz (sin `originatedFromRunId`), o el `root_run_id` ya
 * persistido del padre si no — nunca se camina la cadena completa, una sola lectura.
 */
async function resolveRootRunId(
  db: PoolClient | typeof pool,
  id: string,
  originatedFromRunId: string | null
): Promise<string> {
  if (!originatedFromRunId) return id;
  const parent = await db.query<{ root_run_id: string | null }>("select root_run_id from runs where id = $1", [
    originatedFromRunId,
  ]);
  return parent.rows[0]?.root_run_id ?? originatedFromRunId;
}

/**
 * FEATURE-017: crea un run en estado `sin_iniciar` — el caso ya mapeado/confirmado, sin worktree,
 * sin branch, sin invocación al Architect todavía (recién ocurre al apretar Iniciar). No reusa
 * `createRun` porque esa función exige `branchName`/`worktreePath` como parámetros requeridos
 * (no solo columnas DB nullable) — ver sección 7.2 del documento de la Feature.
 */
export async function createRunPendingStart(params: {
  id: string;
  pipelineDefinitionId: string;
  ownerId: string;
  projectId: string;
  businessCase: unknown;
  /** FEATURE-043, sección 7.4: rama base confirmada, persistida fuera de `business_case`. */
  baseBranchName?: string | null;
  client?: PoolClient;
}): Promise<RunRow> {
  const db = params.client ?? pool;
  // FEATURE-020, Regla 1: siempre raíz (createRunPendingStart no tiene originated_from_run_id).
  const result = await db.query<RunRow>(
    `insert into runs (
       id, pipeline_definition_id, owner_id, project_id, status, business_case, root_run_id,
       base_branch_name
     )
     values ($1, $2, $3, $4, 'sin_iniciar', $5, $1, $6)
     returning *`,
    [
      params.id,
      params.pipelineDefinitionId,
      params.ownerId,
      params.projectId,
      params.businessCase,
      params.baseBranchName ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * FEATURE-017: transición `sin_iniciar -> running` (botón Iniciar). Update condicional
 * (`where status = 'sin_iniciar'`), mismo patrón atómico que `resolveEscalatedRunStatus`, para
 * evitar arrancar el mismo run dos veces por una carrera.
 */
export async function promoteRunToRunning(params: {
  runId: string;
  firstPhase: string;
  branchName: string;
  worktreePath: string;
  client?: PoolClient;
}): Promise<RunRow | null> {
  const db = params.client ?? pool;
  const result = await db.query<RunRow>(
    `update runs
     set status = 'running', current_phase = $2, branch_name = $3, worktree_path = $4, updated_at = now()
     where id = $1 and status = 'sin_iniciar'
     returning *`,
    [params.runId, params.firstPhase, params.branchName, params.worktreePath]
  );
  return result.rows[0] ?? null;
}

export interface RootRunExecutionContext {
  businessCase: unknown;
  /** FEATURE-043, sección 7.6: rama base persistida del run raíz -- null si no tiene o es legacy. */
  baseBranchName: string | null;
}

/**
 * FEATURE-020, sección 6.1 / FEATURE-043, sección 7.6: resuelve el `business_case` y la
 * `base_branch_name` del run raíz de cualquier run de la cadena vía su `root_run_id` (una sola
 * consulta indexada, sin recursión ni CTE). Reemplaza la consulta que antes hacía
 * `getBusinessCaseForRun` en solitario -- evita mantener dos lecturas independientes sobre el mismo
 * run raíz (Riesgo 9 del diseño de FEATURE-043). Devuelve valores `null` para runs preexistentes
 * sin `root_run_id` (degradación aceptada, Regla 13) o si el root no tiene los datos persistidos.
 */
export async function getRootRunExecutionContext(runId: string, client?: PoolClient): Promise<RootRunExecutionContext> {
  const db = client ?? pool;
  const result = await db.query<{ business_case: unknown; base_branch_name: string | null }>(
    `select r.business_case, r.base_branch_name
     from runs r
     where r.id = (select root_run_id from runs where id = $1)`,
    [runId]
  );
  return {
    businessCase: result.rows[0]?.business_case ?? null,
    baseBranchName: result.rows[0]?.base_branch_name ?? null,
  };
}

/** Compatibilidad: mismo contrato que antes de FEATURE-043, ahora delegando en la consulta única. */
export async function getBusinessCaseForRun(runId: string): Promise<unknown> {
  return (await getRootRunExecutionContext(runId)).businessCase;
}

/** FEATURE-017: chequeo pre-fase de cancelación externa — ver runStart.ts, executePipelineRun. */
export async function getRunStatus(runId: string): Promise<string | null> {
  const result = await pool.query<Pick<RunRow, "status">>("select status from runs where id = $1", [runId]);
  return result.rows[0]?.status ?? null;
}

/**
 * FEATURE-017: transición `running -> escalated` forzada por el usuario (Cancelar), no por el
 * agente. Update condicional (`where owner_id = $2 and status = 'running'`) — verifica ownership
 * y evita forzar un run que ya no está `running`. El motivo se registra aparte, vía
 * `recordRunEvent`, para que `buildEscalationBanner()` pueda distinguirlo del escalamiento por
 * agente (ver src/server/runView.ts).
 */
export async function forceUserEscalation(runId: string, userId: string): Promise<RunRow | null> {
  const result = await pool.query<RunRow>(
    `update runs set status = 'escalated', updated_at = now()
     where id = $1 and owner_id = $2 and status = 'running'
     returning *`,
    [runId, userId]
  );
  return result.rows[0] ?? null;
}

/** FEATURE-017: lista mínima de "mis casos" — exclusivamente los del usuario autenticado. */
export async function listRunsForUser(userId: string): Promise<RunRow[]> {
  const result = await pool.query<RunRow>("select * from runs where owner_id = $1 order by created_at desc", [
    userId,
  ]);
  return result.rows;
}

/** FEATURE-017: definición vigente de los 12 campos del intake, en orden de exhibición. */
export async function getIntakeFieldDefinitions(): Promise<IntakeFieldDefinitionRow[]> {
  const result = await pool.query<IntakeFieldDefinitionRow>(
    `select id, field_key, field_order, label, description, field_type, updated_at
     from intake_field_definitions
     order by field_order asc`
  );
  return result.rows;
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
  /**
   * FEATURE-018: cuando se pasa, la escritura participa de la transacción del llamador (mismo
   * patrón que getCurrentProjectConfigs/createRun) — no abre ni cierra su propia transacción.
   * Necesario para que la aprobación de un Roadmap de Releases (respondService.ts) persista la
   * nueva versión y cree el child run en una única transacción atómica real.
   */
  client?: PoolClient;
}): Promise<ProjectConfigVersionRow> {
  if (params.client) {
    return writeProjectConfigVersion(params.client, params);
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await writeProjectConfigVersion(client, params);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function writeProjectConfigVersion(
  client: PoolClient,
  params: {
    projectId: string;
    configKey: string;
    value: unknown;
    changedByUserId?: string;
    changedInRunId?: string;
    changeReason?: string;
  }
): Promise<ProjectConfigVersionRow> {
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
  return inserted.rows[0];
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

/**
 * Recupera la última versión del Release Plan asociada a cada release. El JSONB no contiene
 * releaseId: la asociación se resuelve mediante el roadmap fijado para el run que escribió el plan.
 *
 * Corrección de bug (hallazgo de validación E2E de FEATURE-036, 2026-07-30): antes de este cambio,
 * la consulta agrupaba por el valor literal de `activeReleaseId` (ej. "r1", "r2") sobre *todo* el
 * historial del proyecto, sin filtrar por vigencia ni por a qué ciclo de negocio pertenecía cada
 * versión. Como el mismo proyecto se reutiliza entre casos de negocio no relacionados (FEATURE-030,
 * sin resolver todavía) y Architect/Planning nombran los releases siempre con los mismos IDs
 * genéricos, historial de un ciclo de negocio completamente distinto podía colarse en la vista del
 * ciclo actual. Se acota ahora al mismo `root_run_id` (raíz del ciclo de negocio) que el run que
 * escribió el `release_roadmap` actualmente vigente — runs de un ciclo anterior, aunque reusen los
 * mismos IDs literales, quedan excluidos porque pertenecen a un `root_run_id` distinto.
 */
export async function getReleasePlansByRelease(projectId: string): Promise<ReleasePlanByReleaseRow[]> {
  const result = await pool.query<ReleasePlanByReleaseRow>(
    `with current_epoch as (
       select coalesce(r.root_run_id, r.id) as root_run_id
       from project_config_versions roadmap
       join runs r on r.id = roadmap.changed_in_run_id
       where roadmap.project_id = $1
         and roadmap.config_key = 'release_roadmap'
         and roadmap.valid_to is null
       limit 1
     )
     select distinct on (roadmap.value ->> 'activeReleaseId')
       roadmap.value ->> 'activeReleaseId' as release_id,
       plan.value
     from project_config_versions plan
     join run_config_versions pinned on pinned.run_id = plan.changed_in_run_id
     join project_config_versions roadmap
       on roadmap.id = pinned.config_version_id
      and roadmap.config_key = 'release_roadmap'
     join runs plan_run on plan_run.id = plan.changed_in_run_id
     join current_epoch on coalesce(plan_run.root_run_id, plan_run.id) = current_epoch.root_run_id
     where plan.project_id = $1
       and plan.config_key = 'release_plan'
       and roadmap.value ->> 'activeReleaseId' is not null
     order by roadmap.value ->> 'activeReleaseId', plan.valid_from desc`,
    [projectId]
  );
  return result.rows;
}

/**
 * FEATURE-028: candidato para decidir si el `release_plan` vigente corresponde al release
 * actualmente activo. Trae, en una sola consulta, tanto el `activeReleaseId` que tenía pinneado el
 * roadmap del run que escribió ese plan como el `root_run_id` de ese mismo run y el del ciclo de
 * negocio vigente (mismo CTE `current_epoch` que `getReleasePlansByRelease`) — la comparación en sí
 * la hace `resolveReleasePlanForActiveRelease` (función pura en `runStart.ts`), no esta consulta:
 * acá solo se resuelven los datos persistidos, sin decidir nada.
 */
export interface ReleasePlanAssociationCandidate {
  value: unknown;
  pinnedActiveReleaseId: string | null;
  writerRootRunId: string;
  currentEpochRootRunId: string;
}

export async function getReleasePlanAssociationCandidate(
  projectId: string
): Promise<ReleasePlanAssociationCandidate | null> {
  const result = await pool.query<{
    value: unknown;
    pinned_active_release_id: string | null;
    writer_root_run_id: string;
    current_epoch_root_run_id: string;
  }>(
    `with current_epoch as (
       select coalesce(r.root_run_id, r.id) as root_run_id
       from project_config_versions roadmap
       join runs r on r.id = roadmap.changed_in_run_id
       where roadmap.project_id = $1
         and roadmap.config_key = 'release_roadmap'
         and roadmap.valid_to is null
       limit 1
     )
     select plan.value,
       roadmap.value ->> 'activeReleaseId' as pinned_active_release_id,
       coalesce(plan_run.root_run_id, plan_run.id) as writer_root_run_id,
       current_epoch.root_run_id as current_epoch_root_run_id
     from project_config_versions plan
     join run_config_versions pinned on pinned.run_id = plan.changed_in_run_id
     join project_config_versions roadmap
       on roadmap.id = pinned.config_version_id
      and roadmap.config_key = 'release_roadmap'
     join runs plan_run on plan_run.id = plan.changed_in_run_id
     cross join current_epoch
     where plan.project_id = $1
       and plan.config_key = 'release_plan'
       and plan.valid_to is null
     limit 1`,
    [projectId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    value: row.value,
    pinnedActiveReleaseId: row.pinned_active_release_id,
    writerRootRunId: row.writer_root_run_id,
    currentEpochRootRunId: row.current_epoch_root_run_id,
  };
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

// FEATURE-042: CRUD de proyectos (sección B del diseño aprobado). `getProjectForUser` de arriba
// se deja intacta -- la sigue usando el comando CLI legacy (`run:start --case`, ver
// migrations/0016) con su fallback al proyecto más antiguo. Las funciones nuevas de acá abajo NO
// tienen fallback: `projectId` siempre explícito, ausencia = error de contrato del cliente.

export class DuplicateProjectError extends Error {}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export async function listProjectsForUser(userId: string): Promise<ProjectRow[]> {
  const result = await pool.query<ProjectRow>(
    "select * from projects where owner_id = $1 order by updated_at desc, name asc",
    [userId]
  );
  return result.rows;
}

export async function getProjectByIdForUser(projectId: string, userId: string): Promise<ProjectRow | null> {
  const result = await pool.query<ProjectRow>("select * from projects where id = $1 and owner_id = $2", [
    projectId,
    userId,
  ]);
  return result.rows[0] ?? null;
}

export async function createProject(params: { ownerId: string; name: string }): Promise<ProjectRow> {
  try {
    const result = await pool.query<ProjectRow>(
      "insert into projects (name, owner_id) values ($1, $2) returning *",
      [params.name, params.ownerId]
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateProjectError("Ya existe un proyecto con ese nombre.");
    }
    throw err;
  }
}

export async function updateProjectName(params: {
  projectId: string;
  ownerId: string;
  name: string;
}): Promise<ProjectRow | null> {
  try {
    const result = await pool.query<ProjectRow>(
      "update projects set name = $3, updated_at = now() where id = $1 and owner_id = $2 returning *",
      [params.projectId, params.ownerId, params.name]
    );
    return result.rows[0] ?? null;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateProjectError("Ya existe un proyecto con ese nombre.");
    }
    throw err;
  }
}

export interface CanonicalGitHubRepository {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: GitHubRepositoryVisibility;
}

export async function setProjectRepository(params: {
  projectId: string;
  ownerId: string;
  repository: CanonicalGitHubRepository;
}): Promise<ProjectRow | null> {
  try {
    const result = await pool.query<ProjectRow>(
      `update projects
       set repository_provider = 'github',
           repository_external_id = $3,
           repository_owner = $4,
           repository_name = $5,
           repository_full_name = $6,
           repository_clone_url = $7,
           repository_visibility = $8,
           updated_at = now()
       where id = $1 and owner_id = $2
       returning *`,
      [
        params.projectId,
        params.ownerId,
        params.repository.externalId,
        params.repository.owner,
        params.repository.name,
        params.repository.fullName,
        params.repository.cloneUrl,
        params.repository.visibility,
      ]
    );
    return result.rows[0] ?? null;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateProjectError("Ya existe un proyecto tuyo con ese nombre sobre ese repositorio.");
    }
    throw err;
  }
}

// Regla C.6/B.6: preferencia de navegación -- nunca sustituye al projectId explícito de cada
// operación de casos. Valida ownership antes de persistir (nunca selecciona un proyecto ajeno).
export async function selectProjectForUser(params: { userId: string; projectId: string }): Promise<boolean> {
  const result = await pool.query(
    `update users
     set last_selected_project_id = $2
     where id = $1
       and exists (select 1 from projects where id = $2 and owner_id = $1)`,
    [params.userId, params.projectId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Sección C.3: gate posterior al login. Devuelve null si no hay preferencia o si dejó de ser
// válida (proyecto ajeno/eliminado) -- el ON DELETE SET NULL de la FK ya cubre el caso de
// eliminación; este chequeo de ownership cubre a mayores cualquier inconsistencia.
export async function getLastSelectedProjectForUser(userId: string): Promise<ProjectRow | null> {
  const result = await pool.query<ProjectRow>(
    `select p.* from projects p
     join users u on u.last_selected_project_id = p.id
     where u.id = $1 and p.owner_id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

// Sección B.7: filtra simultáneamente por proyecto y owner -- nunca se usa listRunsForUser(userId)
// como fuente de esta pantalla.
export async function listRunsForProjectAndUser(projectId: string, userId: string): Promise<RunRow[]> {
  const result = await pool.query<RunRow>(
    "select * from runs where project_id = $1 and owner_id = $2 order by created_at desc",
    [projectId, userId]
  );
  return result.rows;
}

export async function updateRunCurrentPhase(runId: string, phase: string): Promise<void> {
  await pool.query("update runs set current_phase = $1, updated_at = now() where id = $2", [phase, runId]);
}

/**
 * "resolved" agregado por la corrección del runtime de circuitos: marca el run padre como resuelto
 * cuando un reingreso automático a Architect (sin humano) lo reemplaza por un run hijo
 * FULL_PIPELINE — mismo valor terminal que ya usa `resolveEscalatedRunStatus` para el reingreso
 * humano, pero acá el run padre nunca llegó a estar `escalated` (se intercepta antes), así que no
 * puede reusarse esa función (exige status='escalated' en el WHERE).
 */
export async function updateRunStatus(
  runId: string,
  status: "running" | "retrying" | "resolved"
): Promise<void> {
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
): Promise<string> {
  const db = client ?? pool;
  const result = await db.query<{ id: string | number }>(
    "insert into run_events (run_id, event_type, payload) values ($1, $2, $3) returning id",
    [runId, eventType, payload]
  );
  return String(result.rows[0].id);
}

export async function recordArtifact(params: {
  runId: string;
  phase: string;
  kind: string;
  content: unknown;
  client?: PoolClient;
}): Promise<ArtifactRow> {
  const db = params.client ?? pool;
  const result = await db.query<ArtifactRow>(
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

// FEATURE-026: conexión GitHub por usuario (migrations/0015_user_git_connections.sql).

export type GitConnectionProvider = "github";
export type GitConnectionStatus = "connected" | "invalid" | "revoked";

export interface UserGitConnectionRow {
  id: string;
  user_id: string;
  provider: GitConnectionProvider;
  external_user_id: string;
  external_login: string;
  access_token_ciphertext: string;
  granted_scopes: string[];
  status: GitConnectionStatus;
  connected_at: string;
  last_validated_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getGitConnectionForUser(
  userId: string,
  provider: GitConnectionProvider = "github"
): Promise<UserGitConnectionRow | null> {
  const result = await pool.query<UserGitConnectionRow>(
    "select * from user_git_connections where user_id = $1 and provider = $2",
    [userId, provider]
  );
  return result.rows[0] ?? null;
}

// Regla 3: soporta el chequeo de "esta identidad de GitHub ya pertenece a otro usuario".
export async function getGitConnectionByExternalIdentity(
  provider: GitConnectionProvider,
  externalUserId: string
): Promise<UserGitConnectionRow | null> {
  const result = await pool.query<UserGitConnectionRow>(
    "select * from user_git_connections where provider = $1 and external_user_id = $2",
    [provider, externalUserId]
  );
  return result.rows[0] ?? null;
}

// Regla 30: misma identidad externa reconectando -- reemplaza el token, conserva la fila.
// Cuenta nueva (identidad externa distinta): reemplaza igual, porque Regla 2 exige una sola
// conexión activa por (user_id, provider) -- el cambio de cuenta (Reglas 27-30) queda para
// cuando se implemente esa capacidad; esta función solo garantiza la unicidad de base.
export async function upsertGitConnection(params: {
  userId: string;
  provider: GitConnectionProvider;
  externalUserId: string;
  externalLogin: string;
  accessTokenCiphertext: string;
  grantedScopes: string[];
}): Promise<UserGitConnectionRow> {
  const result = await pool.query<UserGitConnectionRow>(
    `insert into user_git_connections
       (user_id, provider, external_user_id, external_login, access_token_ciphertext, granted_scopes,
        status, connected_at, last_validated_at, revoked_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'connected', now(), now(), null, now())
     on conflict (user_id, provider)
     do update set external_user_id = excluded.external_user_id,
                   external_login = excluded.external_login,
                   access_token_ciphertext = excluded.access_token_ciphertext,
                   granted_scopes = excluded.granted_scopes,
                   status = 'connected',
                   connected_at = now(),
                   last_validated_at = now(),
                   revoked_at = null,
                   updated_at = now()
     returning *`,
    [
      params.userId,
      params.provider,
      params.externalUserId,
      params.externalLogin,
      params.accessTokenCiphertext,
      params.grantedScopes,
    ]
  );
  return result.rows[0];
}

// Regla 18/23/24: transición de estado sin fallback -- 'invalid' ante rechazo de GitHub,
// 'revoked' ante desconexión explícita del usuario.
export async function markGitConnectionStatus(
  userId: string,
  provider: GitConnectionProvider,
  status: GitConnectionStatus
): Promise<void> {
  await pool.query(
    `update user_git_connections
     set status = $3,
         revoked_at = case when $3 = 'revoked' then now() else revoked_at end,
         updated_at = now()
     where user_id = $1 and provider = $2`,
    [userId, provider, status]
  );
}

export interface OAuthStateRow {
  id: string;
  user_id: string;
  session_id: string;
  provider: GitConnectionProvider;
  state_hash: string;
  return_path: string | null;
  // FEATURE-042 (migrations/0017): origen del frontend que inició el flujo -- producción o un
  // preview de Vercel -- necesario para que el callback sepa a dónde redirigir de vuelta.
  frontend_origin: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export async function createOAuthState(params: {
  userId: string;
  sessionId: string;
  provider: GitConnectionProvider;
  stateHash: string;
  returnPath: string | null;
  frontendOrigin: string;
  expiresAt: Date;
}): Promise<OAuthStateRow> {
  const result = await pool.query<OAuthStateRow>(
    `insert into oauth_states (user_id, session_id, provider, state_hash, return_path, frontend_origin, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      params.userId,
      params.sessionId,
      params.provider,
      params.stateHash,
      params.returnPath,
      params.frontendOrigin,
      params.expiresAt,
    ]
  );
  return result.rows[0];
}

/**
 * Regla 11: consumo atómico y de un solo uso -- el UPDATE...WHERE...RETURNING es la propia
 * garantía de atomicidad (dos requests concurrentes con el mismo state_hash: como mucho uno
 * obtiene una fila de vuelta, porque el segundo ya no matchea `consumed_at is null`).
 */
export async function consumeOAuthState(stateHash: string): Promise<OAuthStateRow | null> {
  const result = await pool.query<OAuthStateRow>(
    `update oauth_states
     set consumed_at = now()
     where state_hash = $1 and consumed_at is null and expires_at > now()
     returning *`,
    [stateHash]
  );
  return result.rows[0] ?? null;
}
