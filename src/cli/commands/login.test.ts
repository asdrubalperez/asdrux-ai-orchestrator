import assert from "node:assert/strict";
import test from "node:test";
import type { SessionData } from "../../auth/session.js";
import type { UserRow } from "../../db/repository.js";

process.env.DATABASE_URL_DEV ??= "postgres://user:pass@127.0.0.1:1/db";

const { authenticateCliLogin } = await import("./login.js");

const user: UserRow = {
  id: "user-1",
  handle: "owner",
  password_hash: "hash",
  created_at: "2026-07-21T00:00:00.000Z",
};

test("login con password invalida no crea ni reemplaza una sesion", async () => {
  let createCalls = 0;
  await assert.rejects(
    authenticateCliLogin("owner", "incorrecta", {
      findUserByHandle: async () => user,
      verifyPassword: async () => false,
      createSession: async () => {
        createCalls += 1;
        return {} as SessionData;
      },
    }),
    /Credenciales inválidas/
  );
  assert.equal(createCalls, 0);
});
