import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  ARTIFACT_CONTENT_LIMIT_BYTES,
  ARTIFACT_LIST_MAX_LIMIT,
  ARTIFACT_SUMMARY_LIMIT_BYTES,
  assertArtifactRequesterRun,
  decodeArtifactCursor,
  encodeArtifactCursor,
  listArtifactsForRunProject,
  readArtifactForRunProject,
} from "./artifactRepository.js";
import { pool } from "./pool.js";

test("artifact cursor is opaque, stable and rejects malformed input", () => {
  const value = { createdAt: "2026-07-28T12:00:00.000Z", artifactId: "11111111-1111-4111-8111-111111111111" };
  const encoded = encodeArtifactCursor(value);
  assert.doesNotMatch(encoded, /2026-07-28/);
  assert.deepEqual(decodeArtifactCursor(encoded), value);
  assert.throws(() => decodeArtifactCursor("not-a-cursor"), /INVALID_ARGUMENTS/);
  assert.throws(
    () => decodeArtifactCursor(Buffer.from(JSON.stringify({ ...value, extra: true })).toString("base64url")),
    /INVALID_ARGUMENTS/,
  );
});

test("artifact repository enforces project isolation, pagination and volume limits", async (t) => {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }
  await client.query("begin");
  try {
    const prerequisite = await client.query<{ pipeline_id: string; owner_id: string }>(
      `select pd.id as pipeline_id, u.id as owner_id
       from pipeline_definitions pd cross join users u
       order by pd.created_at asc, u.created_at asc
       limit 1`,
    );
    if (!prerequisite.rows[0]) {
      t.skip("Requires one pipeline definition and user in the integration database");
      return;
    }

    const { pipeline_id: pipelineId, owner_id: ownerId } = prerequisite.rows[0];
    const projectA = randomUUID();
    const projectB = randomUUID();
    await client.query(
      `insert into projects (id, name, repo_path, owner_id)
       values ($1, 'feature-022-a', '/tmp/feature-022-a', $3),
              ($2, 'feature-022-b', '/tmp/feature-022-b', $3)`,
      [projectA, projectB, ownerId],
    );

    const requestingRun = randomUUID();
    const producerRun = randomUUID();
    const externalRun = randomUUID();
    const noProjectRun = randomUUID();
    for (const [runId, projectId] of [
      [requestingRun, projectA],
      [producerRun, projectA],
      [externalRun, projectB],
      [noProjectRun, null],
    ] as const) {
      await client.query(
        `insert into runs (
           id, pipeline_definition_id, owner_id, project_id, current_phase, status, root_run_id
         ) values ($1, $2, $3, $4, 'architect', 'running', $1)`,
        [runId, pipelineId, ownerId, projectId],
      );
    }

    const sameTimestamp = "2026-07-28T12:00:00.000Z";
    const authorizedA = randomUUID();
    const authorizedB = randomUUID();
    const historical = randomUUID();
    const tooLarge = randomUUID();
    const external = randomUUID();
    await client.query(
      `insert into artifacts (id, run_id, phase, kind, content, created_at)
       values
         ($1, $6, 'developer', 'code', $9, $8),
         ($2, $6, 'qa', 'verdict_approved', $10, $8),
         ($3, $6, 'legacy-role', 'design', $11, $8),
         ($4, $6, 'planning', 'design', $12, $8),
         ($5, $7, 'architect', 'design', $13, $8)`,
      [
        authorizedA,
        authorizedB,
        historical,
        tooLarge,
        external,
        producerRun,
        externalRun,
        sameTimestamp,
        { summary: "developer summary", outputArtifact: { file: "a.ts" } },
        { summary: "s".repeat(ARTIFACT_SUMMARY_LIMIT_BYTES + 100), outputArtifact: "approved" },
        { outputArtifact: "legacy" },
        { summary: "large", outputArtifact: "x".repeat(ARTIFACT_CONTENT_LIMIT_BYTES + 100) },
        { summary: "external canary", outputArtifact: "secret" },
      ],
    );

    await assertArtifactRequesterRun(requestingRun, client);
    await assert.rejects(assertArtifactRequesterRun(noProjectRun, client), /REQUESTING_RUN_NOT_FOUND/);
    await assert.rejects(assertArtifactRequesterRun(randomUUID(), client), /REQUESTING_RUN_NOT_FOUND/);
    await assert.rejects(
      listArtifactsForRunProject(requestingRun, { limit: ARTIFACT_LIST_MAX_LIMIT + 1 }, client),
      /INVALID_ARGUMENTS/,
    );
    await assert.rejects(
      listArtifactsForRunProject(requestingRun, { unexpected: true } as never, client),
      /INVALID_ARGUMENTS/,
    );

    const firstPage = await listArtifactsForRunProject(requestingRun, { limit: 1 }, client);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.truncated, true);
    assert.ok(firstPage.nextCursor);
    const secondPage = await listArtifactsForRunProject(
      requestingRun,
      { limit: 1, cursor: firstPage.nextCursor! },
      client,
    );
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0].artifactId, firstPage.items[0].artifactId);
    assert.ok(firstPage.items[0].artifactId > secondPage.items[0].artifactId);

    const externalRunFilter = await listArtifactsForRunProject(
      requestingRun,
      { runId: externalRun },
      client,
    );
    assert.deepEqual(externalRunFilter.items, []);

    const qa = await listArtifactsForRunProject(requestingRun, { phase: "qa" }, client);
    assert.equal(qa.items.length, 1);
    assert.equal(Buffer.byteLength(qa.items[0].summary ?? "", "utf8"), ARTIFACT_SUMMARY_LIMIT_BYTES);
    assert.equal(qa.items[0].summaryTruncated, true);

    const legacy = await readArtifactForRunProject(requestingRun, historical, client);
    assert.equal(legacy.phase, "legacy-role");
    assert.equal(legacy.producerRole, null);
    assert.equal(legacy.summary, null);
    assert.equal(legacy.complete, true);

    const large = await readArtifactForRunProject(requestingRun, tooLarge, client);
    assert.equal(large.complete, false);
    assert.equal(large.content, null);
    assert.equal(large.reason, "CONTENT_TOO_LARGE");
    assert.ok(large.contentBytes > ARTIFACT_CONTENT_LIMIT_BYTES);

    const exactLimit = randomUUID();
    await client.query(
      `insert into artifacts (id, run_id, phase, kind, content, created_at)
       values ($1, $2, 'planning', 'design',
         jsonb_build_object('payload', repeat('x', $4)), $3)`,
      [exactLimit, producerRun, sameTimestamp, ARTIFACT_CONTENT_LIMIT_BYTES - 15],
    );
    const exact = await readArtifactForRunProject(requestingRun, exactLimit, client);
    assert.equal(exact.contentBytes, ARTIFACT_CONTENT_LIMIT_BYTES);
    assert.equal(exact.complete, true);
    assert.equal(exact.reason, null);

    await assert.rejects(
      readArtifactForRunProject(requestingRun, external, client),
      (error: Error) => error.message === "ARTIFACT_NOT_FOUND",
    );
    await assert.rejects(
      readArtifactForRunProject(requestingRun, randomUUID(), client),
      (error: Error) => error.message === "ARTIFACT_NOT_FOUND",
    );
  } finally {
    await client.query("rollback");
    client.release();
  }
});
