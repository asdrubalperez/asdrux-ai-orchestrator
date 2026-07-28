import type { IsolatedToolPolicy, SyntheticPolicyId } from "./contracts.js";

export const QA_ISOLATED_TOOL_NAMES = ["fs_read", "fs_search", "fs_glob", "artifact_list", "artifact_read"] as const;

export const QA_ISOLATED_POLICY: IsolatedToolPolicy = Object.freeze({
  id: "qa-pilot" as SyntheticPolicyId,
  tools: QA_ISOLATED_TOOL_NAMES,
  filesystem: "read-only",
  egress: "none",
});

export const QA_MCP_TOOL_NAMES = QA_ISOLATED_TOOL_NAMES.map(
  (name) => `mcp__orchestrator_worker__${name}`,
);
