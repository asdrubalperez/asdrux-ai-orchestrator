import { timingSafeEqual } from "node:crypto";
import { IsolatedToolName, MAX_FRAME_BYTES } from "./contracts.js";
import type { ToolDispatcher } from "./bridges.js";

export interface ToolCallEnvelope {
  version: 1;
  type: "tool_call";
  invocationId: string;
  callId: string;
  channelToken: string;
  tool: IsolatedToolName;
  args: unknown;
}

export interface ToolResultEnvelope {
  version: 1;
  type: "tool_result" | "tool_error";
  invocationId: string;
  callId: string;
  result?: unknown;
  error?: { code: string };
}

export class AuthenticatedWorkerChannel {
  readonly #completed = new Set<string>();
  constructor(
    private readonly invocationId: string,
    private readonly channelToken: string,
    private readonly dispatcher: ToolDispatcher,
  ) {}

  async dispatch(envelope: ToolCallEnvelope, signal?: AbortSignal): Promise<ToolResultEnvelope> {
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > MAX_FRAME_BYTES) return this.error(envelope, "FRAME_TOO_LARGE");
    if (envelope.version !== 1 || envelope.type !== "tool_call" || envelope.invocationId !== this.invocationId) {
      return this.error(envelope, "INVALID_ENVELOPE");
    }
    const expected = Buffer.from(this.channelToken);
    const received = Buffer.from(envelope.channelToken);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return this.error(envelope, "AUTHENTICATION_FAILED");
    }
    if (this.#completed.has(envelope.callId)) return this.error(envelope, "REPLAY_DETECTED");
    this.#completed.add(envelope.callId);
    try {
      return {
        version: 1, type: "tool_result", invocationId: envelope.invocationId,
        callId: envelope.callId, result: await this.dispatcher.call(envelope.tool, envelope.args, signal),
      };
    } catch (error) {
      return this.error(envelope, (error as Error).message);
    }
  }

  private error(envelope: Pick<ToolCallEnvelope, "invocationId" | "callId">, code: string): ToolResultEnvelope {
    return { version: 1, type: "tool_error", invocationId: envelope.invocationId, callId: envelope.callId, error: { code } };
  }
}
