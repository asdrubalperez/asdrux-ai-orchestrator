import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "./passwordPolicy.js";

test("validatePasswordPolicy acepta una contraseña que cumple las 5 reglas", () => {
  assert.deepEqual(validatePasswordPolicy("Abcdefg123!"), []);
});

test("validatePasswordPolicy reporta cada regla incumplida por separado", () => {
  const violations = validatePasswordPolicy("abc");
  const rules = violations.map((v) => v.rule);
  assert.ok(rules.includes("min_length"));
  assert.ok(rules.includes("uppercase"));
  assert.ok(rules.includes("number"));
  assert.ok(rules.includes("symbol"));
  assert.ok(!rules.includes("lowercase"));
});

test(`validatePasswordPolicy exige al menos ${PASSWORD_MIN_LENGTH} caracteres`, () => {
  const shortButComplete = "Ab1!".padEnd(PASSWORD_MIN_LENGTH - 1, "a");
  assert.ok(validatePasswordPolicy(shortButComplete).some((v) => v.rule === "min_length"));
});
