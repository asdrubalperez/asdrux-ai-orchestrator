import http from "node:http";
import readline from "node:readline";

const workerSocket = process.env.ISOLATED_WORKER_SOCKET;
const channelToken = process.env.ISOLATED_CHANNEL_TOKEN;
let schemas;
try { schemas = JSON.parse(process.env.ISOLATED_TOOL_SCHEMAS ?? ""); }
catch { throw new Error("Isolated tool schemas are required"); }
if (!workerSocket || !channelToken || !schemas || typeof schemas !== "object") {
  throw new Error("Isolated worker channel is required");
}

const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); }
  catch { reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); return; }
  const { id, method } = message;
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "initialize") {
    reply({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "orchestrator-worker", version: "1.0.0" },
    }});
    return;
  }
  if (method === "tools/list") {
    reply({ jsonrpc: "2.0", id, result: { tools: Object.entries(schemas).map(([name, inputSchema]) => ({
      name, description: `Isolated ${name}`, inputSchema,
    })) }});
    return;
  }
  if (method === "tools/call") {
    const name = message.params?.name;
    if (!(name in schemas)) {
      reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "tool denied" } });
      return;
    }
    try {
      const body = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({ tool: name, args: message.params?.arguments });
        const request = http.request({
          socketPath: workerSocket, path: "/tool", method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${channelToken}`,
            "content-length": Buffer.byteLength(payload),
          },
        }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (response.statusCode !== 200) reject(new Error(value.error ?? "worker unavailable"));
            else resolve(value);
          });
        });
        request.once("error", reject);
        request.end(payload);
      });
      reply({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: JSON.stringify(body.result) }],
      }});
    } catch (error) {
      reply({ jsonrpc: "2.0", id, result: {
        isError: true, content: [{ type: "text", text: error.message }],
      }});
    }
    return;
  }
  reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "method denied" } });
});
