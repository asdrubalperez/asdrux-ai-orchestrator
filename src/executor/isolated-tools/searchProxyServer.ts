import http from "node:http";
import { TavilySearchProxy } from "./tavily.js";

const socket = process.env.SEARCH_PROXY_SOCKET;
const token = process.env.SEARCH_PROXY_TOKEN;
const apiKey = process.env.TAVILY_API_KEY;
if (!socket || !token || !apiKey) throw new Error("Search proxy configuration is required");
for (const secret of ["ANTHROPIC_API_KEY", "CODEX_API_KEY"]) {
  if (process.env[secret]) throw new Error(`SECRET_IN_SEARCH_PROXY_ENV:${secret}`);
}

const proxy = new TavilySearchProxy(apiKey);
const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/search") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  try {
    const args = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await proxy.search(args);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result }));
  } catch (error) {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: (error as Error).message }));
  }
});

server.listen(socket, () => {
  process.stdout.write(`${JSON.stringify({ type: "search_proxy_ready" })}\n`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
