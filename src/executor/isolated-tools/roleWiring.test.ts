import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentRole } from "../../contracts/executor.js";
import { ROLE_ISOLATED_POLICIES, mcpToolNames } from "./rolePolicy.js";
import { callRoleWorker, startRoleWorker } from "./roleRuntime.js";
import { IsolatedToolWorker } from "./worker.js";

const research = ["fs_read", "fs_search", "fs_glob", "web_search", "web_fetch"];
const developer = [
  "fs_read", "fs_search", "fs_glob", "fs_write", "fs_edit", "command_exec", "web_search", "web_fetch",
];

for (const provider of ["claude", "codex"] as const) {
  for (const role of ["architect", "functional", "planning", "developer"] as const) {
    test(`${provider}/${role} exposes only the closed role catalog`, () => {
      const policy = ROLE_ISOLATED_POLICIES[role];
      assert.deepEqual(policy.tools, role === "developer" ? developer : research);
      assert.equal(policy.filesystem, role === "developer" ? "workspace-write" : "read-only");
      assert.equal(policy.egress, "public");
      assert.deepEqual(
        mcpToolNames(policy),
        policy.tools.map((name) => `mcp__orchestrator_worker__${name}`),
      );
    });
  }
}

test("all five roles have no native tool catalog", () => {
  const roles: AgentRole[] = ["architect", "functional", "planning", "developer", "qa"];
  for (const role of roles) {
    assert.ok(ROLE_ISOLATED_POLICIES[role]);
  }
});

test("Developer command_exec preserves exit code, stdout, stderr and timeout", async () => {
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "developer-command-parity-"));
  const worker = new IsolatedToolWorker({
    worktree,
    policy: ROLE_ISOLATED_POLICIES.developer,
    env: { PATH: process.env.PATH },
  });
  try {
    const completed = await worker.call("command_exec", {
      program: process.execPath,
      args: ["-e", "process.stdout.write('OUT');process.stderr.write('ERR');process.exit(7)"],
      timeoutMs: 10_000,
    }) as Record<string, unknown>;
    assert.equal(completed.exitCode, 7);
    assert.equal(completed.stdout, "OUT");
    assert.equal(completed.stderr, "ERR");
    assert.equal(completed.timedOut, false);

    const timedOut = await worker.call("command_exec", {
      program: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 10000)"],
      timeoutMs: 25,
    }) as Record<string, unknown>;
    assert.equal(timedOut.timedOut, true);
    assert.notEqual(timedOut.exitCode, 0);
  } finally {
    await fs.rm(worktree, { recursive: true, force: true });
  }
});


test("role worker containers expose exact inventories and no provider credential", async (t) => {
  if (spawnSync("docker", ["version"], { stdio: "ignore" }).error) {
    t.skip("Docker CLI unavailable; covered normatively on VPS");
    return;
  }
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "role-worker-contract-"));
  await fs.writeFile(path.join(worktree, "fixture.txt"), "ROLE_FIXTURE");
  try {
    for (const role of ["architect", "functional", "planning", "developer"] as const) {
      const worker = await startRoleWorker(role, worktree, "synthetic-not-called");
      try {
        assert.deepEqual(worker.effectiveTools, ROLE_ISOLATED_POLICIES[role].tools);
        assert.match(JSON.stringify(await callRoleWorker(worker, "fs_read", { path: "fixture.txt" })), /ROLE_FIXTURE/);
        assert.match(worker.output.find((line) => line.includes("isolated_worker_ready")) ?? "", /"credentialCanaryPresent":false/);
        if (role !== "developer") {
          await assert.rejects(
            callRoleWorker(worker, "command_exec", { program: "node" }),
            /TOOL_NOT_FOUND/,
          );
        }
      } finally {
        await worker.close();
      }
    }
  } finally {
    await fs.rm(worktree, { recursive: true, force: true });
  }
});
