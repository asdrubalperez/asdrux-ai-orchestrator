// FEATURE-026, sección 7.6: cliente HTTP mediante fetch nativo, sin Octokit (confirmado por la
// validación técnica: el proyecto no tiene cliente de GitHub API ni Octokit en package.json).

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_VERSION = "2022-11-28";

export class GitHubOAuthError extends Error {}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function gitHubOAuthConfigFromEnv(): GitHubOAuthConfig {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) {
    throw new GitHubOAuthError(
      "GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET y GITHUB_OAUTH_CALLBACK_URL son requeridas."
    );
  }
  return { clientId, clientSecret, callbackUrl };
}

// Regla 5: scope inicial `repo` (lectura y escritura sobre los repositorios del usuario).
export function buildGitHubAuthorizeUrl(config: GitHubOAuthConfig, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state);
  return url.toString();
}

export interface ExchangedGitHubToken {
  accessToken: string;
  scopes: string[];
}

export async function exchangeCodeForToken(
  config: GitHubOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<ExchangedGitHubToken> {
  const response = await fetchImpl(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new GitHubOAuthError(
      `Intercambio de código OAuth falló: ${String(payload.error_description ?? payload.error ?? response.status)}`
    );
  }
  const scopeString = typeof payload.scope === "string" ? payload.scope : "";
  return {
    accessToken: payload.access_token,
    scopes: scopeString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export interface GitHubIdentity {
  externalUserId: string;
  login: string;
}

export async function fetchGitHubIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<GitHubIdentity> {
  const response = await fetchImpl(`${GITHUB_API_BASE}/user`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new GitHubOAuthError(`No se pudo obtener la identidad de GitHub (status ${response.status}).`);
  }
  const payload = (await response.json()) as { id: number; login: string };
  return { externalUserId: String(payload.id), login: payload.login };
}

export interface GitHubRepository {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  visibility: "public" | "private" | "internal";
  permissions: { read: boolean; push: boolean; admin: boolean };
}

// Sección 4.4 / 7.8: bajo demanda, sin sincronización permanente. Paginación explícita (Riesgo 11).
export async function listAccessibleRepositories(
  accessToken: string,
  options: { page?: number; perPage?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<GitHubRepository[]> {
  const url = new URL(`${GITHUB_API_BASE}/user/repos`);
  url.searchParams.set("per_page", String(options.perPage ?? 50));
  url.searchParams.set("page", String(options.page ?? 1));
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new GitHubOAuthError(`No se pudo listar repositorios accesibles (status ${response.status}).`);
  }
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  return payload.map((repo) => {
    const owner = repo.owner as Record<string, unknown> | undefined;
    const permissions = (repo.permissions as Record<string, unknown> | undefined) ?? {};
    return {
      externalId: String(repo.id),
      owner: String(owner?.login ?? ""),
      name: String(repo.name),
      fullName: String(repo.full_name),
      cloneUrl: String(repo.clone_url),
      visibility: repo.private ? "private" : "public",
      permissions: {
        read: Boolean(permissions.pull),
        push: Boolean(permissions.push),
        admin: Boolean(permissions.admin),
      },
    };
  });
}

/**
 * Sección 7.6/Regla 22: `check`/`revoke` de un token OAuth se autentican con Basic Auth
 * usando client_id:client_secret de la OAuth App -- no con el token del usuario. Confirmado
 * contra la documentación oficial de GitHub (REST API endpoints for OAuth authorizations).
 */
function oAuthAppBasicAuthHeader(config: GitHubOAuthConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

export async function checkGitHubToken(
  config: GitHubOAuthConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const response = await fetchImpl(`${GITHUB_API_BASE}/applications/${config.clientId}/token`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      authorization: oAuthAppBasicAuthHeader(config),
      "x-github-api-version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  return response.ok;
}

export async function revokeGitHubToken(
  config: GitHubOAuthConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const response = await fetchImpl(`${GITHUB_API_BASE}/applications/${config.clientId}/token`, {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      authorization: oAuthAppBasicAuthHeader(config),
      "x-github-api-version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  return response.status === 204;
}
