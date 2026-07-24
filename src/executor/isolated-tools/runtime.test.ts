import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuthenticatedWorkerChannel } from "./channel.js";
import { ClaudeMcpBridge, CodexAppServerProxy } from "./bridges.js";
import { IsolatedToolPolicy, PolicyMatrix, SyntheticPolicyId, TOOL_NAMES, TOOL_SCHEMAS } from "./contracts.js";
import { assertPublicHttpsUrl, resolveWorktreePath } from "./security.js";
import { IsolatedToolsSupervisor, RuntimeComponent } from "./supervisor.js";
import { buildTavilyRequest, normalizeTavilyResponse, TavilySearchProxy } from "./tavily.js";
import { IsolatedToolWorker } from "./worker.js";

const policy = (tools: readonly (typeof TOOL_NAMES)[number][] = TOOL_NAMES): IsolatedToolPolicy => ({
  id: "synthetic-part1" as SyntheticPolicyId, tools,
  filesystem: tools.includes("fs_write") ? "workspace-write" : "read-only",
  egress: tools.includes("web_fetch") ? "public" : "none",
});

test("policy matrix starts empty and rejects unknown synthetic policy", () => {
  assert.throws(() => new PolicyMatrix().resolve("missing" as SyntheticPolicyId), /Unknown policy/);
});

test("policy matrix rejects mutating tools in read-only policy", () => {
  assert.throws(() => new PolicyMatrix().register({
    id: "bad" as SyntheticPolicyId, tools: ["fs_write"], filesystem: "read-only", egress: "none",
  }), /Read-only/);
});

test("all eight schemas are closed objects", () => {
  assert.equal(Object.keys(TOOL_SCHEMAS).length, 8);
  for (const name of TOOL_NAMES) {
    assert.equal(TOOL_SCHEMAS[name].args.additionalProperties, false);
    assert.equal(TOOL_SCHEMAS[name].result.additionalProperties, false);
  }
});

test("path validator rejects absolute and traversal paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "isolated-path-"));
  await assert.rejects(resolveWorktreePath(root, "../escape"), /PATH_OUTSIDE/);
  await assert.rejects(resolveWorktreePath(root, path.resolve(root, "absolute")), /PATH_OUTSIDE/);
  await fs.rm(root, { recursive: true, force: true });
});

test("SSRF validator accepts public HTTPS and rejects private and HTTP", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  assert.equal((await assertPublicHttpsUrl("https://example.com/a", publicLookup as never)).hostname, "example.com");
  await assert.rejects(assertPublicHttpsUrl("https://localhost/a", privateLookup as never), /URL_NOT_PUBLIC/);
  await assert.rejects(assertPublicHttpsUrl("http://example.com/a", publicLookup as never), /URL_NOT_PUBLIC/);
});

test("Tavily request is explicitly basic without answer or raw content", () => {
  assert.deepEqual(buildTavilyRequest({ query: "sources", maxResults: 3 }), {
    query: "sources", search_depth: "basic", max_results: 3, topic: "general",
    include_answer: false, include_raw_content: false, include_images: false,
    auto_parameters: false, safe_search: true,
  });
});

test("Tavily normalizer maps content to snippet", () => {
  assert.deepEqual(normalizeTavilyResponse({ results: [
    { url: "https://example.com/a", title: "A", content: "Snippet", raw_content: "ignored" },
  ] }, 1), {
    results: [{ url: "https://example.com/a", title: "A", snippet: "Snippet" }], truncated: true,
  });
});

