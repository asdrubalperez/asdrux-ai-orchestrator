import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGitCloneUrl } from "./worktree.js";

test("normalizeGitCloneUrl convierte https de GitHub a SSH", () => {
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo"), "git@github.com:owner/repo.git");
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo.git"), "git@github.com:owner/repo.git");
  assert.equal(normalizeGitCloneUrl("https://github.com/owner/repo/"), "git@github.com:owner/repo.git");
});

test("normalizeGitCloneUrl deja intacta una URL SSH ya existente", () => {
  assert.equal(normalizeGitCloneUrl("git@github.com:owner/repo.git"), "git@github.com:owner/repo.git");
});

test("normalizeGitCloneUrl deja intactas URLs de otros hosts", () => {
  assert.equal(normalizeGitCloneUrl("https://gitlab.com/owner/repo"), "https://gitlab.com/owner/repo");
  assert.equal(normalizeGitCloneUrl("https://example.com/owner/repo.git"), "https://example.com/owner/repo.git");
});

test("normalizeGitCloneUrl recorta espacios sin alterar el resto", () => {
  assert.equal(normalizeGitCloneUrl("  https://github.com/owner/repo  "), "git@github.com:owner/repo.git");
});
