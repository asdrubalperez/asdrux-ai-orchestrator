import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGitHubAuthorizeUrl,
  checkGitHubToken,
  exchangeCodeForToken,
  fetchGitHubIdentity,
  GitHubOAuthError,
  type GitHubOAuthConfig,
} from "./githubOAuthClient.js";

const config: GitHubOAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "https://orchestrator.example/auth/github/callback",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("buildGitHubAuthorizeUrl incluye scope repo y el state exacto, sin filtrar el client_secret", () => {
  const url = buildGitHubAuthorizeUrl(config, "state-123");
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(parsed.searchParams.get("scope"), "repo");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(url.includes("client-secret"), false);
});

test("exchangeCodeForToken devuelve accessToken y scopes en éxito", async () => {
  const result = await exchangeCodeForToken(config, "code-abc", async () =>
    jsonResponse(200, { access_token: "gho_token", scope: "repo, read:user" })
  );
  assert.equal(result.accessToken, "gho_token");
  assert.deepEqual(result.scopes, ["repo", "read:user"]);
});

test("exchangeCodeForToken lanza error explícito si GitHub no devuelve access_token", async () => {
  await assert.rejects(
    exchangeCodeForToken(config, "code-abc", async () => jsonResponse(400, { error: "bad_verification_code" })),
    GitHubOAuthError
  );
});

test("fetchGitHubIdentity mapea id/login y falla explícito ante status no-ok", async () => {
  const identity = await fetchGitHubIdentity("gho_token", async () => jsonResponse(200, { id: 42, login: "asdru" }));
  assert.deepEqual(identity, { externalUserId: "42", login: "asdru" });

  await assert.rejects(fetchGitHubIdentity("gho_token", async () => jsonResponse(401, {})), GitHubOAuthError);
});

test("checkGitHubToken usa Basic Auth con client_id:client_secret, no el token del usuario", async () => {
  let capturedAuth: string | null = null;
  await checkGitHubToken(config, "gho_token", async (_url, init) => {
    capturedAuth = (init?.headers as Record<string, string>)?.authorization ?? null;
    return jsonResponse(200, {});
  });
  const expected = `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`;
  assert.equal(capturedAuth, expected);
});

test("checkGitHubToken devuelve false ante respuesta no-ok sin lanzar", async () => {
  const valid = await checkGitHubToken(config, "gho_token", async () => jsonResponse(404, {}));
  assert.equal(valid, false);
});
