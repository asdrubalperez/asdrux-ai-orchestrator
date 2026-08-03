import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import {
  deleteRoleAgentConfigOverride,
  setRoleAgentConfigOverride,
} from "../db/repository.js";
import { removeAiCredential } from "../auth/aiCredentialService.js";
import { generateGitCredentialEncryptionKey } from "../auth/gitCredentialEncryption.js";
import { mapIntakeText } from "./intakeService.js";
import { AgentCredentialMissingError, AgentOAuthNotConnectedError } from "../auth/aiCredentialService.js";

// FEATURE-025-Parte-3: "intake" ahora soporta las 4 combinaciones (Claude/Codex x api_key/
// cli_session), igual que los 5 roles reales -- el corte ya no depende del proveedor/modo, sino
// exclusivamente de si hay credencial/conexión propia resuelta. Sin credencial (api_key) o sin
// conexión OAuth (cli_session), mapIntakeText corta ANTES de invocar a ningún adaptador -- nunca
// llama a la red real de ningún proveedor en este test.
test("mapIntakeText corta con un error distinguible cuando 'intake' no tiene credencial/conexión propia, para las 4 combinaciones", async (t) => {
  try {
    await pool.query("select 1");
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }
  const prerequisite = await pool.query<{ owner_id: string }>(
    "select id as owner_id from users order by created_at asc limit 1"
  );
  if (!prerequisite.rows[0]) {
    t.skip("Requires at least one user in the integration database");
    return;
  }
  const userId = prerequisite.rows[0].owner_id;

  const originalKey = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = generateGitCredentialEncryptionKey();

  try {
    // Claude + api_key, sin credencial propia -- mismo corte técnico que los 5 roles reales.
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "claude", authMode: "api_key", model: null });
    await removeAiCredential(userId, "claude");
    await assert.rejects(mapIntakeText({ userId, inputText: "texto de prueba" }), AgentCredentialMissingError);

    // Codex + api_key, sin credencial propia -- ídem, ahora soportado (antes cortaba por provider).
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "codex", authMode: "api_key", model: null });
    await removeAiCredential(userId, "codex");
    await assert.rejects(mapIntakeText({ userId, inputText: "texto de prueba" }), AgentCredentialMissingError);

    // Claude + cli_session, sin conexión OAuth -- ahora soportado (antes cortaba por authMode).
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "claude", authMode: "cli_session", model: null });
    await assert.rejects(mapIntakeText({ userId, inputText: "texto de prueba" }), AgentOAuthNotConnectedError);

    // Codex + cli_session, sin conexión OAuth -- ídem.
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "codex", authMode: "cli_session", model: null });
    await assert.rejects(mapIntakeText({ userId, inputText: "texto de prueba" }), AgentOAuthNotConnectedError);

    // No se prueba el camino "credencial/conexión presente" acá: implicaría una llamada de red real
    // (HTTP) o levantar un contenedor Docker real (OAuth) -- fuera de lo que un test unitario debe
    // ejercitar. La selección de adaptador está cubierta por intakeMappingAdapters.test.ts; cada
    // adaptador HTTP por su propio *.test.ts con fetch mockeado.
  } finally {
    await deleteRoleAgentConfigOverride(userId, "intake").catch(() => {});
    await removeAiCredential(userId, "claude").catch(() => {});
    await removeAiCredential(userId, "codex").catch(() => {});
    if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});
