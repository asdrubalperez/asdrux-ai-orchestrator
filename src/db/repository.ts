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

export type AccountRole = "user" | "admin" | "superadmin";
export type AccountStatus = "pending_verification" | "active" | "suspended";

export interface UserRow {
  id: string;
  handle: string;
  password_hash: string | null;
  created_at: string;
  email: string | null;
  display_name: string | null;
  role: AccountRole;
  status: AccountStatus;
  email_verified_at: string | null;
  last_login_at: string | null;
  is_protected_superadmin: boolean;
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
  // FEATURE-041, Regla 5.10: null = Global (config de cuenta); si no-null, referencia un perfil del
  // mismo owner del proyecto (ownership validado en el servicio al setearlo, no solo por la FK).
  agent_config_profile_id: string | null;
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

/**
 * FEATURE-025-Parte-1, sección 6.2: superset de `AgentConfig` con el modelo resuelto. Se mantiene
 * `AgentConfig` intacto (en vez de agregarle `model` directamente) porque el camino de override por
 * CLI (`cliAgentOverride`, Regla 2 de FEATURE-016: nunca consulta la DB) sigue construyéndose como
 * un `AgentConfig` literal a partir de flags -- `EffectiveAgentConfig` es exclusivamente la forma
 * que devuelve la resolución contra `user_agent_config`.
 */
export interface EffectiveAgentConfig extends AgentConfig {
  model: string | null;
}

/**
 * FEATURE-025-Parte-1 (ampliación, 2026-08-02): `"intake"` es el mapeo de texto libre a campos del
 * caso de negocio (`src/intake/mapBusinessCase.ts`) -- no es una fase del pipeline (nunca aparece
 * en `PhaseInvocation`, no tiene Executor propio, no participa del timeline de un run), pero recibe
 * exactamente el mismo tratamiento de configuración que los 5 roles reales: override propio o
 * herencia de la config global, misma resolución, misma credencial propia por usuario. Se modela
 * como un tipo separado de `AgentRole` (que sí gobierna el pipeline real) para no ensuciar ese tipo
 * con un valor que no es una fase invocable.
 */
export type ConfigurableAgentRole = AgentRole | "intake";

export function isConfigurableAgentRole(value: unknown): value is ConfigurableAgentRole {
  return (
    value === "architect" ||
    value === "functional" ||
    value === "planning" ||
    value === "developer" ||
    value === "qa" ||
    value === "intake"
  );
}

export interface UserAgentConfigRow {
  id: string;
  user_id: string;
  profile_id: string | null;
  role: ConfigurableAgentRole | null;
  executor_provider: ExecutorProviderName;
  auth_mode: AuthMode;
  model: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * FEATURE-041, sección 4/Regla 5.10: hasta 3 perfiles nombrados por cuenta. "Global" no es una fila
 * de esta tabla -- es la fila de `user_agent_config` con `role is null` (ya existía desde
 * FEATURE-016). Un perfil es exclusivamente el contenedor de hasta 6 overrides de agente
 * (`user_agent_config` con `role is not null and profile_id = este perfil`).
 */
export interface AgentConfigProfileRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export const MAX_AGENT_CONFIG_PROFILES_PER_USER = 3;

/**
 * FEATURE-025-Parte-1, sección 7.2: credencial de IA propia del usuario, cifrada. Misma convención
 * de almacenamiento que `UserGitConnectionRow` (FEATURE-026) -- un solo campo de texto con el
 * ciphertext ya empaquetado, no columnas separadas de iv/authTag.
 */
export interface UserAiProviderCredentialRow {
  id: string;
  user_id: string;
  provider: ExecutorProviderName;
  credential_ciphertext: string;
  created_at: string;
  updated_at: string;
}

const DEFAULT_AGENT_CONFIG: EffectiveAgentConfig = { executorProvider: "claude", authMode: "api_key", model: null };

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
/**
 * FEATURE-025-Parte-2, sección 5.16.2/3: usado por la desconexión de OAuth para advertir sobre
 * runs activos del usuario -- no distingue qué runs usan efectivamente esta conexión en particular
 * (la configuración se resuelve por fase, no se persiste "este run usa la conexión X"), así que se
 * informa el conjunto completo de runs `running` del usuario como advertencia conservadora.
 */
export async function listRunningRunIdsForUser(userId: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>("select id from runs where owner_id = $1 and status = 'running'", [
    userId,
  ]);
  return result.rows.map((row) => row.id);
}

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
// FEATURE-025-Parte-1: agrega `model` a la misma fila -- mismo ciclo de vida y precedencia que
// executor_provider/auth_mode, no justifica una tabla separada (sección 7.1 del diseño).
function toEffectiveAgentConfig(row: UserAgentConfigRow): EffectiveAgentConfig {
  return { executorProvider: row.executor_provider, authMode: row.auth_mode, model: row.model };
}

const AGENT_CONFIG_COLUMNS =
  "id, user_id, profile_id, role, executor_provider, auth_mode, model, created_at, updated_at";

export async function getGlobalAgentConfig(userId: string): Promise<EffectiveAgentConfig | null> {
  const result = await pool.query<UserAgentConfigRow>(
    `select ${AGENT_CONFIG_COLUMNS}
     from user_agent_config
     where user_id = $1 and role is null`,
    [userId]
  );
  return result.rows[0] ? toEffectiveAgentConfig(result.rows[0]) : null;
}

export async function setGlobalAgentConfig(userId: string, config: EffectiveAgentConfig): Promise<EffectiveAgentConfig> {
  const result = await pool.query<UserAgentConfigRow>(
    `insert into user_agent_config (user_id, role, executor_provider, auth_mode, model)
     values ($1, null, $2, $3, $4)
     on conflict (user_id) where role is null
     do update set executor_provider = excluded.executor_provider,
                   auth_mode = excluded.auth_mode,
                   model = excluded.model,
                   updated_at = now()
     returning ${AGENT_CONFIG_COLUMNS}`,
    [userId, config.executorProvider, config.authMode, config.model]
  );
  return toEffectiveAgentConfig(result.rows[0]);
}

// FEATURE-041, Regla 5.10: hasta 3 perfiles nombrados por cuenta. El límite se valida en el
// servicio de aplicación (countAgentConfigProfiles), no acá ni en la base.

export async function listAgentConfigProfiles(userId: string): Promise<AgentConfigProfileRow[]> {
  const result = await pool.query<AgentConfigProfileRow>(
    "select id, user_id, name, created_at, updated_at from agent_config_profiles where user_id = $1 order by created_at",
    [userId]
  );
  return result.rows;
}

export async function countAgentConfigProfiles(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "select count(*)::text as count from agent_config_profiles where user_id = $1",
    [userId]
  );
  return Number(result.rows[0].count);
}

export async function getAgentConfigProfileById(
  profileId: string,
  userId: string
): Promise<AgentConfigProfileRow | null> {
  const result = await pool.query<AgentConfigProfileRow>(
    "select id, user_id, name, created_at, updated_at from agent_config_profiles where id = $1 and user_id = $2",
    [profileId, userId]
  );
  return result.rows[0] ?? null;
}

export async function createAgentConfigProfile(userId: string, name: string): Promise<AgentConfigProfileRow> {
  const result = await pool.query<AgentConfigProfileRow>(
    `insert into agent_config_profiles (user_id, name)
     values ($1, $2)
     returning id, user_id, name, created_at, updated_at`,
    [userId, name]
  );
  return result.rows[0];
}

export async function renameAgentConfigProfile(
  profileId: string,
  userId: string,
  name: string
): Promise<AgentConfigProfileRow | null> {
  const result = await pool.query<AgentConfigProfileRow>(
    `update agent_config_profiles
     set name = $3, updated_at = now()
     where id = $1 and user_id = $2
     returning id, user_id, name, created_at, updated_at`,
    [profileId, userId, name]
  );
  return result.rows[0] ?? null;
}

// ON DELETE CASCADE (user_agent_config.profile_id) y ON DELETE SET NULL (projects.agent_config_
// profile_id) hacen el resto -- ningún proyecto que tuviera este perfil queda bloqueado, cae
// automáticamente a Global (Regla 5.10, Escenario 21).
export async function deleteAgentConfigProfile(profileId: string, userId: string): Promise<void> {
  await pool.query("delete from agent_config_profiles where id = $1 and user_id = $2", [profileId, userId]);
}

export async function getProfileAgentConfigOverride(
  userId: string,
  profileId: string,
  role: ConfigurableAgentRole
): Promise<EffectiveAgentConfig | null> {
  const result = await pool.query<UserAgentConfigRow>(
    `select ${AGENT_CONFIG_COLUMNS}
     from user_agent_config
     where user_id = $1 and profile_id = $2 and role = $3`,
    [userId, profileId, role]
  );
  return result.rows[0] ? toEffectiveAgentConfig(result.rows[0]) : null;
}

export async function listProfileAgentConfigOverrides(
  userId: string,
  profileId: string
): Promise<Partial<Record<ConfigurableAgentRole, EffectiveAgentConfig>>> {
  const result = await pool.query<UserAgentConfigRow>(
    `select ${AGENT_CONFIG_COLUMNS}
     from user_agent_config
     where user_id = $1 and profile_id = $2`,
    [userId, profileId]
  );
  const overrides: Partial<Record<ConfigurableAgentRole, EffectiveAgentConfig>> = {};
  for (const row of result.rows) {
    if (row.role) overrides[row.role] = toEffectiveAgentConfig(row);
  }
  return overrides;
}

export async function setProfileAgentConfigOverride(
  userId: string,
  profileId: string,
  role: ConfigurableAgentRole,
  config: EffectiveAgentConfig
): Promise<EffectiveAgentConfig> {
  const result = await pool.query<UserAgentConfigRow>(
    `insert into user_agent_config (user_id, profile_id, role, executor_provider, auth_mode, model)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, profile_id, role) where role is not null and profile_id is not null
     do update set executor_provider = excluded.executor_provider,
                   auth_mode = excluded.auth_mode,
                   model = excluded.model,
                   updated_at = now()
     returning ${AGENT_CONFIG_COLUMNS}`,
    [userId, profileId, role, config.executorProvider, config.authMode, config.model]
  );
  return toEffectiveAgentConfig(result.rows[0]);
}

export async function deleteProfileAgentConfigOverride(
  userId: string,
  profileId: string,
  role: ConfigurableAgentRole
): Promise<void> {
  await pool.query("delete from user_agent_config where user_id = $1 and profile_id = $2 and role = $3", [
    userId,
    profileId,
    role,
  ]);
}

/**
 * FEATURE-041, Regla 5.10: override del perfil seleccionado por el proyecto para ese rol -> Global
 * de la cuenta -> default del sistema. `profileId` es `null` cuando el proyecto usa Global
 * directamente (nunca eligió un perfil, o el que tenía fue borrado -- Escenario 21).
 * `getProfileAgentConfigOverride` filtra por `user_id` además de `profile_id`: si por algún error
 * llegara un `profileId` de otra cuenta, no matchea ninguna fila y cae a Global igual (Regla 5.7).
 */
export async function resolveAgentConfig(
  userId: string,
  role: ConfigurableAgentRole,
  profileId: string | null
): Promise<EffectiveAgentConfig> {
  if (profileId) {
    const override = await getProfileAgentConfigOverride(userId, profileId, role);
    if (override) return override;
  }
  const global = await getGlobalAgentConfig(userId);
  if (global) return global;
  return DEFAULT_AGENT_CONFIG;
}

// Helper interno para call sites que ya tienen un projectId de confianza (contexto de ejecución de
// pipeline, no input directo del usuario) y solo necesitan el profileId para resolveAgentConfig --
// evita traer el ProjectRow completo solo para leer una columna.
export async function getProjectAgentConfigProfileId(projectId: string): Promise<string | null> {
  const result = await pool.query<{ agent_config_profile_id: string | null }>(
    "select agent_config_profile_id from projects where id = $1",
    [projectId]
  );
  return result.rows[0]?.agent_config_profile_id ?? null;
}

// FEATURE-025-Parte-1, sección 7.2: CRUD crudo de credenciales de IA -- cifrado/descifrado y
// resolución de autenticación en runtime viven en src/auth/aiCredentialService.ts (capa de
// servicio), no acá, mismo criterio de capas que gitConnectionService.ts sobre user_git_connections.

export async function getAiProviderCredential(
  userId: string,
  provider: ExecutorProviderName
): Promise<UserAiProviderCredentialRow | null> {
  const result = await pool.query<UserAiProviderCredentialRow>(
    `select id, user_id, provider, credential_ciphertext, created_at, updated_at
     from user_ai_provider_credentials
     where user_id = $1 and provider = $2`,
    [userId, provider]
  );
  return result.rows[0] ?? null;
}

export async function listAiProviderCredentials(userId: string): Promise<UserAiProviderCredentialRow[]> {
  const result = await pool.query<UserAiProviderCredentialRow>(
    `select id, user_id, provider, credential_ciphertext, created_at, updated_at
     from user_ai_provider_credentials
     where user_id = $1
     order by provider asc`,
    [userId]
  );
  return result.rows;
}

export async function upsertAiProviderCredential(
  userId: string,
  provider: ExecutorProviderName,
  credentialCiphertext: string
): Promise<UserAiProviderCredentialRow> {
  const result = await pool.query<UserAiProviderCredentialRow>(
    `insert into user_ai_provider_credentials (user_id, provider, credential_ciphertext)
     values ($1, $2, $3)
     on conflict (user_id, provider)
     do update set credential_ciphertext = excluded.credential_ciphertext, updated_at = now()
     returning id, user_id, provider, credential_ciphertext, created_at, updated_at`,
    [userId, provider, credentialCiphertext]
  );
  return result.rows[0];
}

export async function deleteAiProviderCredential(userId: string, provider: ExecutorProviderName): Promise<void> {
  await pool.query("delete from user_ai_provider_credentials where user_id = $1 and provider = $2", [
    userId,
    provider,
  ]);
}

// FEATURE-025-Parte-2, sección 7.1: conexiones OAuth personales -- CRUD crudo. La materialización,
// el cifrado/descifrado del envelope y la lógica de refresh/CAS de alto nivel viven en
// src/auth/aiOAuthSessionService.ts (capa de servicio), mismo criterio de capas que
// aiCredentialService.ts sobre user_ai_provider_credentials.

export type OAuthConnectionStatus = "connected" | "reauth_required";

export interface UserAiOAuthConnectionRow {
  id: string;
  user_id: string;
  provider: ExecutorProviderName;
  encrypted_session: string;
  status: OAuthConnectionStatus;
  session_version: number;
  created_at: string;
  updated_at: string;
  last_validated_at: string | null;
  reauth_required_at: string | null;
}

export async function getAiOAuthConnection(
  userId: string,
  provider: ExecutorProviderName
): Promise<UserAiOAuthConnectionRow | null> {
  const result = await pool.query<UserAiOAuthConnectionRow>(
    `select id, user_id, provider, encrypted_session, status, session_version, created_at, updated_at,
            last_validated_at, reauth_required_at
     from user_ai_oauth_connections
     where user_id = $1 and provider = $2`,
    [userId, provider]
  );
  return result.rows[0] ?? null;
}

export async function listAiOAuthConnections(userId: string): Promise<UserAiOAuthConnectionRow[]> {
  const result = await pool.query<UserAiOAuthConnectionRow>(
    `select id, user_id, provider, encrypted_session, status, session_version, created_at, updated_at,
            last_validated_at, reauth_required_at
     from user_ai_oauth_connections
     where user_id = $1
     order by provider asc`,
    [userId]
  );
  return result.rows;
}

/**
 * Sección 6.1 del diseño: primera persistencia de una conexión recién autenticada -- siempre
 * session_version = 1, status = 'connected'. Sustituye cualquier conexión previa del mismo
 * (user_id, provider) (reautenticar reemplaza, nunca versiona conexiones viejas -- Excluido de la
 * Feature).
 */
export async function createAiOAuthConnection(
  userId: string,
  provider: ExecutorProviderName,
  encryptedSession: string
): Promise<UserAiOAuthConnectionRow> {
  const result = await pool.query<UserAiOAuthConnectionRow>(
    `insert into user_ai_oauth_connections (user_id, provider, encrypted_session, status, session_version, last_validated_at)
     values ($1, $2, $3, 'connected', 1, now())
     on conflict (user_id, provider)
     do update set encrypted_session = excluded.encrypted_session,
                   status = 'connected',
                   session_version = 1,
                   last_validated_at = now(),
                   reauth_required_at = null,
                   updated_at = now()
     returning id, user_id, provider, encrypted_session, status, session_version, created_at, updated_at,
               last_validated_at, reauth_required_at`,
    [userId, provider, encryptedSession]
  );
  return result.rows[0];
}

/**
 * Sección 7.3: compare-and-swap -- una fila afectada igual a cero representa conflicto (otro
 * proceso ya promovió una versión más nueva). El caller debe releer y descartar la rama local
 * (Regla 5.11.8), nunca reintentar ciegamente con el mismo `expectedVersion`.
 */
export async function promoteAiOAuthSession(params: {
  connectionId: string;
  expectedVersion: number;
  encryptedSession: string;
}): Promise<UserAiOAuthConnectionRow | null> {
  const result = await pool.query<UserAiOAuthConnectionRow>(
    `update user_ai_oauth_connections
     set encrypted_session = $3,
         session_version = session_version + 1,
         status = 'connected',
         last_validated_at = now(),
         reauth_required_at = null,
         updated_at = now()
     where id = $1 and session_version = $2
     returning id, user_id, provider, encrypted_session, status, session_version, created_at, updated_at,
               last_validated_at, reauth_required_at`,
    [params.connectionId, params.expectedVersion, params.encryptedSession]
  );
  return result.rows[0] ?? null;
}

export async function markAiOAuthConnectionReauthRequired(connectionId: string): Promise<void> {
  await pool.query(
    `update user_ai_oauth_connections
     set status = 'reauth_required', reauth_required_at = now(), updated_at = now()
     where id = $1`,
    [connectionId]
  );
}

export async function deleteAiOAuthConnection(userId: string, provider: ExecutorProviderName): Promise<void> {
  await pool.query("delete from user_ai_oauth_connections where user_id = $1 and provider = $2", [userId, provider]);
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

/**
 * FEATURE-041: login por email o por handle en un solo lookup. Necesario porque las cuentas
 * legacy (creadas por `seed:user`, ej. "asdru") tienen `handle` distinto de `email` -- no se
 * migró el handle existente al email para no romper el login ya establecido (ver migración 0024)
 * -- mientras que las cuentas self-service nuevas SÍ tienen `handle = email normalizado`. La
 * pantalla de login solo pide "Email" (Scope: "No se introduce username"), así que tiene que
 * funcionar para ambos casos con el mismo campo.
 */
export async function findUserByHandleOrEmail(normalizedIdentifier: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>("select * from users where handle = $1 or lower(email) = $1", [
    normalizedIdentifier,
  ]);
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

// FEATURE-041: registro público self-service. `email` es el valor mostrado al usuario tal cual lo
// escribió; `handle` es el mismo valor normalizado (minúsculas, sin destruir el original -- Regla
// 5.4) y sigue siendo la clave de login real (findUserByHandle, sin tocar). Nace en
// `pending_verification` (default de la columna); nunca se crea ya verificada.
export class DuplicateAccountError extends Error {}

export async function createSelfServiceAccount(params: {
  email: string;
  normalizedHandle: string;
  passwordHash: string;
}): Promise<UserRow> {
  try {
    const result = await pool.query<UserRow>(
      `insert into users (handle, email, password_hash)
       values ($1, $2, $3)
       returning *`,
      [params.normalizedHandle, params.email, params.passwordHash]
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateAccountError(`Ya existe una cuenta con el email "${params.email}".`);
    }
    throw err;
  }
}

// FEATURE-041, Scope "Administración de cuentas": creadas por un administrador, sin contraseña
// temporal (`password_hash` queda null hasta que la propia persona activa la cuenta -- Regla 5.6,
// "la contraseña nunca se registra ni se devuelve", ni siquiera una generada por el sistema).
export async function createAccountByAdmin(email: string, normalizedHandle: string): Promise<UserRow> {
  try {
    const result = await pool.query<UserRow>(
      `insert into users (handle, email)
       values ($1, $2)
       returning *`,
      [normalizedHandle, email]
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new DuplicateAccountError(`Ya existe una cuenta con el email "${email}".`);
    }
    throw err;
  }
}

export async function setUserDisplayName(userId: string, displayName: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "update users set display_name = $2 where id = $1 returning *",
    [userId, displayName]
  );
  return result.rows[0] ?? null;
}

export async function markUserEmailVerified(userId: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `update users
     set email_verified_at = now(), status = case when status = 'pending_verification' then 'active' else status end
     where id = $1
     returning *`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function setUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await pool.query("update users set password_hash = $2 where id = $1", [userId, passwordHash]);
}

/**
 * FEATURE-041, Regla 5.8/Escenario 13: nunca modifica una cuenta con `is_protected_superadmin`.
 * El chequeo vive acá (no solo en el servicio) para que ningún call site futuro pueda saltearlo
 * por error -- ownership/protección se garantiza en la capa de datos, no solo en la de negocio.
 */
export async function setUserRole(userId: string, role: AccountRole): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "update users set role = $2 where id = $1 and is_protected_superadmin = false returning *",
    [userId, role]
  );
  return result.rows[0] ?? null;
}

