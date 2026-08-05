import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { getAiOAuthConnection, type UserAiOAuthConnectionRow } from "../db/repository.js";
import { generateGitCredentialEncryptionKey } from "./gitCredentialEncryption.js";
import {
  AgentCredentialMissingError,
  AgentOAuthNotConnectedError,
  listAiCredentialStatuses,
  removeAiCredential,
  resolveExecutorAuthentication,
  setAiCredential,
} from "./aiCredentialService.js";

async function snapshotAndClearOAuthConnection(userId: string, provider: "claude" | "codex") {
  const existing = await getAiOAuthConnection(userId, provider);
  await pool.query("delete from user_ai_oauth_connections where user_id = $1 and provider = $2", [userId, provider]);
  return existing;
}

async function restoreOAuthConnection(userId: string, provider: "claude" | "codex", row: UserAiOAuthConnectionRow | null) {
  if (!row) return;
  await pool.query(
    `insert into user_ai_oauth_connections
       (id, user_id, provider, encrypted_session, status, session_version, created_at, updated_at, last_validated_at, reauth_required_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id, provider) do update set
       encrypted_session = excluded.encrypted_session, status = excluded.status,
       session_version = excluded.session_version, last_validated_at = excluded.last_validated_at,
       reauth_required_at = excluded.reauth_required_at`,
    [
      row.id,
      userId,
      provider,
      row.encrypted_session,
      row.status,
      row.session_version,
      row.created_at,
      row.updated_at,
      row.last_validated_at,
      row.reauth_required_at,
    ]
  );
}

// FEATURE-025-Parte-1: valida el mecanismo central que el handoff de revisión técnica identificó
// como críticamente riesgoso -- resolveExecutorAuthentication siempre resuelve la credencial VIGENTE
// en el momento (nunca una copia congelada). FEATURE-025-Parte-2: cli_session ya no usa el
// mecanismo compartido del host -- resuelve la conexión OAuth propia del usuario y corta con
// AgentOAuthNotConnectedError si no hay una.
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
  // La conexión OAuth de "claude" es de cuenta, compartida con el resto de la app (incluida la
  // cuenta real en el VPS dev, que puede tener una conexión real de otra Feature validada en vivo
  // en esta misma sesión) -- se guarda para restaurarla exacta al terminar, en vez de solo borrarla
  // y dejar la cuenta real degradada.
  const originalClaudeOAuth = await snapshotAndClearOAuthConnection(userId, "claude");

  try {
    // cli_session sin conexión OAuth propia -> corte técnico distinguible (FEATURE-025-Parte-2),
    // nunca resuelve con éxito ni cae a ningún mecanismo compartido del host.
    await assert.rejects(
      resolveExecutorAuthentication(userId, { executorProvider: "claude", authMode: "cli_session", model: null }),
      AgentOAuthNotConnectedError
    );

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
    await restoreOAuthConnection(userId, "claude", originalClaudeOAuth).catch(() => {});
    if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});
