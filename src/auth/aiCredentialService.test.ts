import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { generateGitCredentialEncryptionKey } from "./gitCredentialEncryption.js";
import {
  AgentCredentialMissingError,
  listAiCredentialStatuses,
  removeAiCredential,
  resolveExecutorAuthentication,
  setAiCredential,
} from "./aiCredentialService.js";

// FEATURE-025-Parte-1: valida el mecanismo central que el handoff de revisión técnica identificó
// como críticamente riesgoso -- resolveExecutorAuthentication siempre resuelve la credencial VIGENTE
// en el momento (nunca una copia congelada), y cli_session nunca exige ni toca ninguna credencial
// (Regla 5.5.2, sigue usando el mecanismo compartido del host hasta FEATURE-025-Parte-2).
//
// Sin transacción/rollback (mismo criterio que gitConnectionService.ts: sus funciones de
// repository.ts tampoco aceptan un client inyectado) -- limpieza manual en el finally.
test("resolveExecutorAuthentication: ausencia, alta, rotación y eliminación de credencial propia", async (t) => {
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
    // cli_session nunca exige credencial, sin importar si el usuario tiene una configurada o no.
    const cliSessionAuth = await resolveExecutorAuthentication(userId, {
      executorProvider: "claude",
      authMode: "cli_session",
      model: null,
    });
    assert.deepEqual(cliSessionAuth, { mode: "cli_session" });

    // api_key sin credencial propia -> corte técnico, nunca fallback a una clave global.
    await assert.rejects(
      resolveExecutorAuthentication(userId, { executorProvider: "claude", authMode: "api_key", model: null }),
      AgentCredentialMissingError
    );

    // Alta de credencial -> queda configurada, sin exponer el secreto en el estado.
    const afterCreate = await setAiCredential(userId, "claude", "sk-ant-original-key");
    assert.equal(afterCreate.configured, true);
    const statuses = await listAiCredentialStatuses(userId);
    const claudeStatus = statuses.find((s) => s.provider === "claude");
    assert.equal(claudeStatus?.configured, true);
    assert.equal((claudeStatus as unknown as Record<string, unknown>).apiKey, undefined);

    // La resolución en runtime usa la credencial recién cargada.
    const resolved = await resolveExecutorAuthentication(userId, {
      executorProvider: "claude",
      authMode: "api_key",
      model: null,
    });
    assert.deepEqual(resolved, { mode: "api_key", apiKey: "sk-ant-original-key" });

    // Rotación (Escenario 8/14): sustituir reemplaza el secreto anterior, sin versionarlo.
    await setAiCredential(userId, "claude", "sk-ant-rotated-key");
    const resolvedAfterRotation = await resolveExecutorAuthentication(userId, {
      executorProvider: "claude",
      authMode: "api_key",
      model: null,
    });
    assert.deepEqual(resolvedAfterRotation, { mode: "api_key", apiKey: "sk-ant-rotated-key" });

    // Eliminación (Escenario 9/15): un reintento o ejecución posterior debe bloquearse, sin
    // fallback -- mismo criterio que la ausencia inicial.
    await removeAiCredential(userId, "claude");
    await assert.rejects(
      resolveExecutorAuthentication(userId, { executorProvider: "claude", authMode: "api_key", model: null }),
      AgentCredentialMissingError
    );

    // Aislamiento entre proveedores: configurar "claude" nunca satisface "codex".
    await setAiCredential(userId, "claude", "sk-ant-again");
    await assert.rejects(
      resolveExecutorAuthentication(userId, { executorProvider: "codex", authMode: "api_key", model: null }),
      AgentCredentialMissingError
    );
  } finally {
    await removeAiCredential(userId, "claude").catch(() => {});
    await removeAiCredential(userId, "codex").catch(() => {});
    if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});
