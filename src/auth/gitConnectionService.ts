import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  consumeOAuthState,
  createOAuthState,
  getGitConnectionByExternalIdentity,
  getGitConnectionForUser,
  markGitConnectionStatus,
  upsertGitConnection,
  type GitConnectionStatus,
  type UserGitConnectionRow,
} from "../db/repository.js";
import { decryptGitToken, encryptGitToken } from "./gitCredentialEncryption.js";
import type { GitProcessAuth as WorktreeGitProcessAuth } from "../isolation/worktree.js";
import {
  buildGitHubAuthorizeUrl,
  createBranchFromSha,
  exchangeCodeForToken,
  fetchBranchSha,
  fetchGitHubIdentity,
  fetchRepositoryDetail,
  gitHubOAuthConfigFromEnv,
  listAccessibleRepositories as fetchAccessibleRepositories,
  revokeGitHubToken,
  type GitHubRepository,
  type GitHubRepositoryPermissions,
} from "./githubOAuthClient.js";

// Regla 11: expiración corta del state OAuth.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class GitConnectionRequiredError extends Error {}
export class GitConnectionInvalidError extends Error {}
export class OAuthStateInvalidError extends Error {}
export class GitHubIdentityAlreadyLinkedError extends Error {}

export type GitConnectionSummaryStatus = "not_connected" | GitConnectionStatus;

export interface GitConnectionSummary {
  status: GitConnectionSummaryStatus;
  externalLogin: string | null;
  scopes: string[];
  connectedAt: string | null;
}

function toSummary(row: UserGitConnectionRow | null): GitConnectionSummary {
  if (!row) return { status: "not_connected", externalLogin: null, scopes: [], connectedAt: null };
  return { status: row.status, externalLogin: row.external_login, scopes: row.granted_scopes, connectedAt: row.connected_at };
}

export async function getConnectionStatus(userId: string): Promise<GitConnectionSummary> {
  return toSummary(await getGitConnectionForUser(userId));
}

/**
 * Regla 20 / sección 7.2: `return_path` limitado a rutas internas -- evita open redirect si un
 * atacante logra manipular el valor guardado o el parámetro de query que lo origina.
 */
export function sanitizeReturnPath(returnPath: string | null | undefined): string | null {
  if (!returnPath) return null;
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) return null;
  if (returnPath.includes("\\")) return null;
  return returnPath;
}

