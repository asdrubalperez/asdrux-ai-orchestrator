import assert from "node:assert/strict";
import test from "node:test";
import { isValidGitBranchName, suggestBranchName } from "./branchValidationService.js";

test("isValidGitBranchName acepta nombres válidos comunes", () => {
  assert.equal(isValidGitBranchName("feature/gestion-proyectos"), true);
  assert.equal(isValidGitBranchName("main"), true);
  assert.equal(isValidGitBranchName("fix-123"), true);
});

test("isValidGitBranchName rechaza sintaxis inválida (Regla D.9)", () => {
  assert.equal(isValidGitBranchName(""), false);
  assert.equal(isValidGitBranchName("/feature/x"), false);
  assert.equal(isValidGitBranchName("feature/x/"), false);
  assert.equal(isValidGitBranchName("-feature"), false);
  assert.equal(isValidGitBranchName("feature..x"), false);
  assert.equal(isValidGitBranchName("feature x"), false);
  assert.equal(isValidGitBranchName("feature~1"), false);
  assert.equal(isValidGitBranchName("feature^1"), false);
  assert.equal(isValidGitBranchName("feature:x"), false);
  assert.equal(isValidGitBranchName("feature?x"), false);
  assert.equal(isValidGitBranchName("feature*x"), false);
  assert.equal(isValidGitBranchName("feature.lock"), false);
  assert.equal(isValidGitBranchName("feature."), false);
  assert.equal(isValidGitBranchName("a".repeat(201)), false);
});

test("suggestBranchName normaliza minúsculas, espacios y acentos", () => {
  assert.equal(suggestBranchName("Gestión de proyectos por usuario"), "feature/gestion-de-proyectos-por-usuario");
  assert.equal(suggestBranchName("  Prorrateo   de propina!!  "), "feature/prorrateo-de-propina");
});

test("suggestBranchName produce siempre un nombre válido según isValidGitBranchName", () => {
  const inputs = ["", "   ", "áéíóú ÑÑ", "Caso con \"comillas\" y (paréntesis)", "a".repeat(300)];
  for (const input of inputs) {
    assert.equal(isValidGitBranchName(suggestBranchName(input)), true, `input: ${JSON.stringify(input)}`);
  }
});
