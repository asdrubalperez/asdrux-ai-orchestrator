import {
  createProject,
  DuplicateProjectError,
  getLastSelectedProjectForUser,
  getProjectByIdForUser,
  listProjectsForUser,
  listRunsForProjectAndUser,
  selectProjectForUser,
  setProjectRepository,
  updateProjectName,
  type GitHubRepositoryVisibility,
  type ProjectRow,
  type RunRow,
} from "../db/repository.js";
import {
  GitConnectionInvalidError,
  GitConnectionRequiredError,
  listUserAccessibleRepositories,
} from "../auth/gitConnectionService.js";

// FEATURE-042, sección B: capa de negocio de proyectos, separada de los handlers HTTP (mismo
// patrón que intakeService.ts).

export interface ProjectRepositorySummary {
  provider: "github";
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: GitHubRepositoryVisibility;
}

export interface ProjectSummary {
  id: string;
  name: string;
  repository: ProjectRepositorySummary | null;
  isConfigured: boolean;
  isSelected: boolean;
  // FEATURE-041, Regla 5.10: null = Global (config de cuenta); si no-null, id de un perfil de la
  // cuenta del owner. La resolución de si el proyecto puede operar (credencial válida disponible
  // para lo que esto resuelva) se evalúa al ejecutar, no acá (Escenario 22).
  agentConfigProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toProjectSummary(row: ProjectRow, selectedProjectId: string | null): ProjectSummary {
  const repository: ProjectRepositorySummary | null = row.repository_external_id
    ? {
        provider: "github",
        externalId: row.repository_external_id,
        owner: row.repository_owner as string,
        name: row.repository_name as string,
        fullName: row.repository_full_name as string,
        cloneUrl: row.repository_clone_url as string,
        visibility: row.repository_visibility as GitHubRepositoryVisibility,
      }
    : null;
  return {
    id: row.id,
    name: row.name,
    repository,
    isConfigured: repository !== null,
    isSelected: row.id === selectedProjectId,
    agentConfigProfileId: row.agent_config_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(
  userId: string
): Promise<{ projects: ProjectSummary[]; selectedProjectId: string | null }> {
  const [rows, lastSelected] = await Promise.all([listProjectsForUser(userId), getLastSelectedProjectForUser(userId)]);
  const selectedProjectId = lastSelected?.id ?? null;
  return { projects: rows.map((row) => toProjectSummary(row, selectedProjectId)), selectedProjectId };
}

export async function getProjectSummary(projectId: string, userId: string): Promise<ProjectSummary | null> {
  const row = await getProjectByIdForUser(projectId, userId);
  if (!row) return null;
  const lastSelected = await getLastSelectedProjectForUser(userId);
  return toProjectSummary(row, lastSelected?.id ?? null);
}

type RepositoryApplicationError =
  | { kind: "git_connection_required"; message: string }
  | { kind: "git_connection_invalid"; message: string }
  | { kind: "repository_not_accessible"; message: string }
  | { kind: "repository_read_only"; message: string }
  | { kind: "duplicate_project" };

/**
 * Sección B.2/B.5: "debe validarse contra la respuesta vigente de FEATURE-026" -- se relista y se
 * busca el `repositoryExternalId` ahí, nunca se confía en datos de repositorio que el cliente
 * pueda haber inventado o que hayan quedado desactualizados.
 */
async function applyRepositoryToProject(params: {
  projectId: string;
  ownerId: string;
  repositoryExternalId: string;
}): Promise<{ kind: "updated"; project: ProjectRow } | RepositoryApplicationError> {
  let repositories;
  try {
    repositories = await listUserAccessibleRepositories(params.ownerId);
  } catch (err) {
    if (err instanceof GitConnectionRequiredError) return { kind: "git_connection_required", message: err.message };
    if (err instanceof GitConnectionInvalidError) return { kind: "git_connection_invalid", message: err.message };
    throw err;
  }

  const repo = repositories.find((r) => r.externalId === params.repositoryExternalId);
  if (!repo) {
    return {
      kind: "repository_not_accessible",
      message: "El repositorio no está entre los accesibles con tu conexión GitHub.",
    };
  }
  if (!repo.permissions.read) {
    return { kind: "repository_not_accessible", message: "No tenés acceso de lectura a ese repositorio." };
  }
  if (!repo.permissions.push) {
    return { kind: "repository_read_only", message: "Necesitás permiso de escritura sobre ese repositorio." };
  }

  try {
    const updated = await setProjectRepository({
      projectId: params.projectId,
      ownerId: params.ownerId,
      repository: {
        externalId: repo.externalId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        cloneUrl: repo.cloneUrl,
        visibility: repo.visibility,
      },
    });
    if (!updated) throw new Error("Proyecto no encontrado al aplicar el repositorio (ownership ya validado).");
    return { kind: "updated", project: updated };
  } catch (err) {
    if (err instanceof DuplicateProjectError) return { kind: "duplicate_project" };
    throw err;
  }
}

export type CreateProjectResult =
  | { kind: "created"; project: ProjectSummary }
  | { kind: "invalid_project_name" }
  | { kind: "duplicate_project" }
  | RepositoryApplicationError;

export async function createProjectForUser(params: {
  ownerId: string;
  name: string;
  repositoryExternalId?: string;
}): Promise<CreateProjectResult> {
  const name = params.name.trim();
  if (!name) return { kind: "invalid_project_name" };

  let created: ProjectRow;
  try {
    created = await createProject({ ownerId: params.ownerId, name });
  } catch (err) {
    if (err instanceof DuplicateProjectError) return { kind: "duplicate_project" };
    throw err;
  }

  if (!params.repositoryExternalId) {
    return { kind: "created", project: toProjectSummary(created, null) };
  }

  const applied = await applyRepositoryToProject({
    projectId: created.id,
    ownerId: params.ownerId,
    repositoryExternalId: params.repositoryExternalId,
  });
  if (applied.kind !== "updated") return applied;
  return { kind: "created", project: toProjectSummary(applied.project, null) };
}

export type UpdateProjectNameResult =
  | { kind: "updated"; project: ProjectSummary }
  | { kind: "not_found" }
  | { kind: "invalid_project_name" }
  | { kind: "duplicate_project" };

export async function updateProjectNameForUser(params: {
  projectId: string;
  ownerId: string;
  name: string;
}): Promise<UpdateProjectNameResult> {
  const name = params.name.trim();
  if (!name) return { kind: "invalid_project_name" };
  try {
    const updated = await updateProjectName({ projectId: params.projectId, ownerId: params.ownerId, name });
    if (!updated) return { kind: "not_found" };
    return { kind: "updated", project: toProjectSummary(updated, null) };
  } catch (err) {
    if (err instanceof DuplicateProjectError) return { kind: "duplicate_project" };
    throw err;
  }
}

export type SetProjectRepositoryResult = { kind: "updated"; project: ProjectSummary } | { kind: "not_found" } | RepositoryApplicationError;

export async function setProjectRepositoryForUser(params: {
  projectId: string;
  ownerId: string;
  repositoryExternalId: string;
}): Promise<SetProjectRepositoryResult> {
  const existing = await getProjectByIdForUser(params.projectId, params.ownerId);
  if (!existing) return { kind: "not_found" };

  const applied = await applyRepositoryToProject(params);
  if (applied.kind !== "updated") return applied;
  return { kind: "updated", project: toProjectSummary(applied.project, null) };
}

export async function selectProject(params: { userId: string; projectId: string }): Promise<boolean> {
  return selectProjectForUser(params);
}

export async function listProjectCases(params: {
  projectId: string;
  userId: string;
}): Promise<{ found: boolean; runs: RunRow[] }> {
  const project = await getProjectByIdForUser(params.projectId, params.userId);
  if (!project) return { found: false, runs: [] };
  const runs = await listRunsForProjectAndUser(params.projectId, params.userId);
  return { found: true, runs };
}