test("Tavily proxy keeps key in trusted proxy request", async () => {
  let captured: RequestInit | undefined;
  const proxy = new TavilySearchProxy("synthetic-tavily-canary", async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  await proxy.search({ query: "q" });
  assert.equal((captured?.headers as Record<string, string>).authorization, "Bearer synthetic-tavily-canary");
  assert.match(String(captured?.body), /"include_answer":false/);
  assert.doesNotMatch(String(captured?.body), /extract/);
});

test("worker refuses OAuth and Tavily credentials", () => {
  assert.throws(() => new IsolatedToolWorker({ worktree: ".", policy: policy(), env: { CODEX_API_KEY: "oauth-canary" } }), /SECRET_IN_WORKER_ENV/);
  assert.throws(() => new IsolatedToolWorker({ worktree: ".", policy: policy(), env: { TAVILY_API_KEY: "tavily-canary" } }), /SECRET_IN_WORKER_ENV/);
});

test("worker executes filesystem tools with synthetic policy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "isolated-worker-"));
  await fs.writeFile(path.join(root, "a.txt"), "hello world\nhello again");
  const worker = new IsolatedToolWorker({ worktree: root, policy: policy() });
  assert.deepEqual(await worker.call("fs_glob", { pattern: "*.txt" }), { paths: ["a.txt"], truncated: false });
  assert.equal((await worker.call("fs_search", { pattern: "world" }) as { matches: unknown[] }).matches.length, 1);
  assert.equal((await worker.call("fs_read", { path: "a.txt" }) as { bytesRead: number }).bytesRead, 23);
  await worker.call("fs_edit", { path: "a.txt", oldText: "world", newText: "runtime" });
  await worker.call("fs_write", { path: "b.txt", content: "created", createOnly: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("authenticated channel fails closed on bad token and replay", async () => {
  const channel = new AuthenticatedWorkerChannel("inv", "channel-canary", { call: async () => "SYNTHETIC_WORKER_RESULT" });
  const base = { version: 1 as const, type: "tool_call" as const, invocationId: "inv", callId: "1", tool: "fs_read" as const, args: {} };
  assert.equal((await channel.dispatch({ ...base, channelToken: "wrong" })).type, "tool_error");
  assert.equal((await channel.dispatch({ ...base, channelToken: "channel-canary" })).type, "tool_result");
  assert.equal((await channel.dispatch({ ...base, channelToken: "channel-canary" })).error?.code, "REPLAY_DETECTED");
});

test("Claude MCP bridge exposes policy tools and denies other methods", async () => {
  const bridge = new ClaudeMcpBridge(policy(["fs_read"]), { call: async () => ({ content: "ok" }) });
  const list = await bridge.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal((list?.result as { tools: unknown[] }).tools.length, 1);
  assert.ok((await bridge.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" }))?.error);
});

test("Codex proxy pins holder-empty and dispatches item/tool/call", async () => {
  const proxy = new CodexAppServerProxy(policy(["fs_read"]), { call: async () => "ok" });
  assert.equal(proxy.threadStartParams().cwd, "/holder-empty");
  assert.equal(proxy.threadStartParams().sandbox, "read-only");
  assert.deepEqual(await proxy.handleToolCall({
    method: "item/tool/call", params: { callId: "c1", name: "fs_read", arguments: { path: "a" } },
  }), { callId: "c1", result: "ok" });
  await assert.rejects(proxy.handleToolCall({ method: "command/exec", params: {} }), /METHOD_DENIED/);
});

test("supervisor E2E cleans worker then holder and fails closed", async () => {
  const events: string[] = [];
  const component = (name: string, fail = false): RuntimeComponent => ({
    name,
    async start() { events.push(`start:${name}`); },
    async ready() { if (fail) throw new Error("down"); events.push(`ready:${name}`); },
    async stop() { events.push(`stop:${name}`); },
  });
  const supervisor = new IsolatedToolsSupervisor();
  assert.equal(await supervisor.run([() => component("holder"), () => component("worker")], async () => "SYNTHETIC_E2E_OK"), "SYNTHETIC_E2E_OK");
  assert.deepEqual(events.slice(-2), ["stop:worker", "stop:holder"]);
  await assert.rejects(supervisor.start([() => component("holder"), () => component("worker", true)]), /WORKER_UNAVAILABLE/);
  assert.equal(events.at(-1), "stop:holder");
});
