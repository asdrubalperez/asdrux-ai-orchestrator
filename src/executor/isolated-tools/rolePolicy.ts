import type { AgentRole } from "../../contracts/executor.js";
import type { IsolatedToolName, IsolatedToolPolicy, SyntheticPolicyId } from "./contracts.js";

export const ARTIFACT_READ_TOOLS = ["artifact_list", "artifact_read"] as const;
const RESEARCH_TOOLS = ["fs_read", "fs_search", "fs_glob", "web_search", "web_fetch", ...ARTIFACT_READ_TOOLS] as const;
const DEVELOPER_TOOLS = [
  "fs_read", "fs_search", "fs_glob", "fs_write", "fs_edit", "command_exec", "web_search", "web_fetch",
  ...ARTIFACT_READ_TOOLS,
] as const;

const policy = (
  id: string,
  tools: readonly IsolatedToolName[],
  filesystem: IsolatedToolPolicy["filesystem"],
  egress: IsolatedToolPolicy["egress"],
): IsolatedToolPolicy => Object.freeze({
  id: id as SyntheticPolicyId,
  tools: Object.freeze([...tools]),
  filesystem,
  egress,
});

export const ROLE_ISOLATED_POLICIES: Readonly<Record<AgentRole, IsolatedToolPolicy>> = Object.freeze({
  architect: policy("role-architect", RESEARCH_TOOLS, "read-only", "public"),
  functional: policy("role-functional", RESEARCH_TOOLS, "read-only", "public"),
  planning: policy("role-planning", RESEARCH_TOOLS, "read-only", "public"),
  qa: policy("role-qa", ["fs_read", "fs_search", "fs_glob", ...ARTIFACT_READ_TOOLS], "read-only", "none"),
  developer: policy("role-developer", DEVELOPER_TOOLS, "workspace-write", "public"),
});

export function resolveRolePolicy(role: AgentRole): IsolatedToolPolicy {
  return ROLE_ISOLATED_POLICIES[role];
}

export function mcpToolNames(policy: IsolatedToolPolicy): string[] {
  return policy.tools.map((name) => `mcp__orchestrator_worker__${name}`);
}