// Regla 11: state aleatorio, de un solo uso, asociado a user_id + session_id, expiración corta.
// Se persiste el hash (sección 7.2: "almacenar hash, no el state original"). `frontendOrigin` ya
// viene validado por el caller (isAllowedWebOrigin) -- se persiste para que el callback sepa a
// qué origen redirigir de vuelta (producción o un preview de Vercel).
export async function startGitHubOAuth(params: {
  userId: string;
  sessionId: string;
  returnPath?: string | null;
  frontendOrigin: string;
}): Promise<{ authorizeUrl: string }> {
  const config = gitHubOAuthConfigFromEnv();
  const state = randomBytes(32).toString("hex");
  const stateHash = hashState(state);
  await createOAuthState({
    userId: params.userId,
    sessionId: params.sessionId,
    provider: "github",
    stateHash,
    returnPath: sanitizeReturnPath(params.returnPath),
    frontendOrigin: params.frontendOrigin,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  return { authorizeUrl: buildGitHubAuthorizeUrl(config, state) };
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/**
 * Regla 11: el callback nunca confía en un userId del navegador -- la identidad del usuario y de
 * la sesión vienen exclusivamente de `params.userId`/`params.sessionId` (resueltos por el
 * middleware de sesión del propio Orquestador, no por query params), y se validan contra lo que
 * quedó persistido junto al `state` al momento de iniciar el flujo.
 */
export interface CompletedGitHubOAuth {
  connection: GitConnectionSummary;
  frontendOrigin: string;
  returnPath: string | null;
}

export async function completeGitHubOAuth(params: {
  userId: string;
  sessionId: string;
  code: string;
  state: string;
}): Promise<CompletedGitHubOAuth> {
  const stateRow = await consumeOAuthState(hashState(params.state));
  if (!stateRow || stateRow.user_id !== params.userId || stateRow.session_id !== params.sessionId) {
    throw new OAuthStateInvalidError("state OAuth inválido, vencido, ya utilizado o de otra sesión.");
  }

  const config = gitHubOAuthConfigFromEnv();
  const { accessToken, scopes } = await exchangeCodeForToken(config, params.code);
  const identity = await fetchGitHubIdentity(accessToken);

  // Regla 3: una identidad GitHub no puede vincularse a dos usuarios distintos del Orquestador.
  const existingOwner = await getGitConnectionByExternalIdentity("github", identity.externalUserId);
  if (existingOwner && existingOwner.user_id !== params.userId) {
    throw new GitHubIdentityAlreadyLinkedError("Esta cuenta de GitHub ya está conectada a otro usuario.");
  }

  const row = await upsertGitConnection({
    userId: params.userId,
    provider: "github",
    externalUserId: identity.externalUserId,
    externalLogin: identity.login,
    accessTokenCiphertext: encryptGitToken(accessToken),
    grantedScopes: scopes,
  });
  return { connection: toSummary(row), frontendOrigin: stateRow.frontend_origin, returnPath: stateRow.return_path };
}

// Regla 24: se intenta revocar remotamente, pero el resultado remoto nunca bloquea el borrado
// local -- "la seguridad local no dependerá de que GitHub responda correctamente".
export async function disconnectGitHub(userId: string): Promise<void> {
  const row = await getGitConnectionForUser(userId);
  if (!row) return;
  try {
    const config = gitHubOAuthConfigFromEnv();
    const token = decryptGitToken(row.access_token_ciphertext);
    await revokeGitHubToken(config, token);
  } catch {
    // Intencional: revocación remota es best-effort (Regla 24).
  }
  await markGitConnectionStatus(userId, "github", "revoked");
}

async function resolveActiveConnection(userId: string): Promise<UserGitConnectionRow> {
  const row = await getGitConnectionForUser(userId);
  if (!row) throw new GitConnectionRequiredError("El usuario no tiene una conexión GitHub.");
  if (row.status !== "connected") {
    throw new GitConnectionInvalidError("La conexión GitHub no es válida. Se requiere reconexión.");
  }
  return row;
}

export async function listUserAccessibleRepositories(userId: string): Promise<GitHubRepository[]> {
  const row = await resolveActiveConnection(userId);
  return fetchAccessibleRepositories(decryptGitToken(row.access_token_ciphertext));
}

export class RepositoryNotAccessibleError extends Error {}

// FEATURE-042, sección D: permisos vigentes de un repo puntual (identificado por owner/name, ej.
// "asdrubalperez/pruebas-ia") -- usado por el gate Git preventivo/autoritativo. No expone el
// token: la resolución de credencial queda encapsulada acá, igual que en el resto del módulo.
export async function fetchProjectRepositoryPermissions(
  userId: string,
  repositoryFullName: string
): Promise<{ permissions: GitHubRepositoryPermissions; defaultBranch: string }> {
  const row = await resolveActiveConnection(userId);
  const detail = await fetchRepositoryDetail(decryptGitToken(row.access_token_ciphertext), repositoryFullName);
  if (!detail) {
    throw new RepositoryNotAccessibleError(`El repositorio "${repositoryFullName}" ya no es accesible.`);
  }
  return detail;
}

export async function projectBranchSha(userId: string, repositoryFullName: string, branch: string): Promise<string | null> {
  const row = await resolveActiveConnection(userId);
  return fetchBranchSha(decryptGitToken(row.access_token_ciphertext), repositoryFullName, branch);
}

// Sección D.7: crea la rama desde el SHA de `main` directamente vía la API de GitHub, sin clon
// local previo. `fromSha` debe venir de una llamada reciente a `projectBranchSha(..., "main")`.
export async function createProjectBranch(
  userId: string,
  repositoryFullName: string,
  branch: string,
  fromSha: string
): Promise<"created" | "already_exists"> {
  const row = await resolveActiveConnection(userId);
  return createBranchFromSha(decryptGitToken(row.access_token_ciphertext), repositoryFullName, branch, fromSha);
}

// --- Regla 12/16 y sección 7.9: contexto de credenciales efímero para operaciones Git ---

export interface GitProcessAuth extends WorktreeGitProcessAuth {
  dispose(): Promise<void>;
}

/**
 * Regla 16: el script temporal no contiene el token -- solo imprime una variable de entorno que
 * el proceso hijo (`git`, vía GIT_ASKPASS) recibe efímeramente en `authEnv`. `dispose()` borra el
 * directorio temporal; el token nunca se persiste en el credential store del host.
 */
export async function createGitProcessAuth(userId: string): Promise<GitProcessAuth> {
  const row = await resolveActiveConnection(userId);
  const token = decryptGitToken(row.access_token_ciphertext);
  const login = row.external_login;

  const dir = await mkdtemp(path.join(os.tmpdir(), "orchestrator-git-askpass-"));
  const scriptPath = path.join(dir, "askpass.sh");
  await writeFile(scriptPath, '#!/bin/sh\nprintf \'%s\' "$ORCHESTRATOR_GIT_ASKPASS_TOKEN"\n', "utf8");
  await chmod(scriptPath, 0o700);

  let disposed = false;
  return {
    authEnv: {
      GIT_ASKPASS: scriptPath,
      ORCHESTRATOR_GIT_ASKPASS_TOKEN: token,
    },
    cloneUrl(repoUrl: string): string {
      return httpsCloneUrlWithLogin(repoUrl, login);
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Regla 15: transporte HTTPS, credencial nunca en la URL. Se embebe el login de GitHub (dato no
 * secreto) para que git solo pida la contraseña -- que llega vía GIT_ASKPASS, nunca en la URL.
 * Acepta tanto URLs SSH (`git@host:owner/repo.git`) como HTTPS ya existentes.
 */
export function httpsCloneUrlWithLogin(repoUrl: string, login: string): string {
  const trimmed = repoUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(\.git)?\/?$/i);
  if (sshMatch) {
    const [, host, ownerRepo] = sshMatch;
    return `https://${login}@${host}/${ownerRepo}.git`;
  }
  const httpsMatch = trimmed.match(/^https:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(\.git)?\/?$/i);
  if (httpsMatch) {
    const [, host, ownerRepo] = httpsMatch;
    return `https://${login}@${host}/${ownerRepo}.git`;
  }
  return trimmed;
}
