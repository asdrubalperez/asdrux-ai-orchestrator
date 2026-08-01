import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL_DEV ??= "postgres://user:pass@127.0.0.1:1/db";

const service = await import("./gitConnectionService.js");

test("sanitizeReturnPath acepta rutas internas y rechaza URLs absolutas o protocol-relative", () => {
  assert.equal(service.sanitizeReturnPath("/projects/123"), "/projects/123");
  assert.equal(service.sanitizeReturnPath(null), null);
  assert.equal(service.sanitizeReturnPath(undefined), null);
  assert.equal(service.sanitizeReturnPath(""), null);
  assert.equal(service.sanitizeReturnPath("https://evil.example/phish"), null);
  assert.equal(service.sanitizeReturnPath("//evil.example/phish"), null);
  assert.equal(service.sanitizeReturnPath("javascript:alert(1)"), null);
  assert.equal(service.sanitizeReturnPath("\\\\evil.example"), null);
});

test("httpsCloneUrlWithLogin convierte SSH a HTTPS con el login embebido, sin el token", () => {
  const url = service.httpsCloneUrlWithLogin("git@github.com:asdrubalperez/pruebas-ia.git", "asdru");
  assert.equal(url, "https://asdru@github.com/asdrubalperez/pruebas-ia.git");
});

test("httpsCloneUrlWithLogin normaliza una URL HTTPS ya existente, reemplazando cualquier userinfo", () => {
  const withoutLogin = service.httpsCloneUrlWithLogin("https://github.com/asdrubalperez/pruebas-ia.git", "asdru");
  assert.equal(withoutLogin, "https://asdru@github.com/asdrubalperez/pruebas-ia.git");

  const withOtherLogin = service.httpsCloneUrlWithLogin(
    "https://otro@github.com/asdrubalperez/pruebas-ia",
    "asdru"
  );
  assert.equal(withOtherLogin, "https://asdru@github.com/asdrubalperez/pruebas-ia.git");
});

test("httpsCloneUrlWithLogin nunca produce una URL con el token -- solo el login, dato no secreto", () => {
  const url = service.httpsCloneUrlWithLogin("git@github.com:owner/repo.git", "asdru");
  assert.match(url, /^https:\/\/asdru@github\.com\//);
});
