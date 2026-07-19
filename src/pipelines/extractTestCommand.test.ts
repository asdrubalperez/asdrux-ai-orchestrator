import test from "node:test";
import assert from "node:assert/strict";
import { extractTestCommand } from "./extractTestCommand.js";

test("extrae COMANDO_TEST desde el artifact estructurado de Claude", () => {
  assert.equal(
    extractTestCommand({ text: "plan", comandoTest: "node --test src/discount.test.mjs" }),
    "node --test src/discount.test.mjs"
  );
});

test("extrae COMANDO_TEST desde el artifact textual de Codex", () => {
  const artifact = [
    "PLAN_DEVELOPER:",
    "- Crear src/discount.mjs.",
    "",
    "COMANDO_TEST: node --test src/discount.test.mjs",
  ].join("\n");

  assert.equal(extractTestCommand(artifact), "node --test src/discount.test.mjs");
});
