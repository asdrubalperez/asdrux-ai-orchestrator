import http from "node:http";
import { QA_ISOLATED_POLICY } from "./qaPolicy.js";
import { IsolatedToolWorker } from "./worker.js";

const worktree = process.env.QA_WORKTREE;
const channelToken = process.env.QA_CHANNEL_TOKEN;
const workerSocket = process.env.QA_WORKER_SOCKET;
if (!worktree || !channelToken || !workerSocket) throw new Error("QA worker configuration is required");

// FEATURE-025-Parte-2: CLAUDE_CONFIG_DIR/CODEX_HOME apuntan al directorio OAuth materializado --
// el worker no debe poder ni detectar que existe, mismo criterio que las API keys.
for (const secret of ["ANTHROPIC_API_KEY", "CODEX_API_KEY", "TAVILY_API_KEY", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
  if (process.env[secret]) throw new Error(`SECRET_IN_WORKER_ENV:${secret}`);
}

const worker = new IsolatedToolWorker({ worktree, policy: QA_ISOLATED_POLICY, env: {} });
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
    if (typeof payload.tool !== "string" || !QA_ISOLATED_POLICY.tools.includes(payload.tool as never)) {
      throw new Error("TOOL_NOT_FOUND");
    }
    calls.push(payload.tool);
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
    type: "qa_worker_ready",
    tools: QA_ISOLATED_POLICY.tools,
    credentialCanaryPresent: false,
  })}\n`);
});

const shutdown = () => server.close(() => {
  process.stdout.write(`${JSON.stringify({ type: "qa_worker_stopped", calls })}\n`);
  process.exit(0);
});
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
