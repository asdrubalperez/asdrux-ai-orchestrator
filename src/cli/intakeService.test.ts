import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import {
  deleteRoleAgentConfigOverride,
  setRoleAgentConfigOverride,
} from "../db/repository.js";
import { removeAiCredential } from "../auth/aiCredentialService.js";
import { generateGitCredentialEncryptionKey } from "../auth/gitCredentialEncryption.js";
import {
  IntakeMappingAuthModeUnsupportedError,
  IntakeMappingProviderUnsupportedError,
  mapIntakeText,
} from "./intakeService.js";
import { AgentCredentialMissingError } from "../auth/aiCredentialService.js";

// FEATURE-025-Parte-1 (ampliación): el mapeo de intake se trata como un sexto "rol" configurable
// más -- mismo mecanismo de resolución que los 5 roles reales. Como todavía solo sabe hablar con
// Claude vía API key (Codex/OAuth quedan para FEATURE-025-Parte-3), estos casos deben cortar ANTES
// de llegar a mapBusinessCase (nunca llaman a la API real de Anthropic).
test("mapIntakeText corta con un error distinguible cuando 'intake' resuelve a un proveedor o modo no soportado", async (t) => {
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
    // "intake" resuelto a Codex -- todavía no soportado, corta antes de resolver credencial.
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "codex", authMode: "api_key", model: null });
    await assert.rejects(
      mapIntakeText({ userId, inputText: "texto de prueba" }),
      IntakeMappingProviderUnsupportedError
    );

    // "intake" en Claude pero con cli_session -- mapBusinessCase no tiene ningún camino OAuth.
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "claude", authMode: "cli_session", model: null });
    await assert.rejects(
      mapIntakeText({ userId, inputText: "texto de prueba" }),
      IntakeMappingAuthModeUnsupportedError
    );

    // "intake" en Claude + api_key, sin credencial propia -- mismo corte técnico que los 5 roles.
    // No se prueba el camino "credencial presente" acá: eso implicaría una llamada de red real a
    // la API de Anthropic (fuera de lo que este test debe ejercitar) -- ya cubierto indirectamente
    // por resolveExecutorAuthentication en aiCredentialService.test.ts.
    await setRoleAgentConfigOverride(userId, "intake", { executorProvider: "claude", authMode: "api_key", model: null });
    await removeAiCredential(userId, "claude");
    await assert.rejects(mapIntakeText({ userId, inputText: "texto de prueba" }), AgentCredentialMissingError);
  } finally {
    await deleteRoleAgentConfigOverride(userId, "intake").catch(() => {});
    await removeAiCredential(userId, "claude").catch(() => {});
    if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});
