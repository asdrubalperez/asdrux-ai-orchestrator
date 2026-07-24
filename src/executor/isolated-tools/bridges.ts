import { IsolatedToolName, IsolatedToolPolicy, TOOL_SCHEMAS } from "./contracts.js";

export interface ToolDispatcher {
  call(tool: IsolatedToolName, args: unknown, signal?: AbortSignal): Promise<unknown>;
}

export class ClaudeMcpBridge {
  constructor(private readonly policy: IsolatedToolPolicy, private readonly dispatcher: ToolDispatcher) {}

  async handle(message: unknown): Promise<Record<string, unknown> | null> {
    if (!message || typeof message !== "object") return this.error(null, -32600, "invalid request");
    const request = message as Record<string, unknown>;
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return null;
    if (request.method === "initialize") {
      return { jsonrpc: "2.0", id: request.id, result: {
        protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "orchestrator-worker", version: "1.0.0" },
      }};
    }
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id: request.id, result: { tools: this.policy.tools.map((name) => ({
        name, description: TOOL_SCHEMAS[name].description, inputSchema: TOOL_SCHEMAS[name].args,
      })) }};
    }
    if (request.method === "tools/call") {
      const params = request.params as { name?: IsolatedToolName; arguments?: unknown } | undefined;
      if (!params?.name || !this.policy.tools.includes(params.name)) return this.error(request.id, -32601, "tool denied");
      try {
        const result = await this.dispatcher.call(params.name, params.arguments);
        return { jsonrpc: "2.0", id: request.id, result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
        }};
      } catch (error) {
        return { jsonrpc: "2.0", id: request.id, result: {
          isError: true, content: [{ type: "text", text: (error as Error).message }],
        }};
      }
    }
    return this.error(request.id, -32601, "method denied");
  }

  private error(id: unknown, code: number, message: string) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

export class CodexAppServerProxy {
  readonly pending = new Set<string>();
  constructor(private readonly policy: IsolatedToolPolicy, private readonly dispatcher: ToolDispatcher) {}

  threadStartParams(): Record<string, unknown> {
    return {
      cwd: "/holder-empty", sandbox: "read-only", ephemeral: true, environments: [],
      dynamicTools: this.policy.tools.map((name) => ({
        type: "function", name, description: TOOL_SCHEMAS[name].description,
        inputSchema: TOOL_SCHEMAS[name].args,
      })),
    };
  }

  async handleToolCall(notification: unknown): Promise<Record<string, unknown>> {
    if (!notification || typeof notification !== "object") throw new Error("INVALID_APP_SERVER_MESSAGE");
    const value = notification as Record<string, unknown>;
    if (value.method !== "item/tool/call") throw new Error("METHOD_DENIED");
    const params = value.params as { callId?: string; tool?: IsolatedToolName; arguments?: unknown };
    if (!params.callId || !params.tool || !this.policy.tools.includes(params.tool)) throw new Error("TOOL_NOT_FOUND");
    if (this.pending.has(params.callId)) throw new Error("REPLAY_DETECTED");
    this.pending.add(params.callId);
    try {
      return { callId: params.callId, result: await this.dispatcher.call(params.tool, params.arguments) };
    } finally {
      this.pending.delete(params.callId);
    }
  }
}
