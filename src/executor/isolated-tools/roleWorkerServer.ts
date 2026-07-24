import http from "node:http";
import type { AgentRole } from "../../contracts/executor.js";
import { resolveRolePolicy } from "./rolePolicy.js";
import { UnixSearchProxyClient } from "./searchProxyClient.js";
import { IsolatedToolWorker } from "./worker.js";

const worktree = process.env.ISOLATED_WORKTREE;
const channelToken = process.env.ISOLATED_CHANNEL_TOKEN;
const workerSocket = process.env.ISOLATED_WORKER_SOCKET;
const role = process.env.ISOLATED_AGENT_ROLE as AgentRole | undefined;
if (!worktree || !channelToken || !workerSocket || !role) {
  throw new Error("Isolated worker configuration is required");
}
const policy = resolveRolePolicy(role);
for (const secret of ["ANTHROPIC_API_KEY", "CODEX_API_KEY", "TAVILY_API_KEY"]) {
  if (process.env[secret]) throw new Error(`SECRET_IN_WORKER_ENV:${secret}`);
}

const searchProxy = policy.tools.includes("web_search")
  ? new UnixSearchProxyClient(
      process.env.SEARCH_PROXY_SOCKET ?? "",
      process.env.SEARCH_PROXY_TOKEN ?? "",
    )
  : undefined;
const commandEnv: NodeJS.ProcessEnv = {};
for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "NODE_PATH"]) {
  if (process.env[name] !== undefined) commandEnv[name] = process.env[name];
}
const worker = new IsolatedToolWorker({ worktree, policy, searchProxy, env: commandEnv });
const calls: string[] = [];
const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/tool") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${channelToken}`) {
    response.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      tool?: unknown;
      args?: unknown;
    };
    if (typeof payload.tool !== "string" || !policy.tools.includes(payload.tool as never)) {
      throw new Error("TOOL_NOT_FOUND");
    }
    calls.push(payload.tool);
    process.stdout.write(`${JSON.stringify({ type: "isolated_tool_call", role, tool: payload.tool })}\n`);
    const result = await worker.call(payload.tool as never, payload.args);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: (error as Error).message }));
  }
});

server.listen(workerSocket, () => {
  process.stdout.write(`${JSON.stringify({
    type: "isolated_worker_ready",
    role,
    tools: policy.tools,
    credentialCanaryPresent: false,
  })}\n`);
});

const shutdown = () => server.close(() => {
  process.stdout.write(`${JSON.stringify({ type: "isolated_worker_stopped", calls })}\n`);
  process.exit(0);
});
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
