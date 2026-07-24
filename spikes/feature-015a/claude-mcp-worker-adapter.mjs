import readline from "node:readline";

const workerUrl = process.env.FEATURE015A_WORKER_URL;
const channelToken = process.env.FEATURE015A_CHANNEL_TOKEN;
if (!workerUrl || !channelToken) throw new Error("worker channel configuration is required");

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

rl.on("line", async (line) => {
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
        serverInfo: { name: "feature015a-stage2-adapter", version: "0.1.0" },
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
              properties: { key: { type: "string", const: "stage2" } },
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
    const name = message.params?.name;
    const args = message.params?.arguments;
    if (
      name !== "synthetic_read" ||
      args?.key !== "stage2" ||
      Object.keys(args ?? {}).length !== 1
    ) {
      reply({ jsonrpc: "2.0", id, error: { code: -32602, message: "invalid params" } });
      return;
    }
    try {
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-feature015a-channel-token": channelToken,
        },
        body: JSON.stringify({ name, arguments: args }),
        signal: AbortSignal.timeout(5000),
      });
      if (!workerResponse.ok) throw new Error(`worker status ${workerResponse.status}`);
      const result = await workerResponse.json();
      if (result?.value !== "SYNTHETIC_WORKER_RESULT") throw new Error("invalid worker result");
      reply({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: result.value }] },
      });
    } catch {
      reply({ jsonrpc: "2.0", id, error: { code: -32000, message: "worker unavailable" } });
      process.exitCode = 70;
      rl.close();
    }
    return;
  }

  reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "method denied" } });
  process.exitCode = 65;
  rl.close();
});
