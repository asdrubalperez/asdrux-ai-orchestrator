import http from "node:http";
import type { AgentRole } from "../../contracts/executor.js";
import {
  assertArtifactRequesterRun,
  listArtifactsForRunProject,
  readArtifactForRunProject,
  type ArtifactListFilters,
} from "../../db/artifactRepository.js";

const MAX_ARTIFACT_PROXY_REQUEST_BYTES = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ArtifactProxyHandle {
  close(): Promise<void>;
}

export interface ArtifactProxyServices {
  assertRequester(requestingRunId: string): Promise<void>;
  list(requestingRunId: string, filters: ArtifactListFilters): ReturnType<typeof listArtifactsForRunProject>;
  read(requestingRunId: string, artifactId: string): ReturnType<typeof readArtifactForRunProject>;
}

export async function startArtifactProxy(params: {
  socketPath: string;
  token: string;
  requestingRunId: string;
  role: AgentRole;
  log?: (entry: Record<string, unknown>) => void;
  services?: ArtifactProxyServices;
}): Promise<ArtifactProxyHandle> {
  const log = params.log ?? ((entry) => console.log(JSON.stringify(entry)));
  const services: ArtifactProxyServices = params.services ?? {
    assertRequester: assertArtifactRequesterRun,
    list: listArtifactsForRunProject,
    read: readArtifactForRunProject,
  };
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || (request.url !== "/list" && request.url !== "/read")) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${params.token}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "WORKER_UNAVAILABLE" }));
      return;
    }

    const startedAt = Date.now();
    const operation = request.url === "/list" ? "artifact_list" : "artifact_read";
    let artifactId: string | undefined;
    try {
      const args = await readArgs(request);
      artifactId = operation === "artifact_read" &&
        typeof args.artifactId === "string" &&
        UUID_PATTERN.test(args.artifactId)
        ? args.artifactId
        : undefined;

      await services.assertRequester(params.requestingRunId);
      const result = operation === "artifact_list"
        ? await services.list(params.requestingRunId, args as ArtifactListFilters)
        : await services.read(params.requestingRunId, args.artifactId as string);
      logAccess(log, {
        requestingRunId: params.requestingRunId,
        role: params.role,
        operation,
        artifactId,
        result: "ok",
        itemCount: operation === "artifact_list" ? (result as { items: unknown[] }).items.length : undefined,
        durationMs: Date.now() - startedAt,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ result }));
    } catch (error) {
      const code = publicErrorCode(error);
      logAccess(log, {
        requestingRunId: params.requestingRunId,
        role: params.role,
        operation,
        artifactId,
        result: code,
        durationMs: Date.now() - startedAt,
      });
      const status = code === "ARTIFACT_NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 400;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: code }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(params.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function readArgs(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_ARTIFACT_PROXY_REQUEST_BYTES) throw new Error("INVALID_ARGUMENTS");
    chunks.push(buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error("INVALID_ARGUMENTS");
  }
}

function publicErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "ARTIFACT_NOT_FOUND" ||
    message === "INVALID_ARGUMENTS" ||
    message === "REQUESTING_RUN_NOT_FOUND"
  ) return message;
  return "INTERNAL_ERROR";
}

function logAccess(
  log: (entry: Record<string, unknown>) => void,
  entry: {
    requestingRunId: string;
    role: AgentRole;
    operation: string;
    artifactId?: string;
    result: string;
    itemCount?: number;
    durationMs: number;
  },
): void {
  log({
    type: "artifact_access",
    timestamp: new Date().toISOString(),
    requestingRunId: entry.requestingRunId,
    role: entry.role,
    operation: entry.operation,
    ...(entry.artifactId === undefined ? {} : { artifactId: entry.artifactId }),
    result: entry.result,
    ...(entry.itemCount === undefined ? {} : { itemCount: entry.itemCount }),
    durationMs: entry.durationMs,
  });
}
