import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

dotenv.config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "..", "..", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL_DEV;
  if (!connectionString) {
    throw new Error("DATABASE_URL_DEV no está definida.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Set(
      (await client.query<{ filename: string }>("select filename from schema_migrations")).rows.map(
        (r) => r.filename
      )
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[skip] ${file} (ya aplicada)`);
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      console.log(`[apply] ${file}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log("Migraciones al día.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
