import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../db/pool.js";
import { consumeValidAccountToken, findValidAccountToken, issueAccountToken } from "./accountTokens.js";

// Regla 5.5: aleatorio, hash únicamente, expiración, uso único, revocable por reenvío. Corre
// contra la DB de integración real (mismo criterio que repository.test.ts) -- se salta si no hay
// Postgres disponible localmente (cubierto en VPS).
test("issueAccountToken / consumeValidAccountToken: uso único, reenvío invalida el anterior", async (t) => {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }
  client.release();

  const userId = randomUUID();
  await pool.query("insert into users (id, handle, email, status) values ($1, $2, $3, 'active')", [
    userId,
    `test-token-${userId}`,
    `test-token-${userId}@example.com`,
  ]);

  try {
    const first = await issueAccountToken(userId, "email_verification");
    // El primer token es válido...
    assert.ok(await findValidAccountToken(first.rawToken, "email_verification"));

    // ...hasta que se reenvía: el anterior queda revocado, ya no valida.
    const second = await issueAccountToken(userId, "email_verification");
    assert.equal(await findValidAccountToken(first.rawToken, "email_verification"), null);
    assert.ok(await findValidAccountToken(second.rawToken, "email_verification"));

    // Consumir el segundo lo invalida para un segundo uso (uso único).
    const consumed = await consumeValidAccountToken(second.rawToken, "email_verification");
    assert.ok(consumed);
    assert.equal(await consumeValidAccountToken(second.rawToken, "email_verification"), null);

    // Un token de otro propósito con el mismo rawToken (coincidencia imposible en la práctica,
    // pero la query filtra por purpose explícitamente) no debe validar.
    assert.equal(await findValidAccountToken(second.rawToken, "password_reset"), null);
  } finally {
    // account_tokens.user_id no tiene ON DELETE CASCADE (mismo criterio que sessions/
    // user_agent_config -- ver migrations/0024) -- limpieza manual en orden.
    await pool.query("delete from account_tokens where user_id = $1", [userId]);
    await pool.query("delete from users where id = $1", [userId]);
  }
});
