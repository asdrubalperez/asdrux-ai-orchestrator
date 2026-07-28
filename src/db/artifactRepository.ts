import { pool } from "./pool.js";
import type { AgentRole } from "../contracts/executor.js";
import type { Pool, PoolClient } from "pg";

export const ARTIFACT_CONTENT_LIMIT_BYTES = 64 * 1024;
export const ARTIFACT_SUMMARY_LIMIT_BYTES = 2 * 1024;
export const ARTIFACT_LIST_DEFAULT_LIMIT = 20;
export const ARTIFACT_LIST_MAX_LIMIT = 100;

const AGENT_ROLES = new Set<AgentRole>(["architect", "functional", "planning", "developer", "qa"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ArtifactListFilters {
  runId?: string;
  kind?: string;
  phase?: AgentRole;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
}

export interface ArtifactMetadata {
  artifactId: string;
  runId: string;
  phase: string;
  producerRole: AgentRole | null;
  kind: string;
  createdAt: string;
  summary: string | null;
  summaryTruncated: boolean;
  commitRef: string | null;
  contentBytes: number;
}

export interface ArtifactListResult {
  items: ArtifactMetadata[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface ArtifactReadResult extends ArtifactMetadata {
  content: unknown;
  complete: boolean;
  reason: "CONTENT_TOO_LARGE" | null;
}

interface ArtifactMetadataRow {
  artifact_id: string;
  run_id: string;
  phase: string;
  kind: string;
  created_at: string;
  summary: string | null;
  commit_ref: string | null;
  content_bytes: number;
}

interface ArtifactReadRow extends ArtifactMetadataRow {
  content: unknown;
}

interface ArtifactCursor {
  createdAt: string;
  artifactId: string;
}

export async function assertArtifactRequesterRun(
  requestingRunId: string,
  db: Pool | PoolClient = pool,
): Promise<void> {
  assertUuid(requestingRunId);
  const result = await db.query(
    "select 1 from runs where id = $1 and project_id is not null",
    [requestingRunId],
  );
  if (!result.rows[0]) throw new Error("REQUESTING_RUN_NOT_FOUND");
}

export async function listArtifactsForRunProject(
  requestingRunId: string,
  rawFilters: ArtifactListFilters,
  db: Pool | PoolClient = pool,
): Promise<ArtifactListResult> {
  assertUuid(requestingRunId);
  const filters = normalizeFilters(rawFilters);
  const values: unknown[] = [requestingRunId];
  const conditions: string[] = [];
  const parameter = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (filters.runId) conditions.push(`a.run_id = ${parameter(filters.runId)}::uuid`);
  if (filters.kind) conditions.push(`a.kind = ${parameter(filters.kind)}`);
  if (filters.phase) conditions.push(`a.phase = ${parameter(filters.phase)}`);
  if (filters.createdAfter) conditions.push(`a.created_at >= ${parameter(filters.createdAfter)}::timestamptz`);
  if (filters.createdBefore) conditions.push(`a.created_at < ${parameter(filters.createdBefore)}::timestamptz`);
  if (filters.cursor) {
    conditions.push(
      `(a.created_at, a.id) < (` +
      `${parameter(filters.cursor.createdAt)}::timestamptz, ${parameter(filters.cursor.artifactId)}::uuid)`,
    );
  }
  const limitParameter = parameter(filters.limit + 1);
  const where = conditions.length > 0 ? `and ${conditions.join("\n       and ")}` : "";
  const result = await db.query<ArtifactMetadataRow>(
    `with requester as (
       select project_id from runs where id = $1 and project_id is not null
     )
     select
       a.id as artifact_id,
       a.run_id,
       a.phase,
       a.kind,
       a.created_at::text,
       a.content ->> 'summary' as summary,
       a.commit_ref,
       coalesce(octet_length(a.content::text), 0) as content_bytes
     from artifacts a
     join runs produced_run on produced_run.id = a.run_id
     join requester on requester.project_id = produced_run.project_id
     where true
       ${where}
     order by a.created_at desc, a.id desc
     limit ${limitParameter}`,
    values,
  );

  const truncated = result.rows.length > filters.limit;
  const visible = result.rows.slice(0, filters.limit);
  const items = visible.map(toMetadata);
  const last = visible.at(-1);
  return {
    items,
    truncated,
    nextCursor: truncated && last
      ? encodeArtifactCursor({ createdAt: normalizeTimestamp(last.created_at), artifactId: last.artifact_id })
      : null,
  };
}

export async function readArtifactForRunProject(
  requestingRunId: string,
  artifactId: string,
  db: Pool | PoolClient = pool,
): Promise<ArtifactReadResult> {
  assertUuid(requestingRunId);
  assertUuid(artifactId);
  const result = await db.query<ArtifactReadRow>(
    `with requester as (
       select project_id from runs where id = $1 and project_id is not null
     )
     select
       a.id as artifact_id,
       a.run_id,
       a.phase,
       a.kind,
       a.created_at::text,
       a.content ->> 'summary' as summary,
       a.commit_ref,
       coalesce(octet_length(a.content::text), 0) as content_bytes,
       case
         when coalesce(octet_length(a.content::text), 0) <= $3 then a.content
         else null
       end as content
     from artifacts a
     join runs produced_run on produced_run.id = a.run_id
     join requester on requester.project_id = produced_run.project_id
     where a.id = $2`,
    [requestingRunId, artifactId, ARTIFACT_CONTENT_LIMIT_BYTES],
  );
  const row = result.rows[0];
  if (!row) throw new Error("ARTIFACT_NOT_FOUND");
  const metadata = toMetadata(row);
  const complete = metadata.contentBytes <= ARTIFACT_CONTENT_LIMIT_BYTES;
  return {
    ...metadata,
    content: complete ? row.content : null,
    complete,
    reason: complete ? null : "CONTENT_TOO_LARGE",
  };
}

export function encodeArtifactCursor(cursor: ArtifactCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeArtifactCursor(value: string): ArtifactCursor {
  if (!value || value.length > 2048) throw new Error("INVALID_ARGUMENTS");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error();
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.createdAt !== "string" ||
      typeof record.artifactId !== "string"
    ) throw new Error();
    assertTimestamp(record.createdAt);
    assertUuid(record.artifactId);
    return { createdAt: normalizeTimestamp(record.createdAt), artifactId: record.artifactId };
  } catch {
    throw new Error("INVALID_ARGUMENTS");
  }
}

function normalizeFilters(raw: ArtifactListFilters): Required<Pick<ArtifactListFilters, "limit">> & {
  runId?: string;
  kind?: string;
  phase?: AgentRole;
  createdAfter?: string;
  createdBefore?: string;
  cursor?: ArtifactCursor;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_ARGUMENTS");
  const allowed = new Set(["runId", "kind", "phase", "createdAfter", "createdBefore", "limit", "cursor"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error("INVALID_ARGUMENTS");
  const limit = raw.limit ?? ARTIFACT_LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > ARTIFACT_LIST_MAX_LIMIT) {
    throw new Error("INVALID_ARGUMENTS");
  }
  if (raw.runId !== undefined) assertUuid(raw.runId);
  if (raw.kind !== undefined && (typeof raw.kind !== "string" || !raw.kind.trim() || raw.kind.length > 100)) {
    throw new Error("INVALID_ARGUMENTS");
  }
  if (raw.phase !== undefined && !AGENT_ROLES.has(raw.phase)) throw new Error("INVALID_ARGUMENTS");
  if (raw.createdAfter !== undefined) assertTimestamp(raw.createdAfter);
  if (raw.createdBefore !== undefined) assertTimestamp(raw.createdBefore);
  if (
    raw.createdAfter !== undefined &&
    raw.createdBefore !== undefined &&
    Date.parse(raw.createdAfter) >= Date.parse(raw.createdBefore)
  ) throw new Error("INVALID_ARGUMENTS");
  return {
    limit,
    ...(raw.runId === undefined ? {} : { runId: raw.runId }),
    ...(raw.kind === undefined ? {} : { kind: raw.kind.trim() }),
    ...(raw.phase === undefined ? {} : { phase: raw.phase }),
    ...(raw.createdAfter === undefined ? {} : { createdAfter: normalizeTimestamp(raw.createdAfter) }),
    ...(raw.createdBefore === undefined ? {} : { createdBefore: normalizeTimestamp(raw.createdBefore) }),
    ...(raw.cursor === undefined ? {} : { cursor: decodeArtifactCursor(raw.cursor) }),
  };
}

function toMetadata(row: ArtifactMetadataRow): ArtifactMetadata {
  const summary = truncateUtf8(row.summary, ARTIFACT_SUMMARY_LIMIT_BYTES);
  return {
    artifactId: row.artifact_id,
    runId: row.run_id,
    phase: row.phase,
    producerRole: AGENT_ROLES.has(row.phase as AgentRole) ? row.phase as AgentRole : null,
    kind: row.kind,
    createdAt: normalizeTimestamp(row.created_at),
    summary: summary.value,
    summaryTruncated: summary.truncated,
    commitRef: row.commit_ref,
    contentBytes: Number(row.content_bytes),
  };
}

function truncateUtf8(value: string | null, maximumBytes: number): { value: string | null; truncated: boolean } {
  if (value === null) return { value: null, truncated: false };
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) return { value, truncated: false };
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    output += character;
    bytes += characterBytes;
  }
  return { value: output, truncated: true };
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("INVALID_ARGUMENTS");
}

function assertTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
    throw new Error("INVALID_ARGUMENTS");
  }
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}
