import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRunDetailForUser } from "../db/repository.js";
import { buildRunViewModel } from "./runView.js";
import { openRunEventsStream, startRunEventsListener } from "./sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/runs/:id", async (req, res, next) => {
  try {
    const userId = currentDevelopmentUserId();
    const detail = await getRunDetailForUser(req.params.id, userId);
    if (!detail) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }
    res.json(buildRunViewModel(detail));
  } catch (err) {
    next(err);
  }
});

app.get("/runs/:id/stream", async (req, res, next) => {
  try {
    await openRunEventsStream({
      runId: req.params.id,
      userId: currentDevelopmentUserId(),
      lastEventId: parseLastEventId(req.header("Last-Event-ID")),
      response: res,
    });
  } catch (err) {
    next(err);
  }
});

const frontendDist = path.resolve(__dirname, "..", "..", "web", "dist");
app.use(express.static(frontendDist));
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Error desconocido";
  const status = message.includes("ORCHESTRATOR_WEB_USER_ID") ? 401 : 500;
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

await startRunEventsListener();
app.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
});

function currentDevelopmentUserId(): string {
  const userId = process.env.ORCHESTRATOR_WEB_USER_ID;
  if (!userId) {
    throw new Error("ORCHESTRATOR_WEB_USER_ID requerido para 013A.");
  }
  return userId;
}

function parseLastEventId(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
