import assert from "node:assert/strict";
import test from "node:test";
import { selectIntakeMappingAdapter } from "./intakeMappingAdapters.js";
import type { ResolvedExecutorAuthentication } from "../auth/aiCredentialService.js";
import type { MaterializedOAuthSession } from "../auth/aiOAuthSessionService.js";

// FEATURE-025-Parte-3, sección 5.2: exactamente un camino por combinación, sin fallback. Solo se
// verifica selección estructural (adapter.map existe) -- invocar map() de verdad implicaría red real
// (HTTP) o un contenedor Docker real (OAuth), cubierto por los tests propios de cada adaptador
// (mockeados) y por la validación E2E manual.

const API_KEY_AUTH: ResolvedExecutorAuthentication = { mode: "api_key", apiKey: "sk-test" };
const FAKE_MATERIALIZED: MaterializedOAuthSession = {
  directory: "/tmp/fake-oauth-dir",
  connectionId: "fake-connection-id",
  userId: "fake-user-id",
  sessionVersion: 1,
  provider: "claude",
  originalContent: "{}",
};
const OAUTH_AUTH: ResolvedExecutorAuthentication = {
  mode: "cli_session",
  oauthDirectory: "/tmp/fake-oauth-dir",
  materialized: FAKE_MATERIALIZED,
};

test("selectIntakeMappingAdapter devuelve un adaptador con .map para las 4 combinaciones válidas", () => {
  assert.equal(typeof selectIntakeMappingAdapter("claude", API_KEY_AUTH).map, "function");
  assert.equal(typeof selectIntakeMappingAdapter("codex", API_KEY_AUTH).map, "function");
  assert.equal(typeof selectIntakeMappingAdapter("claude", OAUTH_AUTH).map, "function");
  assert.equal(typeof selectIntakeMappingAdapter("codex", OAUTH_AUTH).map, "function");
});

test("selectIntakeMappingAdapter falla explícitamente ante una combinación fuera del union (defensivo, Escenario 26/27)", () => {
  const bogusProvider = "bogus" as unknown as "claude";
  assert.throws(() => selectIntakeMappingAdapter(bogusProvider, API_KEY_AUTH), /no soportada/);
});
