import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRow } from "../db/repository.js";
import type { SessionData } from "./session.js";

process.env.DATABASE_URL_DEV ??= "postgres://user:pass@127.0.0.1:1/db";

const sessionModule = await import("./session.js");
const core = await import("./sessionCore.js");

const localSession: SessionData = {
  sessionId: "session-1",
  rawToken: "raw-token",
  userId: "local-user",
  createdAt: "2026-07-21T00:00:00.000Z",
  expiresAt: "2026-07-23T00:00:00.000Z",
};

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    user_id: "db-user",
    token_hash: core.hashSessionToken("raw-token"),
    created_at: "2026-07-21T00:00:00.000Z",
    expires_at: "2026-07-23T00:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

test("parseSessionData rechaza formatos viejos, JSON corrupto y valores invalidos", () => {
  const invalidValues = [
    "{",
    "null",
    "[]",
    '""',
    JSON.stringify({ userId: "old", token: "old", expiresAt: localSession.expiresAt }),
    JSON.stringify({ ...localSession, rawToken: "" }),
    JSON.stringify({ ...localSession, expiresAt: "not-a-date" }),
  ];
  for (const value of invalidValues) {
    assert.throws(() => sessionModule.parseSessionData(value), /Sesión expirada o inexistente/);
  }
});

test("validatedSessionData usa user_id de DB y rechaza token o fila revocada", () => {
  assert.equal(sessionModule.validatedSessionData(localSession, row(), Date.parse("2026-07-22"))?.userId, "db-user");
  assert.equal(
    sessionModule.validatedSessionData(localSession, row({ token_hash: core.hashSessionToken("other") })),
    null
  );
  assert.equal(sessionModule.validatedSessionData(localSession, row({ revoked_at: "2026-07-22T00:00:00Z" })), null);
  assert.equal(sessionModule.validatedSessionData(localSession, null), null);
});

test("readValidSession distingue DB no disponible de archivo invalido", async () => {
  await assert.rejects(
    sessionModule.readValidSession({
      readLocalSession: async () => localSession,
      getSessionById: async () => {
        throw new Error("db offline");
      },
      now: () => Date.parse("2026-07-22T00:00:00Z"),
    }),
    /No se pudo validar la sesión en el servidor: db offline/
  );

  await assert.rejects(
    sessionModule.readValidSession({
      readLocalSession: async () => null,
      getSessionById: async () => row(),
      now: () => Date.parse("2026-07-22T00:00:00Z"),
    }),
    /Sesión expirada o inexistente/
  );
});

test("closeSession conserva archivo si falla DB y distingue fallo de borrado posterior", async () => {
  let removeCalls = 0;
  await assert.rejects(
    sessionModule.closeSession({
      readLocalSession: async () => localSession,
      revokeSession: async () => {
        throw new Error("db offline");
      },
      removeLocalSession: async () => {
        removeCalls += 1;
      },
    }),
    /El archivo local no fue eliminado/
  );
  assert.equal(removeCalls, 0);

  await assert.rejects(
    sessionModule.closeSession({
      readLocalSession: async () => localSession,
      revokeSession: async () => undefined,
      removeLocalSession: async () => {
        throw new Error("permission denied");
      },
    }),
    /sesión fue revocada.*no se pudo eliminar.*permission denied/
  );
});

test("closeSession es idempotente cuando ya no existe archivo local", async () => {
  let revokeCalls = 0;
  let removeCalls = 0;
  const result = await sessionModule.closeSession({
    readLocalSession: async () => null,
    revokeSession: async () => {
      revokeCalls += 1;
    },
    removeLocalSession: async () => {
      removeCalls += 1;
    },
  });
  assert.equal(result, "no_local_session");
  assert.equal(revokeCalls, 0);
  assert.equal(removeCalls, 0);
});

test("createSession compensa la fila nueva si falla la escritura atomica", async () => {
  const revoked: string[] = [];
  await assert.rejects(
    sessionModule.createSession("db-user", {
      createSessionRow: async () => row({ id: "new-session" }),
      getSessionById: async () => null,
      revokeSession: async (sessionId) => {
        revoked.push(sessionId);
      },
      readLocalSession: async () => localSession,
      writeLocalSession: async () => {
        throw new Error("disk full");
      },
      removeLocalSession: async () => undefined,
      now: () => Date.parse("2026-07-22T00:00:00Z"),
      generateRawToken: () => "new-raw-token",
      warn: () => undefined,
    }),
    /disk full/
  );
  assert.deepEqual(revoked, ["new-session"]);
});

test("createSession escribe la nueva sesion antes de revocar la anterior", async () => {
  const events: string[] = [];
  const created = await sessionModule.createSession("db-user", {
    createSessionRow: async () => {
      events.push("create-new");
      return row({ id: "new-session" });
    },
    getSessionById: async () => null,
    revokeSession: async (sessionId) => {
      events.push(`revoke-${sessionId}`);
    },
    readLocalSession: async () => localSession,
    writeLocalSession: async () => {
      events.push("write-new");
    },
    removeLocalSession: async () => undefined,
    now: () => Date.parse("2026-07-22T00:00:00Z"),
    generateRawToken: () => "new-raw-token",
    warn: () => undefined,
  });

  assert.equal(created.sessionId, "new-session");
  assert.deepEqual(events, ["create-new", "write-new", "revoke-session-1"]);
});
