import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentRole } from "../../contracts/executor.js";
import type { ArtifactListResult, ArtifactReadResult } from "../../db/artifactRepository.js";
import { startArtifactProxy, type ArtifactProxyServices } from "./artifactProxy.js";
import { UnixArtifactProxyClient } from "./artifactProxyClient.js";

const REQUESTING_RUN_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";
const metadata = {
  artifactId: ARTIFACT_ID,
  runId: "33333333-3333-4333-8333-333333333333",
  phase: "architect",
  producerRole: "architect" as AgentRole,
  kind: "design",
  createdAt: "2026-07-28T12:00:00.000Z",
  summary: "SUMMARY_CANARY",
  summaryTruncated: false,
  commitRef: null,
  contentBytes: 42,
};

test("artifact proxy binds requester, returns tools and logs no content or summary", async (t) => {
  if (process.platform === "win32") {
    t.skip("Unix socket proxy is validated on Linux/VPS");
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-proxy-"));
  const socketPath = path.join(directory, "artifact.sock");
  const logs: Record<string, unknown>[] = [];
  const calls: Array<{ operation: string; requestingRunId: string }> = [];
  const services: ArtifactProxyServices = {
    assertRequester: async (requestingRunId) => {
      calls.push({ operation: "assert", requestingRunId });
    },
    list: async (requestingRunId): Promise<ArtifactListResult> => {
      calls.push({ operation: "list", requestingRunId });
      return { items: [metadata], truncated: false, nextCursor: null };
    },
    read: async (requestingRunId): Promise<ArtifactReadResult> => {
      calls.push({ operation: "read", requestingRunId });
      return {
        ...metadata,
        content: { secret: "CONTENT_CANARY" },
        complete: true,
        reason: null,
      };
    },
  };
  const proxy = await startArtifactProxy({
    socketPath,
    token: "artifact-token",
    requestingRunId: REQUESTING_RUN_ID,
    role: "planning",
    services,
    log: (entry) => logs.push(entry),
  });
  try {
    const client = new UnixArtifactProxyClient(socketPath, "artifact-token");
    assert.equal((await client.list({ kind: "design" })).items.length, 1);
    assert.equal((await client.read({ artifactId: ARTIFACT_ID })).complete, true);
    assert.ok(calls.every((call) => call.requestingRunId === REQUESTING_RUN_ID));
    const serializedLogs = JSON.stringify(logs);
    assert.doesNotMatch(serializedLogs, /SUMMARY_CANARY|CONTENT_CANARY/);
    assert.doesNotMatch(serializedLogs, /design|kind|filters/);
    assert.match(serializedLogs, /artifact_list/);
    assert.match(serializedLogs, /artifact_read/);

    const unauthorized = new UnixArtifactProxyClient(socketPath, "wrong-token");
    await assert.rejects(unauthorized.list({}), /WORKER_UNAVAILABLE/);
  } finally {
    await proxy.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("artifact proxy exposes the same error for missing and external artifacts", async (t) => {
  if (process.platform === "win32") {
    t.skip("Unix socket proxy is validated on Linux/VPS");
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-proxy-not-found-"));
  const socketPath = path.join(directory, "artifact.sock");
  const services: ArtifactProxyServices = {
    assertRequester: async () => undefined,
    list: async () => ({ items: [], truncated: false, nextCursor: null }),
    read: async () => {
      throw new Error("ARTIFACT_NOT_FOUND");
    },
  };
  const proxy = await startArtifactProxy({
    socketPath,
    token: "artifact-token",
    requestingRunId: REQUESTING_RUN_ID,
    role: "architect",
    services,
    log: () => undefined,
  });
  try {
    const client = new UnixArtifactProxyClient(socketPath, "artifact-token");
    for (const artifactId of [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]) {
      await assert.rejects(
        client.read({ artifactId }),
        (error: Error) => error.message === "ARTIFACT_NOT_FOUND",
      );
    }
  } finally {
    await proxy.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
