import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IsolatedToolName } from "./contracts.js";
import { QA_ISOLATED_TOOL_NAMES } from "./qaPolicy.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, "..", "..", "..");
const DEFAULT_WORKER_IMAGE = "ai-orchestrator-developer:latest";

export interface QaWorkerHandle {
  socketPath: string;
  socketDirectory: string;
  channelToken: string;
  effectiveTools: readonly string[];
  output: string[];
  close(): Promise<void>;
}

export async function startQaWorker(worktree: string, signal?: AbortSignal): Promise<QaWorkerHandle> {
  const channelToken = randomBytes(32).toString("base64url");
  const socketDirectory = await mkdtemp(path.join(os.tmpdir(), "qa-worker-channel-"));
  await chmod(socketDirectory, 0o700);
  const socketPath = path.join(socketDirectory, "worker.sock");
  const containerSocket = "/channel/worker.sock";
  const child = spawn("docker", [
    "run", "--rm", "-i", "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m",
    "-v", `${worktree}:/workspace:ro`,
    "-v", `${socketDirectory}:/channel:rw`,
    "-v", `${path.join(repositoryRoot, "src")}:/runtime/src:ro`,
    "-v", `${path.join(repositoryRoot, "node_modules")}:/runtime/node_modules:ro`,
    "-e", "QA_WORKTREE=/workspace",
    "-e", "QA_CHANNEL_TOKEN",
    "-e", `QA_WORKER_SOCKET=${containerSocket}`,
    DEFAULT_WORKER_IMAGE,
    "node", "--import", "/runtime/node_modules/tsx/dist/loader.mjs",
    "/runtime/src/executor/isolated-tools/qaWorkerServer.ts",
  ], {
    env: { ...dockerEnvironment(), QA_CHANNEL_TOKEN: channelToken },
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  });
  const output: string[] = [];
  try {
    const ready = await waitForReady(child, output);
    if (JSON.stringify(ready.tools) !== JSON.stringify(QA_ISOLATED_TOOL_NAMES)) {
      throw new Error("QA worker tool inventory mismatch");
    }
    let closed = false;
    return {
      socketPath,
      socketDirectory,
      channelToken,
      effectiveTools: ready.tools,
      output,
      close: async () => {
        if (closed) return;
        closed = true;
        if (child.exitCode === null && child.signalCode === null) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
            child.once("exit", () => { clearTimeout(timer); resolve(); });
            child.kill("SIGTERM");
          });
        }
        await rm(socketDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill();
    await rm(socketDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function callQaWorker(
  worker: Pick<QaWorkerHandle, "socketPath" | "channelToken">,
  tool: IsolatedToolName,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool, args });
    const request = http.request({
      socketPath: worker.socketPath,
      path: "/tool",
      method: "POST",
      headers: {
        authorization: `Bearer ${worker.channelToken}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      signal,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.statusCode !== 200) reject(new Error(payload.error ?? "WORKER_UNAVAILABLE"));
          else resolve(payload.result);
        } catch (error) { reject(error); }
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "SystemRoot", "windir"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function waitForReady(child: ChildProcess, output: string[]): Promise<{ tools: string[] }> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("QA worker readiness timeout"));
    }, 20_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        output.push(line);
        try {
          const event = JSON.parse(line);
          if (event.type === "qa_worker_ready") {
            clearTimeout(timeout);
            resolve(event);
          }
        } catch { /* retain non-JSON output only */ }
      }
    });
    child.stderr?.on("data", (chunk) => output.push(`stderr:${String(chunk).trim()}`));
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`QA worker exited before readiness: ${code}; ${output.join(" | ")}`));
    });
  });
}

export function qaMcpBridgePath(): string {
  return path.join(moduleDirectory, "qaMcpBridge.mjs");
}
