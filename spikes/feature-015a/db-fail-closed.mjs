import pg from "pg";

const connectionString = process.env.FEATURE015A_DATABASE_URL;
if (!connectionString) throw new Error("FEATURE015A_DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
console.log("db_watcher=ready");
let failed = false;
let interval;

const deadline = setTimeout(() => {
  console.error("db_watcher=timeout_without_failure");
  process.exit(1);
}, 15_000);

async function failClosed(error) {
  if (failed) return;
  failed = true;
  if (interval) clearInterval(interval);
  clearTimeout(deadline);
  console.log(
    JSON.stringify({
      component: "postgres",
      status: "FAIL_CLOSED",
      promotionAllowed: false,
      fallbackAllowed: false,
      error: error instanceof Error ? error.message : String(error),
    })
  );
  await client.end().catch(() => undefined);
}

client.on("error", failClosed);

interval = setInterval(async () => {
  try {
    await client.query("SELECT 1");
  } catch (error) {
    await failClosed(error);
  }
}, 200);
