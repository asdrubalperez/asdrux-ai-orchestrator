import assert from "node:assert/strict";
import test from "node:test";
import { parseTestCommand } from "./testExecutor.js";

test("parseTestCommand divide un COMANDO_TEST simple en executable + args", () => {
  assert.deepEqual(parseTestCommand("node --test src/discount.test.mjs"), {
    executable: "node",
    args: ["--test", "src/discount.test.mjs"],
  });
});

// FEATURE-021: antes de esta Feature, un COMANDO_TEST con && producía tokens sueltos ejecutados
// igual (sin shell real de por medio) — causa confirmada del TS5042 de la prueba real que motivó
// esta Feature. El build ya lo garantiza BuildExecutor por separado; COMANDO_TEST nunca necesita
// un operador de shell.
test("parseTestCommand rechaza && explícitamente, en vez de dividirlo en tokens sueltos", () => {
  assert.throws(
    () => parseTestCommand("npm run build && node --test dist/x.test.js"),
    /no puede contener operadores de shell/
  );
});

test("parseTestCommand rechaza ; y |", () => {
  assert.throws(() => parseTestCommand("node --test a.js; node --test b.js"), /no puede contener operadores de shell/);
  assert.throws(() => parseTestCommand("node --test a.js | tee out.log"), /no puede contener operadores de shell/);
});

test("parseTestCommand rechaza un COMANDO_TEST vacío", () => {
  assert.throws(() => parseTestCommand("   "), /vacío o no parseable/);
});
