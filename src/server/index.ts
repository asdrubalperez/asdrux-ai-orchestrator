import "dotenv/config";
import { createApp, serverConfigFromEnv } from "./app.js";
import { startRunEventsListener } from "./sse.js";
import { assertRunbookAvailableAtStartup } from "../runbook/runbookProvider.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await assertRunbookAvailableAtStartup();
await startRunEventsListener();
const app = createApp(serverConfigFromEnv());
app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});
