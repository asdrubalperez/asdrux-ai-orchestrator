export const TOOL_NAMES = [
  "fs_read",
  "fs_search",
  "fs_glob",
  "fs_write",
  "fs_edit",
  "command_exec",
  "web_search",
  "web_fetch",
  "artifact_list",
  "artifact_read",
] as const;

export type IsolatedToolName = (typeof TOOL_NAMES)[number];
export type SyntheticPolicyId = string & { readonly __syntheticPolicyId: unique symbol };

export interface IsolatedToolPolicy {
  id: SyntheticPolicyId;
  tools: readonly IsolatedToolName[];
  filesystem: "read-only" | "workspace-write";
  egress: "none" | "public";
}

export class PolicyMatrix {
  readonly #policies = new Map<SyntheticPolicyId, IsolatedToolPolicy>();

  register(policy: IsolatedToolPolicy): void {
    if (this.#policies.has(policy.id)) throw new Error(`Duplicate policy: ${policy.id}`);
    const unique = new Set(policy.tools);
    if (unique.size !== policy.tools.length) throw new Error(`Duplicate tool in policy: ${policy.id}`);
    if (policy.filesystem === "read-only" &&
        policy.tools.some((tool) => tool === "fs_write" || tool === "fs_edit" || tool === "command_exec")) {
      throw new Error(`Read-only policy cannot expose mutating tools: ${policy.id}`);
    }
    this.#policies.set(policy.id, Object.freeze({ ...policy, tools: Object.freeze([...policy.tools]) }));
  }

  resolve(id: SyntheticPolicyId): IsolatedToolPolicy {
    const policy = this.#policies.get(id);
    if (!policy) throw new Error(`Unknown policy: ${id}`);
    return policy;
  }
}

const closedObject = (
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const string = { type: "string" };
const boolean = { type: "boolean" };
const nullableString = { type: ["string", "null"] };
const integer = (minimum?: number, maximum?: number) => ({
  type: "integer",
  ...(minimum === undefined ? {} : { minimum }),
  ...(maximum === undefined ? {} : { maximum }),
});

export const TOOL_SCHEMAS: Record<IsolatedToolName, {
  description: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}> = {
  fs_read: {
    description: "Read a UTF-8 text file within the worktree",
    args: closedObject({ path: string, offset: integer(0), limitBytes: integer(1) }, ["path"]),
    result: closedObject({ content: string, bytesRead: integer(0), truncated: boolean }, ["content", "bytesRead", "truncated"]),
  },
  fs_search: {
    description: "Search text within the worktree",
    args: closedObject({ pattern: string, path: string, glob: string, maxMatches: integer(1) }, ["pattern"]),
    result: closedObject({ matches: { type: "array" }, truncated: boolean }, ["matches", "truncated"]),
  },
  fs_glob: {
    description: "Find paths matching a glob within the worktree",
    args: closedObject({ pattern: string, path: string, maxResults: integer(1) }, ["pattern"]),
    result: closedObject({ paths: { type: "array", items: string }, truncated: boolean }, ["paths", "truncated"]),
  },
  fs_write: {
    description: "Write a UTF-8 file within the worktree",
    args: closedObject({ path: string, content: string, createOnly: boolean }, ["path", "content"]),
    result: closedObject({ bytesWritten: integer(0) }, ["bytesWritten"]),
  },
  fs_edit: {
    description: "Replace deterministic text within a UTF-8 file",
    args: closedObject({ path: string, oldText: string, newText: string, replaceAll: boolean }, ["path", "oldText", "newText"]),
    result: closedObject({ replacements: integer(0), bytesWritten: integer(0) }, ["replacements", "bytesWritten"]),
  },
  command_exec: {
    description: "Execute a program without a shell",
    args: closedObject({ program: string, args: { type: "array", items: string }, cwd: string, timeoutMs: integer(1, 120_000) }, ["program"]),
    result: closedObject({ exitCode: { type: ["integer", "null"] }, stdout: string, stderr: string, timedOut: boolean, truncated: boolean }, ["exitCode", "stdout", "stderr", "timedOut", "truncated"]),
  },
  web_search: {
    description: "Discover public HTTPS sources using Tavily basic search",
    args: closedObject({ query: { type: "string", minLength: 1, maxLength: 500 }, maxResults: integer(1, 20) }, ["query"]),
    result: closedObject({ results: { type: "array" }, truncated: boolean }, ["results", "truncated"]),
  },
  web_fetch: {
    description: "Fetch a public HTTPS URL without credentials",
    args: closedObject({ url: string, method: { type: "string", enum: ["GET", "HEAD"] }, timeoutMs: integer(1, 120_000), maxBytes: integer(1) }, ["url"]),
    result: closedObject({ finalUrl: string, status: integer(100, 599), headers: { type: "object" }, contentType: string, body: string, truncated: boolean }, ["finalUrl", "status", "headers", "contentType", "body", "truncated"]),
  },
  artifact_list: {
    description: "List artifact metadata from the current run's project without returning artifact content",
    args: closedObject({
      runId: string,
      kind: string,
      phase: { type: "string", enum: ["architect", "functional", "planning", "developer", "qa"] },
      createdAfter: string,
      createdBefore: string,
      limit: integer(1, 100),
      cursor: string,
    }, []),
    result: closedObject({
      items: {
        type: "array",
        items: closedObject({
          artifactId: string,
          runId: string,
          phase: string,
          producerRole: nullableString,
          kind: string,
          createdAt: string,
          summary: nullableString,
          summaryTruncated: boolean,
          commitRef: nullableString,
          contentBytes: integer(0),
        }, [
          "artifactId", "runId", "phase", "producerRole", "kind", "createdAt", "summary",
          "summaryTruncated", "commitRef", "contentBytes",
        ]),
      },
      truncated: boolean,
      nextCursor: nullableString,
    }, ["items", "truncated", "nextCursor"]),
  },
  artifact_read: {
    description: "Read one artifact from the current run's project, subject to the 64 KiB content limit",
    args: closedObject({ artifactId: string }, ["artifactId"]),
    result: closedObject({
      artifactId: string,
      runId: string,
      phase: string,
      producerRole: nullableString,
      kind: string,
      createdAt: string,
      summary: nullableString,
      summaryTruncated: boolean,
      commitRef: nullableString,
      contentBytes: integer(0),
      content: {},
      complete: boolean,
      reason: { type: ["string", "null"], enum: ["CONTENT_TOO_LARGE", null] },
    }, [
      "artifactId", "runId", "phase", "producerRole", "kind", "createdAt", "summary",
      "summaryTruncated", "commitRef", "contentBytes", "content", "complete", "reason",
    ]),
  },
};

export const MAX_FRAME_BYTES = 10 * 1024 * 1024;
export const MAX_CALLS_PER_INVOCATION = 500;
export const MAX_CALL_MS = 120_000;
export const DEFAULT_MAX_BYTES = 1024 * 1024;

export function assertClosedArgs(tool: IsolatedToolName, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_ARGUMENTS");
  const candidate = value as Record<string, unknown>;
  const schema = TOOL_SCHEMAS[tool].args;
  const allowed = new Set(Object.keys(schema.properties as Record<string, unknown>));
  if (Object.keys(candidate).some((key) => !allowed.has(key))) throw new Error("INVALID_ARGUMENTS");
  for (const key of schema.required as string[]) {
    if (!(key in candidate)) throw new Error("INVALID_ARGUMENTS");
  }
  return candidate;
}
