import { timingSafeEqual } from "node:crypto";

export const MAX_FRAME_BYTES = 10_485_760;
export const MAX_TOOL_CALLS = 500;
export const PROTOCOL_VERSION = "1";

export const CODEX_CLIENT_REQUESTS = new Set([
  "initialize",
  "thread/start",
  "turn/start",
  "turn/interrupt",
]);
export const CODEX_CLIENT_NOTIFICATIONS = new Set(["initialized"]);
export const CODEX_SERVER_REQUESTS = new Set(["item/tool/call"]);
export const CODEX_SERVER_NOTIFICATIONS = new Set([
  "thread/started",
  "turn/started",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "turn/completed",
  "configWarning",
  "warning",
  "error",
]);
export const CLAUDE_CLIENT_REQUESTS = new Set(["initialize", "tools/list", "tools/call"]);
export const CLAUDE_CLIENT_NOTIFICATIONS = new Set([
  "notifications/initialized",
  "notifications/cancelled",
]);

type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function assertFrameSize(raw: string): void {
  if (Buffer.byteLength(raw, "utf8") > MAX_FRAME_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
}

export function authenticateChannelToken(actual: string, expected: string): void {
  if (
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(actual) ||
    !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(expected)
  ) {
    throw new Error("UNAUTHORIZED");
  }
  const actualBytes = Buffer.from(actual, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (actualBytes.length !== 32 || expectedBytes.length !== 32) {
    throw new Error("UNAUTHORIZED");
  }
  if (!timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error("UNAUTHORIZED");
  }
}

export class ReplayAndCancellationGuard {
  readonly seen = new Set<string>();
  readonly terminal = new Set<string>();
  readonly cancelled = new Set<string>();
  acceptedCalls = 0;

  acceptToolCall(callId: string): void {
    if (this.seen.has(callId)) throw new Error("DUPLICATE_ID");
    if (this.acceptedCalls >= MAX_TOOL_CALLS) throw new Error("TOO_MANY_CALLS");
    this.seen.add(callId);
    this.acceptedCalls += 1;
  }

  cancel(callId: string): "accepted" | "already_terminal" | "unknown_call" {
    if (!this.seen.has(callId)) return "unknown_call";
    if (this.terminal.has(callId)) return "already_terminal";
    this.cancelled.add(callId);
    this.terminal.add(callId);
    return "accepted";
  }

  complete(callId: string): "deliver" | "discard" {
    if (this.cancelled.has(callId)) return "discard";
    this.terminal.add(callId);
    return "deliver";
  }
}

export class CodexRpcGuard {
  readonly pendingClientRequests = new Set<string | number>();
  readonly pendingServerRequests = new Set<string | number>();

  clientToServer(message: RpcMessage): void {
    if (typeof message.method === "string") {
      if (message.id === undefined) {
        if (!CODEX_CLIENT_NOTIFICATIONS.has(message.method)) {
          throw new Error(`CODEX_CLIENT_NOTIFICATION_DENIED:${message.method}`);
        }
        return;
      }
      if (!CODEX_CLIENT_REQUESTS.has(message.method)) {
        throw new Error(`CODEX_CLIENT_REQUEST_DENIED:${message.method}`);
      }
      if (this.pendingClientRequests.has(message.id)) throw new Error("CODEX_DUPLICATE_ID");
      this.pendingClientRequests.add(message.id);
      validateClientParams(message);
      return;
    }
    if (message.id === undefined || !this.pendingServerRequests.delete(message.id)) {
      throw new Error("CODEX_UNCORRELATED_CLIENT_RESPONSE");
    }
    if (!own(message, "result") && !own(message, "error")) {
      throw new Error("CODEX_MALFORMED_CLIENT_RESPONSE");
    }
  }

  serverToClient(message: RpcMessage): void {
    if (typeof message.method === "string") {
      if (message.id === undefined) {
        if (!CODEX_SERVER_NOTIFICATIONS.has(message.method)) {
          throw new Error(`CODEX_SERVER_NOTIFICATION_DENIED:${message.method}`);
        }
        validateServerNotificationParams(message);
        return;
      }
      if (!CODEX_SERVER_REQUESTS.has(message.method)) {
        throw new Error(`CODEX_SERVER_REQUEST_DENIED:${message.method}`);
      }
      if (this.pendingServerRequests.has(message.id)) throw new Error("CODEX_DUPLICATE_ID");
      this.pendingServerRequests.add(message.id);
      return;
    }
    if (message.id === undefined || !this.pendingClientRequests.delete(message.id)) {
      throw new Error("CODEX_UNCORRELATED_SERVER_RESPONSE");
    }
    if (!own(message, "result") && !own(message, "error")) {
      throw new Error("CODEX_MALFORMED_SERVER_RESPONSE");
    }
  }
}

function validateServerNotificationParams(message: RpcMessage): void {
  if (message.method !== "configWarning") return;
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    throw new Error("CODEX_CONFIG_WARNING_PARAMS_DENIED");
  }
  const params = message.params as Record<string, unknown>;
  const allowedKeys = new Set(["summary", "details"]);
  if (
    Object.keys(params).some((key) => !allowedKeys.has(key)) ||
    typeof params.summary !== "string" ||
    (params.details !== null && typeof params.details !== "string")
  ) {
    throw new Error("CODEX_CONFIG_WARNING_PARAMS_DENIED");
  }
}

function validateClientParams(message: RpcMessage): void {
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    throw new Error(`CODEX_INVALID_PARAMS:${message.method}`);
  }
  const params = message.params as Record<string, unknown>;
  if (message.method === "initialize") {
    const capabilities = params.capabilities as Record<string, unknown> | undefined;
    if (capabilities?.experimentalApi !== true) throw new Error("CODEX_EXPERIMENTAL_API_REQUIRED");
  }
  if (message.method === "thread/start") {
    if (params.cwd !== "/holder-empty" || params.sandbox !== "read-only") {
      throw new Error("CODEX_THREAD_BOUNDARY_DENIED");
    }
    if (!Array.isArray(params.dynamicTools) || params.dynamicTools.length !== 1) {
      throw new Error("CODEX_DYNAMIC_TOOL_CATALOG_DENIED");
    }
  }
  if (message.method === "turn/start") {
    if (typeof params.threadId !== "string" || !Array.isArray(params.input)) {
      throw new Error("CODEX_TURN_PARAMS_DENIED");
    }
  }
  if (message.method === "turn/interrupt" && typeof params.turnId !== "string") {
    throw new Error("CODEX_INTERRUPT_PARAMS_DENIED");
  }
}

export function validateClaudeClientMessage(message: RpcMessage): void {
  if (typeof message.method !== "string") throw new Error("CLAUDE_MALFORMED_MESSAGE");
  if (message.id === undefined) {
    if (!CLAUDE_CLIENT_NOTIFICATIONS.has(message.method)) {
      throw new Error(`CLAUDE_NOTIFICATION_DENIED:${message.method}`);
    }
    return;
  }
  if (!CLAUDE_CLIENT_REQUESTS.has(message.method)) {
    throw new Error(`CLAUDE_REQUEST_DENIED:${message.method}`);
  }
}

export class FailClosedSupervisor {
  private failedReason: string | null = null;
  private resolver!: (reason: string) => void;
  readonly failed = new Promise<string>((resolve) => {
    this.resolver = resolve;
  });

  fail(reason: string): void {
    if (this.failedReason) return;
    this.failedReason = reason;
    this.resolver(reason);
  }

  get reason(): string | null {
    return this.failedReason;
  }
}
