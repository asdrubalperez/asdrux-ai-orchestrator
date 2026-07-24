import { spawn } from "node:child_process";
import readline from "node:readline";

const child = spawn(
  "codex",
  ["app-server", "--strict-config", "--listen", "stdio://"],
  { stdio: ["pipe", "pipe", "pipe"], env: process.env }
);
const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
let initialized = false;
let completed = false;

child.stderr.on("data", (chunk) => {
  process.stderr.write(`app_server_stderr=${String(chunk).trim()}\n`);
});

stdout.on("line", (line) => {
  const message = JSON.parse(line);
  console.log(`app_server_message=${JSON.stringify(message)}`);
  if (message.id === 1 && (message.result || message.error)) {
    if (message.error) throw new Error(`initialize failed: ${JSON.stringify(message.error)}`);
    child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
    initialized = true;
    child.stdin.write(
      `${JSON.stringify({
        method: "thread/start",
        id: 2,
        params: {
          cwd: "/holder-empty",
          sandbox: "read-only",
          ephemeral: true,
          environments: [],
          dynamicTools: [
            {
              type: "function",
              name: "synthetic_read",
              description: "Read a synthetic key from the credential-free worker",
              inputSchema: {
                type: "object",
                properties: { key: { type: "string" } },
                required: ["key"],
                additionalProperties: false,
              },
            },
          ],
        },
      })}\n`
    );
  }
  if (message.id === 2 && (message.result || message.error)) {
    if (message.error) throw new Error(`thread/start failed: ${JSON.stringify(message.error)}`);
    completed = initialized;
    setTimeout(() => child.kill("SIGTERM"), 250);
  }
});

child.stdin.write(
  `${JSON.stringify({
    method: "initialize",
    id: 1,
    params: {
      clientInfo: {
        name: "feature015a_stage1",
        title: "FEATURE-015A Stage 1",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [
          "remoteControl/status/changed",
          "thread/status/changed",
          "thread/tokenUsage/updated",
          "turn/diff/updated",
          "turn/plan/updated",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/textDelta",
        ],
      },
    },
  })}\n`
);

const timeout = setTimeout(() => {
  console.error("app_server_smoke=timeout");
  child.kill("SIGKILL");
}, 10_000);

child.on("exit", (code, signal) => {
  clearTimeout(timeout);
  console.log(`app_server_exit=${code ?? "null"} signal=${signal ?? "none"}`);
  if (!completed) process.exitCode = 1;
});