export async function setUserStatus(userId: string, status: AccountStatus): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    "update users set status = $2 where id = $1 and is_protected_superadmin = false returning *",
    [userId, status]
  );
  return result.rows[0] ?? null;
}

// FEATURE-041, Regla 5.9: informativa, actualizada por un evento de autenticación exitoso
// claramente definido (login web) -- nunca por cada request.
export async function touchUserLastLogin(userId: string): Promise<void> {
  await pool.query("update users set last_login_at = now() where id = $1", [userId]);
}

export interface AccountListEntry {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AccountRole;
  status: AccountStatus;
  created_at: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  is_protected_superadmin: boolean;
}

export async function listAccountsForAdmin(): Promise<AccountListEntry[]> {
  const result = await pool.query<AccountListEntry>(
    `select id, email, display_name, role, status, created_at, email_verified_at, last_login_at, is_protected_superadmin
     from users
     order by created_at asc`
  );
  return result.rows;
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

/**
 * FEATURE-041, Regla 5.7: `profileId` debe pertenecer al mismo owner del proyecto -- nunca se
 * acepta un profileId de otra cuenta aunque el cliente lo envíe. `profileId = null` selecciona
 * Global explícitamente (sección "Perfiles personalizados": Global es una opción real del
 * selector, no la ausencia de selección). Devuelve `null` si el proyecto no es del usuario, o si
 * `profileId` no es `null` y no pertenece a ese mismo usuario -- en ambos casos, ninguna fila se
 * actualiza (ownership checkeado en la misma condición del UPDATE, no en dos pasos separados).
 */
export async function setProjectAgentConfigProfile(params: {
  projectId: string;
  ownerId: string;
  profileId: string | null;
}): Promise<ProjectRow | null> {
  const result = await pool.query<ProjectRow>(
    `update projects
     set agent_config_profile_id = $3, updated_at = now()
     where id = $1
       and owner_id = $2
       and ($3::uuid is null or exists (
         select 1 from agent_config_profiles where id = $3 and user_id = $2
       ))
     returning *`,
    [params.projectId, params.ownerId, params.profileId]
  );
  return result.rows[0] ?? null;
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

// FEATURE-041, Scope "Contraseña y sesiones": revocar todas las sesiones al cambiar contraseña,
// recuperar contraseña o suspender una cuenta.
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await pool.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
}

// FEATURE-041, Regla 5.5: tokens de un solo uso para verificación de email, recuperación de
// contraseña y activación de cuentas creadas por un administrador -- aleatorios, hash únicamente
// (nunca texto plano), expiración, uso único, revocables por reenvío.
export type AccountTokenPurpose = "email_verification" | "password_reset" | "account_activation";

export interface AccountTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  purpose: AccountTokenPurpose;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

// Un reenvío invalida el token anterior (Regla 5.5) -- revocar y crear son atómicos en el
// servicio de auth (accountTokens.ts), no acá: esta función es intencionalmente de un solo paso.
export async function revokeUnusedAccountTokens(userId: string, purpose: AccountTokenPurpose): Promise<void> {
  await pool.query(
    "update account_tokens set revoked_at = now() where user_id = $1 and purpose = $2 and used_at is null and revoked_at is null",
    [userId, purpose]
  );
}

export async function createAccountToken(params: {
  userId: string;
  tokenHash: string;
  purpose: AccountTokenPurpose;
  expiresAt: Date;
}): Promise<AccountTokenRow> {
  const result = await pool.query<AccountTokenRow>(
    `insert into account_tokens (user_id, token_hash, purpose, expires_at)
     values ($1, $2, $3, $4)
     returning *`,
    [params.userId, params.tokenHash, params.purpose, params.expiresAt.toISOString()]
  );
  return result.rows[0];
}

export async function findValidAccountTokenByHash(
  tokenHash: string,
  purpose: AccountTokenPurpose
): Promise<AccountTokenRow | null> {
  const result = await pool.query<AccountTokenRow>(
    `select * from account_tokens
     where token_hash = $1 and purpose = $2
       and used_at is null and revoked_at is null and expires_at > now()`,
    [tokenHash, purpose]
  );
  return result.rows[0] ?? null;
}

/**
 * Consumo atómico: solo la primera llamada concurrente que llegue gana (Validation Evidence:
 * "pruebas de concurrencia para uso único de tokens"). El `where` repite las mismas condiciones de
 * vigencia que `findValidAccountTokenByHash` -- una carrera entre validar y consumir no puede
 * reactivar un token ya vencido/usado/revocado entretanto.
 */
export async function consumeAccountToken(tokenId: string): Promise<AccountTokenRow | null> {
  const result = await pool.query<AccountTokenRow>(
    `update account_tokens
     set used_at = now()
     where id = $1 and used_at is null and revoked_at is null and expires_at > now()
     returning *`,
    [tokenId]
  );
  return result.rows[0] ?? null;
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
