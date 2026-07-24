import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRole } from "../../contracts/executor.js";
import type { IsolatedToolName } from "./contracts.js";
import { resolveRolePolicy } from "./rolePolicy.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleDirectory, "..", "..", "..");
const DEFAULT_WORKER_IMAGE = "ai-orchestrator-developer:latest";

export interface RoleWorkerHandle {
  role: AgentRole;
  socketPath: string;
  socketDirectory: string;
  channelToken: string;
  effectiveTools: readonly IsolatedToolName[];
  output: string[];
  close(): Promise<void>;
}

export async function startRoleWorker(
  role: AgentRole,
  worktree: string,
  tavilyApiKey: string | undefined,
  signal?: AbortSignal,
  onEvent?: (event: Record<string, unknown>) => void,
): Promise<RoleWorkerHandle> {
  const policy = resolveRolePolicy(role);
  if (policy.tools.includes("web_search") && !tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for this role");
  }
  const channelToken = randomBytes(32).toString("base64url");
  const searchToken = randomBytes(32).toString("base64url");
  const socketDirectory = await mkdtemp(path.join(os.tmpdir(), `isolated-${role}-channel-`));
  await chmod(socketDirectory, 0o700);
  const socketPath = path.join(socketDirectory, "worker.sock");
  const searchSocketPath = path.join(socketDirectory, "search.sock");
  const output: string[] = [];
  let searchProxy: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  try {
    if (policy.tools.includes("web_search")) {
      searchProxy = spawn(process.execPath, [
        "--import", path.join(repositoryRoot, "node_modules", "tsx", "dist", "loader.mjs"),
        path.join(moduleDirectory, "searchProxyServer.ts"),
      ], {
        env: {
          ...runtimeEnvironment(),
          SEARCH_PROXY_SOCKET: searchSocketPath,
          SEARCH_PROXY_TOKEN: searchToken,
          TAVILY_API_KEY: tavilyApiKey,
        },
        stdio: ["ignore", "pipe", "pipe"],
        signal,
      });
      await waitForEvent(searchProxy, output, "search_proxy_ready", "search proxy");
    }
    const containerWorkerSocket = "/channel/worker.sock";
    const containerSearchSocket = "/channel/search.sock";
    worker = spawn("docker", [
      "run", "--rm", "-i",
      ...(policy.egress === "none" ? ["--network", "none"] : []),
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--tmpfs", "/tmp:rw,nosuid,size=64m",
      "-v", `${worktree}:/workspace:${policy.filesystem === "workspace-write" ? "rw" : "ro"}`,
      "-v", `${socketDirectory}:/channel:rw`,
      "-v", `${path.join(repositoryRoot, "src")}:/runtime/src:ro`,
      "-v", `${path.join(repositoryRoot, "node_modules")}:/runtime/node_modules:ro`,
      "-e", "ISOLATED_AGENT_ROLE",
      "-e", "ISOLATED_CHANNEL_TOKEN",
      "-e", "SEARCH_PROXY_TOKEN",
      "-e", "ISOLATED_WORKTREE=/workspace",
      "-e", `ISOLATED_WORKER_SOCKET=${containerWorkerSocket}`,
      "-e", `SEARCH_PROXY_SOCKET=${containerSearchSocket}`,
      DEFAULT_WORKER_IMAGE,
      "node", "--import", "/runtime/node_modules/tsx/dist/loader.mjs",
      "/runtime/src/executor/isolated-tools/roleWorkerServer.ts",
    ], {
      env: {
        ...runtimeEnvironment(),
        ISOLATED_AGENT_ROLE: role,
        ISOLATED_CHANNEL_TOKEN: channelToken,
        SEARCH_PROXY_TOKEN: searchToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    const ready = await waitForEvent(worker, output, "isolated_worker_ready", `${role} worker`, onEvent);
    if (JSON.stringify(ready.tools) !== JSON.stringify(policy.tools)) {
      throw new Error(`${role} worker tool inventory mismatch`);
    }
    let closed = false;
    return {
      role,
      socketPath,
      socketDirectory,
      channelToken,
      effectiveTools: ready.tools as IsolatedToolName[],
      output,
      close: async () => {
        if (closed) return;
        closed = true;
        await stopChild(worker);
        await stopChild(searchProxy);
        await rm(socketDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await stopChild(worker);
    await stopChild(searchProxy);
    await rm(socketDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function callRoleWorker(
  worker: Pick<RoleWorkerHandle, "socketPath" | "channelToken">,
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

export function roleMcpBridgePath(): string {
  return path.join(moduleDirectory, "roleMcpBridge.mjs");
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "SystemRoot", "windir", "LANG", "LC_ALL",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function waitForEvent(
  child: ChildProcess,
  output: string[],
  eventType: string,
  label: string,
  onEvent?: (event: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timeout = setTimeout(() => reject(new Error(`${label} readiness timeout`)), 20_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        output.push(line);
        try {
          const event = JSON.parse(line);
          onEvent?.(event);
          if (event.type === eventType) {
            clearTimeout(timeout);
            resolve(event);
          }
        } catch { /* retain diagnostic output */ }
      }
    });
    child.stderr?.on("data", (chunk) => output.push(`stderr:${String(chunk).trim()}`));
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited before readiness: ${code}; ${output.join(" | ")}`));
    });
  });
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}
