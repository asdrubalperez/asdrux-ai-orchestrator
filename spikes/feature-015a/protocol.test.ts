import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import net from "node:net";
import test from "node:test";
import {
  assertFrameSize,
  authenticateChannelToken,
  CodexRpcGuard,
  FailClosedSupervisor,
  MAX_FRAME_BYTES,
  MAX_TOOL_CALLS,
  ReplayAndCancellationGuard,
  validateClaudeClientMessage,
} from "./protocol.js";

test("token usa comparación segura y rechaza longitud/contenido", () => {
  const token = randomBytes(32).toString("base64url");
  authenticateChannelToken(token, token);
  assert.throws(() => authenticateChannelToken(randomBytes(32).toString("base64url"), token), /UNAUTHORIZED/);
  assert.throws(() => authenticateChannelToken(randomBytes(31).toString("base64url"), token), /UNAUTHORIZED/);
});

test("límite UTF-8 aplica por frame", () => {
  assert.doesNotThrow(() => assertFrameSize("a".repeat(MAX_FRAME_BYTES)));
  assert.throws(() => assertFrameSize("a".repeat(MAX_FRAME_BYTES + 1)), /PAYLOAD_TOO_LARGE/);
});

test("replay, límite 500 y cancelación son terminales", () => {
  const guard = new ReplayAndCancellationGuard();
  const first = randomUUID();
  guard.acceptToolCall(first);
  assert.throws(() => guard.acceptToolCall(first), /DUPLICATE_ID/);
  assert.equal(guard.cancel(first), "accepted");
  assert.equal(guard.complete(first), "discard");
  assert.equal(guard.cancel(first), "already_terminal");
  assert.equal(guard.cancel(randomUUID()), "unknown_call");
  for (let i = 1; i < MAX_TOOL_CALLS; i += 1) guard.acceptToolCall(randomUUID());
  assert.throws(() => guard.acceptToolCall(randomUUID()), /TOO_MANY_CALLS/);
});

test("proxy Codex acepta sólo allowlists, dirección e ids correlacionados", () => {
  const guard = new CodexRpcGuard();
  guard.clientToServer({
    id: 1,
    method: "initialize",
    params: { capabilities: { experimentalApi: true } },
  });
  guard.serverToClient({ id: 1, result: {} });
  guard.clientToServer({ method: "initialized", params: {} });
  guard.clientToServer({
    id: 2,
    method: "thread/start",
    params: {
      cwd: "/holder-empty",
      sandbox: "read-only",
      dynamicTools: [{ name: "synthetic_read", inputSchema: { type: "object" } }],
    },
  });
  guard.serverToClient({ id: 2, result: { thread: { id: "thr" } } });
  guard.serverToClient({
    method: "configWarning",
    params: { summary: "bubblewrap fallback", details: null },
  });
  assert.throws(
    () =>
      guard.serverToClient({
        method: "configWarning",
        params: { summary: "redirect", details: null, url: "https://attacker.invalid" },
      }),
    /CONFIG_WARNING_PARAMS_DENIED/
  );
  guard.serverToClient({ id: 60, method: "item/tool/call", params: {} });
  guard.clientToServer({ id: 60, result: { contentItems: [], success: true } });
  assert.throws(
    () => guard.clientToServer({ id: 3, method: "command/exec", params: {} }),
    /DENIED/
  );
  assert.throws(
    () => guard.serverToClient({ method: "mcpServer\/oauthLogin\/completed", params: {} }),
    /DENIED/
  );
  assert.throws(() => guard.serverToClient({ id: 999, result: {} }), /UNCORRELATED/);
});

test("adaptador Claude rechaza sampling, elicitation, OAuth y resources", () => {
  validateClaudeClientMessage({ id: 1, method: "initialize", params: {} });
  validateClaudeClientMessage({ id: 2, method: "tools/list", params: {} });
  validateClaudeClientMessage({ id: 3, method: "tools/call", params: {} });
  validateClaudeClientMessage({ method: "notifications/cancelled", params: {} });
  for (const method of ["sampling/createMessage", "elicitation/create", "resources/read", "oauth/discover"]) {
    assert.throws(() => validateClaudeClientMessage({ id: 9, method, params: {} }), /DENIED/);
  }
});

test("supervisor falla una sola vez y nunca degrada", async () => {
  for (const reason of ["HOLDER_EXIT", "WORKER_EXIT", "CHANNEL_CLOSED", "SUPERVISOR_ABORT", "DB_UNAVAILABLE"]) {
    const supervisor = new FailClosedSupervisor();
    supervisor.fail(reason);
    supervisor.fail("FALLBACK");
    assert.equal(await supervisor.failed, reason);
    assert.equal(supervisor.reason, reason);
  }
});

test("fail-closed reacciona a procesos holder/worker y canal TCP reales", async () => {
  for (const [component, reason] of [
    ["holder", "HOLDER_EXIT"],
    ["worker", "WORKER_EXIT"],
  ] as const) {
    const supervisor = new FailClosedSupervisor();
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    child.once("exit", () => supervisor.fail(reason));
    child.kill("SIGTERM");
    assert.equal(await supervisor.failed, reason, component);
  }

  const supervisor = new FailClosedSupervisor();
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const accepted = new Promise<net.Socket>((resolve) => server.once("connection", resolve));
  const client = net.connect(address.port, "127.0.0.1");
  client.once("close", () => supervisor.fail("CHANNEL_CLOSED"));
  const serverSocket = await accepted;
  serverSocket.destroy();
  assert.equal(await supervisor.failed, "CHANNEL_CLOSED");
  client.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
