export type GitHubRepositoryVisibility = "public" | "private" | "internal";

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
  // FEATURE-041, Regla 5.10: null = Global (config de cuenta).
  agentConfigProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListProjectsResponse {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
}

export type GitConnectionSummaryStatus = "not_connected" | "connected" | "invalid" | "revoked";

export interface GitConnectionSummary {
  status: GitConnectionSummaryStatus;
  externalLogin: string | null;
  scopes: string[];
  connectedAt: string | null;
}

export interface AccessibleRepository {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: GitHubRepositoryVisibility;
  permissions: { read: boolean; push: boolean; admin: boolean };
}
