import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const schemaDir = process.argv[2];
if (!schemaDir) {
  throw new Error("usage: node codex-schema-contract.mjs <generated-schema-dir>");
}

async function methods(fileName) {
  const schema = JSON.parse(await readFile(path.join(schemaDir, fileName), "utf8"));
  return new Set(
    schema.oneOf.flatMap((variant) => variant?.properties?.method?.enum ?? [])
  );
}

const observed = {
  clientRequests: await methods("ClientRequest.json"),
  clientNotifications: await methods("ClientNotification.json"),
  serverRequests: await methods("ServerRequest.json"),
  serverNotifications: await methods("ServerNotification.json"),
};

const allowed = {
  clientRequests: ["initialize", "thread/start", "turn/start", "turn/interrupt"],
  clientNotifications: ["initialized"],
  serverRequests: ["item/tool/call"],
  serverNotifications: [
    "thread/started",
    "turn/started",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "turn/completed",
    "configWarning",
    "warning",
    "error",
  ],
};

for (const [direction, methodsForDirection] of Object.entries(allowed)) {
  for (const method of methodsForDirection) {
    assert.ok(observed[direction].has(method), `${direction} schema missing ${method}`);
  }
}

const deniedButExposed = {
  clientRequests: ["command/exec"],
  serverNotifications: ["mcpServer/oauthLogin/completed"],
};
for (const [direction, methodsForDirection] of Object.entries(deniedButExposed)) {
  for (const method of methodsForDirection) {
    assert.ok(observed[direction].has(method), `${direction} test fixture missing ${method}`);
    assert.ok(!allowed[direction].includes(method), `${method} must remain denied`);
  }
}

console.log(
  JSON.stringify({
    status: "passed",
    schemaDir,
    observedCounts: Object.fromEntries(
      Object.entries(observed).map(([direction, values]) => [direction, values.size])
    ),
    allowed,
    deniedButExposed,
  })
);
