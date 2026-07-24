import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exitCode = 64;
    rl.close();
    return;
  }
  const { id, method } = message;
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "feature015a-stage1-adapter", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    reply({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "synthetic_read",
            description: "Return a synthetic value from the credential-free worker",
            inputSchema: {
              type: "object",
              properties: { key: { type: "string" } },
              required: ["key"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }
  if (method === "tools/call") {
    reply({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: "SYNTHETIC_WORKER_RESULT" }] },
    });
    return;
  }
  reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "method denied" } });
  process.exitCode = 65;
  rl.close();
});
