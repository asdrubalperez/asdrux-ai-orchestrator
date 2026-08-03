import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { pool } from "../db/pool.js";
import { createAiOAuthConnection, deleteAiOAuthConnection, getAiOAuthConnection } from "../db/repository.js";
import { generateGitCredentialEncryptionKey } from "./gitCredentialEncryption.js";
import { encryptOAuthSession } from "./aiOAuthSessionEnvelope.js";
import {
  cleanupMaterializedOAuthSession,
  collectAndPromoteOAuthSession,
  materializeOAuthSession,
  resolveOAuthConnection,
} from "./aiOAuthSessionService.js";

// FEATURE-025-Parte-2: valida el ciclo completo de materialización -> collect -> promote (CAS) sin
// necesitar una cuenta real de Claude/Codex -- el contenido de la sesión es opaco para este
// servicio, no hace falta que sea un token válido para probar la mecánica de persistencia.
test("materializeOAuthSession/collectAndPromoteOAuthSession: promueve solo cuando el contenido cambió, respeta CAS", async (t) => {
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
    // Sin conexión -> not_connected, nunca cae a otra cosa.
    const beforeConnect = await resolveOAuthConnection(userId, "claude");
    assert.deepEqual(beforeConnect, { status: "not_connected" });

    const initialPlaintext = JSON.stringify({ accessToken: "at-v1" });
    const encrypted = encryptOAuthSession(initialPlaintext, "claude");
    await createAiOAuthConnection(userId, "claude", encrypted);

    const resolved = await resolveOAuthConnection(userId, "claude");
    assert.equal(resolved.status, "connected");
    if (resolved.status !== "connected") return;
    assert.equal(resolved.connection.session_version, 1);

    // Materializar -- el archivo escribible debe existir en el temporal con el contenido original.
    const materialized = await materializeOAuthSession(resolved.connection);
    const filePath = path.join(materialized.directory, ".credentials.json");
    assert.equal(await readFile(filePath, "utf8"), initialPlaintext);

    // Sin cambios -> collectAndPromote no toca session_version.
    await collectAndPromoteOAuthSession(materialized);
    const afterNoChange = await getAiOAuthConnection(userId, "claude");
    assert.equal(afterNoChange?.session_version, 1);

    // El CLI "refrescó" el archivo -> debe promoverse a session_version 2.
    const refreshedPlaintext = JSON.stringify({ accessToken: "at-v2" });
    await writeFile(filePath, refreshedPlaintext, "utf8");
    await collectAndPromoteOAuthSession(materialized);
    const afterRefresh = await getAiOAuthConnection(userId, "claude");
    assert.equal(afterRefresh?.session_version, 2);

    // CAS perdido: otro proceso ya promovió (afterRefresh ya está en v2) -- una materialización
    // vieja (todavía en v1) que intenta promover no debe pisar la versión más nueva.
    await writeFile(filePath, JSON.stringify({ accessToken: "at-stale" }), "utf8");
    await collectAndPromoteOAuthSession(materialized); // materialized.sessionVersion sigue en 1
    const afterStaleAttempt = await getAiOAuthConnection(userId, "claude");
    assert.equal(afterStaleAttempt?.session_version, 2, "el CAS perdido no debe alterar la versión canónica");

    await cleanupMaterializedOAuthSession(materialized);
  } finally {
    await deleteAiOAuthConnection(userId, "claude").catch(() => {});
    if (originalKey === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});
