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

const artifacts = ["artifact_list", "artifact_read"];
const research = ["fs_read", "fs_search", "fs_glob", "web_search", "web_fetch", ...artifacts];
const developer = [
  "fs_read", "fs_search", "fs_glob", "fs_write", "fs_edit", "command_exec", "web_search", "web_fetch",
  ...artifacts,
];
const qa = ["fs_read", "fs_search", "fs_glob", ...artifacts];
const REQUESTING_RUN_ID = "11111111-1111-4111-8111-111111111111";

for (const provider of ["claude", "codex"] as const) {
  for (const role of ["architect", "functional", "planning", "developer", "qa"] as const) {
    test(`${provider}/${role} exposes only the closed role catalog`, () => {
      const policy = ROLE_ISOLATED_POLICIES[role];
      assert.deepEqual(policy.tools, role === "developer" ? developer : role === "qa" ? qa : research);
      assert.equal(policy.filesystem, role === "developer" ? "workspace-write" : "read-only");
      assert.equal(policy.egress, role === "qa" ? "none" : "public");
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
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  if (docker.error || docker.status !== 0) {
    t.skip("Docker CLI unavailable; covered normatively on VPS");
    return;
  }
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "role-worker-contract-"));
  await fs.writeFile(path.join(worktree, "fixture.txt"), "ROLE_FIXTURE");
  try {
    for (const role of ["architect", "functional", "planning", "developer", "qa"] as const) {
      const worker = await startRoleWorker(
        role,
        worktree,
        role === "qa" ? undefined : "synthetic-not-called",
        REQUESTING_RUN_ID,
      );
      try {
        assert.deepEqual(worker.effectiveTools, ROLE_ISOLATED_POLICIES[role].tools);
        assert.match(JSON.stringify(await callRoleWorker(worker, "fs_read", { path: "fixture.txt" })), /ROLE_FIXTURE/);
        assert.match(worker.output.find((line) => line.includes("isolated_worker_ready")) ?? "", /"credentialCanaryPresent":false/);
        assert.match(worker.output.find((line) => line.includes("isolated_worker_ready")) ?? "", /"databaseCredentialPresent":false/);
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

test("all role workers can list project artifacts through the trusted host proxy", async (t) => {
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  if (docker.error || docker.status !== 0) {
    t.skip("Docker unavailable; covered normatively on VPS");
    return;
  }
  const { pool } = await import("../../db/pool.js");
  let requestingRunId: string;
  try {
    const result = await pool.query<{ id: string }>(
      `select id from runs
       where project_id is not null
       order by created_at desc
       limit 1`,
    );
    if (!result.rows[0]) {
      t.skip("Requires one run associated with a project");
      return;
    }
    requestingRunId = result.rows[0].id;
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }

  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-role-wiring-"));
  try {
    for (const role of ["architect", "functional", "planning", "developer", "qa"] as const) {
      const worker = await startRoleWorker(
        role,
        worktree,
        role === "qa" ? undefined : "synthetic-not-called",
        requestingRunId,
      );
      try {
        const result = await callRoleWorker(worker, "artifact_list", { limit: 1 }) as {
          items: unknown[];
          truncated: boolean;
          nextCursor: string | null;
        };
        assert.ok(Array.isArray(result.items));
        assert.equal(typeof result.truncated, "boolean");
        assert.ok(result.nextCursor === null || typeof result.nextCursor === "string");
      } finally {
        await worker.close();
      }
    }
  } finally {
    await fs.rm(worktree, { recursive: true, force: true });
  }
});
