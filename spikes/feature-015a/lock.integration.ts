import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, Pool } from "pg";

const connectionString = process.env.FEATURE015A_DATABASE_URL;
if (!connectionString) throw new Error("FEATURE015A_DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 20 });

const setupSql = `
DROP SCHEMA IF EXISTS feature015a_stage1 CASCADE;
CREATE SCHEMA feature015a_stage1;
CREATE SEQUENCE feature015a_stage1.oauth_credential_fencing_seq
  AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
CREATE TABLE feature015a_stage1.oauth_credential_locks (
  credential_slot_id text PRIMARY KEY,
  run_id uuid NOT NULL,
  fencing_token bigint NOT NULL,
  acquired_at timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL
);`;

const acquireSql = `
WITH candidate AS (
  SELECT nextval('feature015a_stage1.oauth_credential_fencing_seq') AS fencing_token,
         clock_timestamp() AS db_now
)
INSERT INTO feature015a_stage1.oauth_credential_locks (
  credential_slot_id, run_id, fencing_token, acquired_at, lease_expires_at
)
SELECT $1, $2, fencing_token, db_now, db_now + interval '90 seconds'
FROM candidate
ON CONFLICT (credential_slot_id) DO UPDATE
SET run_id = EXCLUDED.run_id,
    fencing_token = EXCLUDED.fencing_token,
    acquired_at = EXCLUDED.acquired_at,
    lease_expires_at = EXCLUDED.lease_expires_at
WHERE feature015a_stage1.oauth_credential_locks.lease_expires_at <= EXCLUDED.acquired_at
RETURNING credential_slot_id, run_id, fencing_token::text, lease_expires_at;`;

const heartbeatSql = `
UPDATE feature015a_stage1.oauth_credential_locks
SET lease_expires_at = clock_timestamp() + interval '90 seconds'
WHERE credential_slot_id = $1
  AND run_id = $2
  AND fencing_token = $3
  AND lease_expires_at > clock_timestamp()
RETURNING lease_expires_at;`;

const releaseSql = `
UPDATE feature015a_stage1.oauth_credential_locks
SET lease_expires_at = clock_timestamp()
WHERE credential_slot_id = $1
  AND run_id = $2
  AND fencing_token = $3
  AND lease_expires_at > clock_timestamp()
RETURNING fencing_token::text;`;

async function acquire(slot: string, runId: string) {
  return (await pool.query(acquireSql, [slot, runId])).rows[0] as
    | { credential_slot_id: string; run_id: string; fencing_token: string }
    | undefined;
}

async function promote(
  slot: string,
  runId: string,
  token: string,
  privateFile: string,
  canonicalFile: string
): Promise<boolean> {
  const temp = `${canonicalFile}.candidate-${runId}`;
  await copyFile(privateFile, temp);
  const handle = await open(temp, "r");
  await handle.sync();
  await handle.close();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT fencing_token
       FROM feature015a_stage1.oauth_credential_locks
       WHERE credential_slot_id = $1 AND run_id = $2 AND fencing_token = $3
         AND lease_expires_at > clock_timestamp()
       FOR UPDATE`,
      [slot, runId, token]
    );
    if (locked.rowCount !== 1) {
      await client.query("ROLLBACK");
      await rm(temp, { force: true });
      return false;
    }
    await rename(temp, canonicalFile);
    await client.query(releaseSql, [slot, runId, token]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    await rm(temp, { force: true });
    throw error;
  } finally {
    client.release();
  }
}

await pool.query(setupSql);
const slot = "synthetic-user:codex";
const contenders = Array.from({ length: 12 }, () => randomUUID());
const results = await Promise.all(contenders.map((runId) => acquire(slot, runId)));
const winners = results.filter(Boolean);
assert.equal(winners.length, 1, "exactly one concurrent acquire must win");
const first = winners[0]!;
assert.equal(first.fencing_token, "1");

assert.equal((await pool.query(heartbeatSql, [slot, first.run_id, first.fencing_token])).rowCount, 1);
assert.equal((await pool.query(heartbeatSql, [slot, randomUUID(), first.fencing_token])).rowCount, 0);
assert.equal((await pool.query(releaseSql, [slot, first.run_id, first.fencing_token])).rowCount, 1);

const secondRun = randomUUID();
const second = await acquire(slot, secondRun);
assert.ok(second);
assert.ok(BigInt(second.fencing_token) > BigInt(first.fencing_token));
assert.equal((await pool.query(heartbeatSql, [slot, first.run_id, first.fencing_token])).rowCount, 0);

const root = await mkdtemp(path.join(os.tmpdir(), "feature015a-cache-"));
const canonical = path.join(root, "canonical.json");
const privateCopy = path.join(root, "private.json");
await writeFile(canonical, JSON.stringify({ refreshToken: "SYNTHETIC_V1" }), { mode: 0o600 });
await copyFile(canonical, privateCopy);
await writeFile(privateCopy, JSON.stringify({ refreshToken: "SYNTHETIC_V2" }), { mode: 0o600 });
assert.equal(await promote(slot, first.run_id, first.fencing_token, privateCopy, canonical), false);
assert.match(await readFile(canonical, "utf8"), /SYNTHETIC_V1/);
assert.equal(await promote(slot, second.run_id, second.fencing_token, privateCopy, canonical), true);
assert.match(await readFile(canonical, "utf8"), /SYNTHETIC_V2/);

const watcher = new Client({ connectionString });
const admin = new Client({ connectionString });
await watcher.connect();
await admin.connect();
const pid = Number((await watcher.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
assert.equal((await admin.query("SELECT pg_terminate_backend($1) AS terminated", [pid])).rows[0].terminated, true);
await assert.rejects(watcher.query("SELECT 1"));
await watcher.end().catch(() => undefined);
await admin.end();

await rm(root, { recursive: true, force: true });
await pool.query("DROP SCHEMA feature015a_stage1 CASCADE");
await pool.end();

console.log(
  JSON.stringify({
    status: "passed",
    concurrentContenders: contenders.length,
    winners: winners.length,
    firstFencingToken: first.fencing_token,
    takeoverFencingToken: second.fencing_token,
    stalePromotionRejected: true,
    validPromotionApplied: true,
    postgresBackendTerminationDetected: true,
  })
);
