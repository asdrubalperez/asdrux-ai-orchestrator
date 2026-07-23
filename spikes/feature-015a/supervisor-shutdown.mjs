import { spawn } from "node:child_process";

const sleeper = () =>
  spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
const holder = sleeper();
const worker = sleeper();
console.log(JSON.stringify({ supervisor: "ready", holderPid: holder.pid, workerPid: worker.pid }));

process.once("SIGTERM", async () => {
  holder.kill("SIGTERM");
  worker.kill("SIGTERM");
  await Promise.all([
    new Promise((resolve) => holder.once("exit", resolve)),
    new Promise((resolve) => worker.once("exit", resolve)),
  ]);
  console.log(
    JSON.stringify({
      component: "supervisor",
      status: "FAIL_CLOSED",
      holderStopped: true,
      workerStopped: true,
      fallbackAllowed: false,
    })
  );
  process.exit(0);
});
