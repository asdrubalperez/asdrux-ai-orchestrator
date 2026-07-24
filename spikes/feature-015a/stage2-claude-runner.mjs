import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const mode = process.argv[2] ?? "baseline";
if (!new Set(["baseline", "access-only", "refresh-only"]).has(mode)) {
  throw new Error("mode must be baseline, access-only, or refresh-only");
}

const configDir = process.env.CLAUDE_CONFIG_DIR;
if (!configDir) throw new Error("CLAUDE_CONFIG_DIR is required");
const credentialFile = path.join(configDir, ".credentials.json");
const originalRaw = await readFile(credentialFile, "utf8");
const document = JSON.parse(originalRaw);

function findEntry(value, target) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === target) return { owner: value, key, value: child };
    const nested = findEntry(child, target);
    if (nested) return nested;
  }
  return undefined;
}

const access = findEntry(document, "accessToken");
const refresh = findEntry(document, "refreshToken");
const expires = findEntry(document, "expiresAt");
if (!access || !refresh || !expires) throw new Error("expected OAuth fields were not found");

const before = {
  accessToken: String(access.value),
  refreshToken: String(refresh.value),
  expiresAt: expires.value,
};
if (mode === "access-only") {
  refresh.owner[refresh.key] = "SYNTHETIC_INVALID_REFRESH_TOKEN";
}
if (mode === "refresh-only") {
  access.owner[access.key] = "SYNTHETIC_INVALID_ACCESS_TOKEN";
  expires.owner[expires.key] = 0;
}
if (mode !== "baseline") {
  await writeFile(credentialFile, JSON.stringify(document), { mode: 0o600 });
}

const prompt =
  "Call mcp__feature015a__synthetic_read exactly once with {\"key\":\"stage2\"}. " +
  "If its result is SYNTHETIC_WORKER_RESULT, return exactly TOOL_OK.";
const args = [
  "-p",
  prompt,
  "--tools",
  "mcp__feature015a__synthetic_read",
  "--allowedTools",
  "mcp__feature015a__synthetic_read",
  "--mcp-config",
  "/stage2/claude-mcp.json",
  "--strict-mcp-config",
  "--settings",
  '{"enabledMcpjsonServers":["feature015a"]}',
  "--no-session-persistence",
  "--output-format",
  "stream-json",
  "--verbose",
];

const child = spawn("claude", args, {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
const limit = 10 * 1024 * 1024;
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  if (Buffer.byteLength(stdout) > limit) child.kill("SIGTERM");
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
  if (Buffer.byteLength(stderr) > limit) child.kill("SIGTERM");
});
const outcome = await new Promise((resolve) => {
  child.on("exit", (exitCode, signal) => resolve({ exitCode, signal }));
});

let finalRaw = await readFile(credentialFile, "utf8");
let finalDocument = JSON.parse(finalRaw);
let finalAccess = findEntry(finalDocument, "accessToken");
let finalRefresh = findEntry(finalDocument, "refreshToken");
let finalExpires = findEntry(finalDocument, "expiresAt");

const secrets = [
  before.accessToken,
  before.refreshToken,
  String(finalAccess?.value ?? ""),
  String(finalRefresh?.value ?? ""),
].filter((value) => value.length >= 16);
const secretLeakDetected = secrets.some(
  (secret) => stdout.includes(secret) || stderr.includes(secret)
);

const events = [];
for (const line of stdout.split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    events.push(JSON.parse(line));
  } catch {
    // Non-JSON output is summarized only by hash below.
  }
}

const eventTypes = new Set();
const toolNames = new Set();
const initTools = new Set();
const mcpServers = [];
let toolUseSeen = false;
let workerResultSeen = false;
let finalResultSeen = false;
let finalText = "";
function inspect(value, key = "") {
  if (typeof value === "string") {
    if (key === "type" || key === "subtype") eventTypes.add(value);
    if (key === "name" && value.includes("feature015a")) toolNames.add(value);
    if (value === "mcp__feature015a__synthetic_read") toolNames.add(value);
    if (value.includes("SYNTHETIC_WORKER_RESULT")) workerResultSeen = true;
    if (value.trim() === "TOOL_OK") finalResultSeen = true;
    return;
  }
  if (Array.isArray(value)) {
    if (key === "tools") {
      for (const tool of value) if (typeof tool === "string") toolNames.add(tool);
    }
    for (const childValue of value) inspect(childValue);
    return;
  }
  if (value && typeof value === "object") {
    if (
      value.type === "tool_use" &&
      value.name === "mcp__feature015a__synthetic_read"
    ) {
      toolUseSeen = true;
    }
    for (const [childKey, childValue] of Object.entries(value)) inspect(childValue, childKey);
  }
}
for (const event of events) {
  inspect(event);
  if (event?.type === "system" && event?.subtype === "init") {
    for (const tool of event.tools ?? []) if (typeof tool === "string") initTools.add(tool);
    for (const server of event.mcp_servers ?? []) {
      mcpServers.push({
        name: server?.name,
        status: server?.status,
      });
    }
  }
  if (event?.type === "result" && typeof event.result === "string") {
    finalText = event.result.slice(0, 500);
  }
}

if (mode === "access-only" || (mode === "refresh-only" && outcome.exitCode !== 0)) {
  await writeFile(credentialFile, originalRaw, { mode: 0o600 });
  finalRaw = originalRaw;
  finalDocument = JSON.parse(originalRaw);
  finalAccess = findEntry(finalDocument, "accessToken");
  finalRefresh = findEntry(finalDocument, "refreshToken");
  finalExpires = findEntry(finalDocument, "expiresAt");
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

console.log(
  JSON.stringify({
    mode,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    secretLeakDetected,
    parsedEvents: events.length,
    eventTypes: [...eventTypes].sort(),
    effectiveTools: [...toolNames].sort(),
    initTools: [...initTools].sort(),
    mcpServers,
    toolUseSeen,
    workerResultSeen,
    finalResultSeen,
    finalText: secretLeakDetected ? "[REDACTED]" : finalText,
    stderrEmpty: stderr.length === 0,
    stderrSha256: createHash("sha256").update(stderr).digest("hex"),
    credentialState: {
      accessBefore: hash(before.accessToken),
      accessAfter: hash(finalAccess?.value ?? ""),
      refreshBefore: hash(before.refreshToken),
      refreshAfter: hash(finalRefresh?.value ?? ""),
      expiresBefore: before.expiresAt,
      expiresAfter: finalExpires?.value,
    },
  })
);

if (secretLeakDetected) process.exit(86);
if (outcome.exitCode !== 0) process.exit(outcome.exitCode ?? 1);
