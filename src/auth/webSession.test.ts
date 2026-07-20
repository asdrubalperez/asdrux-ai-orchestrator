import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL_DEV ??= "postgres://user:pass@127.0.0.1:1/db";

const webSession = await import("./webSession.js");

test("construye y parsea cookie sessionId.rawToken", () => {
  const cookieValue = webSession.buildSessionCookieValue("session-id", "raw-token");
  assert.deepEqual(webSession.parseSessionCookieValue(cookieValue), {
    sessionId: "session-id",
    rawToken: "raw-token",
  });
  assert.equal(webSession.parseSessionCookieValue("session-id"), null);
});

test("hash de token usa sha256 deterministico sin guardar token plano", () => {
  const hash = webSession.hashSessionToken("raw-token");
  assert.equal(hash, webSession.hashSessionToken("raw-token"));
  assert.notEqual(hash, "raw-token");
  assert.equal(hash.length, 64);
});

test("cookie de sesion incluye flags cross-origin requeridos", () => {
  const header = webSession.sessionCookieHeader({
    value: "session.raw",
    maxAgeSeconds: 60,
    secure: true,
    domain: "api.example.com",
  });

  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=None/);
  assert.match(header, /Domain=api.example.com/);
});

test("rate limit bloquea despues de 5 fallos en ventana activa", () => {
  webSession.resetLoginRateLimitsForTests();
  const ip = "203.0.113.10";
  for (let i = 0; i < 5; i++) {
    assert.equal(webSession.loginRateLimitExceeded(ip, 1000), false);
    webSession.recordFailedLogin(ip, 1000);
  }

  assert.equal(webSession.loginRateLimitExceeded(ip, 1000), true);
  assert.equal(webSession.loginRateLimitExceeded(ip, 16 * 60 * 1000), false);
});

test("validacion de origen acepta Origin o Referer exactos", () => {
  const allowedOrigin = "https://ui.example.com";
  assert.equal(
    webSession.allowedOriginForRequest(requestWithHeaders({ Origin: allowedOrigin }), allowedOrigin),
    true
  );
  assert.equal(
    webSession.allowedOriginForRequest(requestWithHeaders({ Referer: `${allowedOrigin}/runs` }), allowedOrigin),
    true
  );
  assert.equal(
    webSession.allowedOriginForRequest(requestWithHeaders({ Origin: "https://evil.example.com" }), allowedOrigin),
    false
  );
});

function requestWithHeaders(headers: Record<string, string>) {
  return {
    header(name: string) {
      return headers[name] ?? headers[name.toLowerCase()];
    },
  } as import("express").Request;
}
