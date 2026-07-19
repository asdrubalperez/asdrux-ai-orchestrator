import { pool } from "../db/pool.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { runStart } from "./commands/runStart.js";
import { runStatus } from "./commands/runStatus.js";
import { seedUser } from "./commands/seedUser.js";

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case "run:start":
      await runStart(rest);
      break;
    case "run:status":
      await runStatus(rest);
      break;
    case "seed:user":
      await seedUser();
      break;
    case "login":
      await login();
      break;
    case "logout":
      await logout();
      break;
    default:
      console.error("Comandos disponibles: run:start, run:status, seed:user, login, logout");
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
