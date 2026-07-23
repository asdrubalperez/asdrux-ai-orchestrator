import { createHash, randomUUID } from "node:crypto";
import { copyFile, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const connectionString = process.env.FEATURE015A_DATABASE_URL;
const privateFile = process.env.FEATURE015A_PRIVATE_CREDENTIAL;
const canonicalFile = process.env.FEATURE015A_CANONICAL_CREDENTIAL;
if (!connectionString || !privateFile || !canonicalFile) {
  throw new Error("database and credential paths are required");
}

const pool = new Pool({ connectionString, max: 2 });
const runId = randomUUID();
const slot = "feature015a-stage2-claude-test-account";

await pool.query(`
  CREATE SCHEMA IF NOT EXISTS feature015a_stage2;
  CREATE SEQUENCE IF NOT EXISTS feature015a_stage2.oauth_credential_fencing_seq
    AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;
  CREATE TABLE IF NOT EXISTS feature015a_stage2.oauth_credential_locks (
    credential_slot_id text PRIMARY KEY,
    run_id uuid NOT NULL,
    fencing_token bigint NOT NULL,
    acquired_at timestamptz NOT NULL,
    lease_expires_at timestamptz NOT NULL
  );
`);

const acquired = await pool.query(
  `WITH candidate AS (
     SELECT nextval('feature015a_stage2.oauth_credential_fencing_seq') AS fencing_token,
            clock_timestamp() AS db_now
   )
   INSERT INTO feature015a_stage2.oauth_credential_locks (
     credential_slot_id, run_id, fencing_token, acquired_at, lease_expires_at
   )
   SELECT $1, $2, fencing_token, db_now, db_now + interval '90 seconds'
   FROM candidate
   ON CONFLICT (credential_slot_id) DO UPDATE
   SET run_id = EXCLUDED.run_id,
       fencing_token = EXCLUDED.fencing_token,
       acquired_at = EXCLUDED.acquired_at,
       lease_expires_at = EXCLUDED.lease_expires_at
   WHERE feature015a_stage2.oauth_credential_locks.lease_expires_at <= EXCLUDED.acquired_at
   RETURNING fencing_token::text`,
  [slot, runId]
);
if (acquired.rowCount !== 1) throw new Error("credential lock was not acquired");
const fencingToken = acquired.rows[0].fencing_token;

const canonicalBefore = await readFile(canonicalFile);
const privateBytes = await readFile(privateFile);
const tempFile = `${canonicalFile}.candidate-${runId}`;
await copyFile(privateFile, tempFile);
const tempHandle = await open(tempFile, "r");
await tempHandle.sync();
await tempHandle.close();

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const locked = await client.query(
    `SELECT fencing_token
     FROM feature015a_stage2.oauth_credential_locks
     WHERE credential_slot_id = $1
       AND run_id = $2
       AND fencing_token = $3
       AND lease_expires_at > clock_timestamp()
     FOR UPDATE`,
    [slot, runId, fencingToken]
  );
  if (locked.rowCount !== 1) throw new Error("fencing check rejected current owner");
  await rename(tempFile, canonicalFile);
  const directory = await open(path.dirname(canonicalFile), "r");
  await directory.sync();
  await directory.close();
  const released = await client.query(
    `UPDATE feature015a_stage2.oauth_credential_locks
     SET lease_expires_at = clock_timestamp()
     WHERE credential_slot_id = $1
       AND run_id = $2
       AND fencing_token = $3
       AND lease_expires_at > clock_timestamp()
     RETURNING fencing_token`,
    [slot, runId, fencingToken]
  );
  if (released.rowCount !== 1) throw new Error("release rejected current owner");
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  await rm(tempFile, { force: true });
  throw error;
} finally {
  client.release();
}

const canonicalAfter = await readFile(canonicalFile);
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
console.log(
  JSON.stringify({
    status: "passed",
    fencingToken,
    canonicalBeforeSha256: sha256(canonicalBefore),
    privateSha256: sha256(privateBytes),
    canonicalAfterSha256: sha256(canonicalAfter),
    canonicalUnchangedBeforePromotion: sha256(canonicalBefore) !== sha256(privateBytes),
    promotedPrivateExactly: sha256(canonicalAfter) === sha256(privateBytes),
  })
);

await pool.end();
