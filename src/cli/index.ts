import { pool } from "../db/pool.js";
import { runStart } from "./commands/runStart.js";
import { runStatus } from "./commands/runStatus.js";

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "run:start":
      await runStart(rest);
      break;
    case "run:status":
      await runStatus(rest);
      break;
    default:
      console.error("Comandos disponibles: run:start, run:status");
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
