import type { IsolatedToolName } from "./contracts.js";
import {
  callRoleWorker,
  roleMcpBridgePath,
  startRoleWorker,
  type RoleWorkerHandle,
} from "./roleRuntime.js";

/**
 * Compatibility facade for the original QA pilot. Production and tests now use the same runtime
 * as every other role, so QA cannot drift to a smaller artifact tool catalog.
 */
export type QaWorkerHandle = RoleWorkerHandle;

export function startQaWorker(
  worktree: string,
  requestingRunId: string,
  signal?: AbortSignal,
): Promise<QaWorkerHandle> {
  return startRoleWorker("qa", worktree, undefined, requestingRunId, signal);
}

export function callQaWorker(
  worker: Pick<QaWorkerHandle, "socketPath" | "channelToken">,
  tool: IsolatedToolName,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return callRoleWorker(worker, tool, args, signal);
}

export function qaMcpBridgePath(): string {
  return roleMcpBridgePath();
}
