import { apiUrl } from "../lib/api";
import type { AccessibleRepository, GitConnectionSummary, ListProjectsResponse, ProjectSummary } from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export function listProjects(): Promise<ListProjectsResponse> {
  return request("/projects");
}

export function getProject(projectId: string): Promise<{ project: ProjectSummary }> {
  return request(`/projects/${encodeURIComponent(projectId)}`);
}

export function createProject(params: { name: string; repositoryExternalId?: string }): Promise<{ project: ProjectSummary }> {
  return request("/projects", { method: "POST", body: JSON.stringify(params) });
}

export function updateProjectName(projectId: string, name: string): Promise<{ project: ProjectSummary }> {
  return request(`/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function setProjectRepository(
  projectId: string,
  repositoryExternalId: string
): Promise<{ project: ProjectSummary }> {
  return request(`/projects/${encodeURIComponent(projectId)}/repository`, {
    method: "PUT",
    body: JSON.stringify({ repositoryExternalId }),
  });
}

export function selectProject(projectId: string): Promise<{ selectedProjectId: string }> {
  return request(`/projects/${encodeURIComponent(projectId)}/select`, { method: "POST" });
}

// FEATURE-041, Regla 5.10: profileId null selecciona Global explícitamente.
export function setProjectAgentConfigProfile(
  projectId: string,
  profileId: string | null
): Promise<{ project: { agent_config_profile_id: string | null } }> {
  return request(`/projects/${encodeURIComponent(projectId)}/agent-config-profile`, {
    method: "PUT",
    body: JSON.stringify({ profileId }),
  });
}

export function getGitHubConnectionStatus(): Promise<{ connection: GitConnectionSummary }> {
  return request("/auth/github/status");
}

export function listAccessibleGitHubRepositories(): Promise<{ repositories: AccessibleRepository[] }> {
  return request("/auth/github/repositories");
}

export function disconnectGitHub(): Promise<{ ok: true }> {
  return request("/auth/github/disconnect", { method: "POST" });
}

// Sección C.6: el callback vuelve al punto de origen -- el propio /auth/github/start persiste el
// returnPath (oauth_states.return_path), esta es solo la navegación top-level que lo dispara.
export function githubConnectUrl(returnPath: string): string {
  return apiUrl(`/auth/github/start?returnPath=${encodeURIComponent(returnPath)}`);
}
