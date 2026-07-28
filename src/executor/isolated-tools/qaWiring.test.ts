import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { TOOL_SCHEMAS } from "./contracts.js";
import { QA_ISOLATED_POLICY, QA_ISOLATED_TOOL_NAMES, QA_MCP_TOOL_NAMES } from "./qaPolicy.js";
import { callQaWorker, qaMcpBridgePath, startQaWorker } from "./qaRuntime.js";

const REQUESTING_RUN_ID = "11111111-1111-4111-8111-111111111111";

test("QA policy includes artifact reads and no mutating tools or egress", () => {
  assert.deepEqual(QA_ISOLATED_POLICY.tools, [
    "fs_read", "fs_search", "fs_glob", "artifact_list", "artifact_read",
  ]);
  assert.equal(QA_ISOLATED_POLICY.filesystem, "read-only");
  assert.equal(QA_ISOLATED_POLICY.egress, "none");
  assert.deepEqual(QA_MCP_TOOL_NAMES, [
    "mcp__orchestrator_worker__fs_read",
    "mcp__orchestrator_worker__fs_search",
    "mcp__orchestrator_worker__fs_glob",
    "mcp__orchestrator_worker__artifact_list",
    "mcp__orchestrator_worker__artifact_read",
  ]);
  for (const name of QA_ISOLATED_TOOL_NAMES) assert.equal(TOOL_SCHEMAS[name].args.additionalProperties, false);
});

test("QA worker process exposes only read tools and receives no credential", async (t) => {
  const docker = spawnSync("docker", ["version"], { stdio: "ignore" });
  if (docker.error || docker.status !== 0) {
    t.skip("Docker CLI unavailable; covered normatively on VPS");
    return;
  }
  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "qa-worker-contract-"));
  await fs.writeFile(path.join(worktree, "fixture.txt"), "QA_FIXTURE");
  const worker = await startQaWorker(worktree, REQUESTING_RUN_ID);
  try {
    assert.deepEqual(worker.effectiveTools, [
      "fs_read", "fs_search", "fs_glob", "artifact_list", "artifact_read",
    ]);
    const allowed = await callQaWorker(worker, "fs_read", { path: "fixture.txt" });
    assert.match(JSON.stringify(allowed), /QA_FIXTURE/);

    await assert.rejects(
      callQaWorker(worker, "command_exec", { program: "node" }),
      /TOOL_NOT_FOUND/,
    );
    assert.match(worker.output[0], /"credentialCanaryPresent":false/);
    assert.match(worker.output[0], /"databaseCredentialPresent":false/);
  } finally {
    await worker.close();
    await fs.rm(worktree, { recursive: true, force: true });
  }
});

test("Claude MCP stdio inventory matches QA policy and denies resources", async () => {
  const child = spawn(process.execPath, [qaMcpBridgePath()], {
    env: {
      ...process.env,
      ISOLATED_WORKER_SOCKET: "/tmp/missing-worker.sock",
      ISOLATED_CHANNEL_TOKEN: "synthetic",
      ISOLATED_TOOL_SCHEMAS: JSON.stringify(Object.fromEntries(
        QA_ISOLATED_TOOL_NAMES.map((name) => [name, TOOL_SCHEMAS[name].args]),
      )),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses: unknown[] = [];
  const received = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP response timeout")), 2_000);
    output.on("line", (line) => {
      responses.push(JSON.parse(line));
      if (responses.length === 2) { clearTimeout(timer); resolve(); }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "resources/list" }) + "\n");
  await received;
  child.kill();
  const list = responses.find((value: any) => value.id === 1) as any;
  const denied = responses.find((value: any) => value.id === 2) as any;
  assert.deepEqual(list.result.tools.map((tool: any) => tool.name), [...QA_ISOLATED_TOOL_NAMES]);
  assert.equal(denied.error.code, -32601);
});
