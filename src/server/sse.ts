import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { getCurrentProjectConfig, getRunDetailForUser, getRunEventsAfterForUser } from "../db/repository.js";
import { buildRunViewModel, toReleaseRoadmapView } from "./runView.js";

/** FEATURE-018: mismo criterio que resolveReleaseRoadmap en app.ts (no importado desde acá para no
 * crear un import circular app.ts <-> sse.ts). */
async function resolveReleaseRoadmap(projectId: string | null) {
  if (!projectId) return null;
  const config = await getCurrentProjectConfig(projectId, "release_roadmap");
  return toReleaseRoadmapView(config?.value ?? null);
}

interface SseClient {
  id: string;
  runId: string;
  userId: string;
  response: Response;
  lastEventId: number;
}

const clientsByRunId = new Map<string, Map<string, SseClient>>();
let listenClient: PoolClient | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export async function openRunEventsStream(params: {
  runId: string;
  userId: string;
  lastEventId: number;
  response: Response;
}): Promise<void> {
  const detail = await getRunDetailForUser(params.runId, params.userId);
  if (!detail) {
    params.response.status(404).end();
    return;
  }

  params.response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  params.response.flushHeaders?.();

  const client: SseClient = {
    id: randomUUID(),
    runId: params.runId,
    userId: params.userId,
    response: params.response,
    lastEventId: params.lastEventId,
  };
  addClient(client);

  writeEvent(params.response, "snapshot", buildRunViewModel(detail, await resolveReleaseRoadmap(detail.run.project_id)));
  await replayEvents(client);

  const heartbeat = setInterval(() => {
    params.response.write(": heartbeat\n\n");
  }, 15_000);

  params.response.on("close", () => {
    clearInterval(heartbeat);
    removeClient(client);
  });
}

export async function startRunEventsListener(): Promise<void> {
  if (listenClient) return;

  try {
    const client = await pool.connect();
    listenClient = client;
    client.on("notification", (message) => {
      void handleNotification(message.payload);
    });
    client.on("error", () => {
      scheduleReconnect();
    });
    await client.query("listen run_events_channel");
  } catch {
    scheduleReconnect();
  }
}

async function handleNotification(payload: string | undefined): Promise<void> {
  const runId = runIdFromNotification(payload);
  if (!runId) return;

  const clients = clientsByRunId.get(runId);
  if (!clients) return;

  await Promise.all(
    [...clients.values()].map(async (client) => {
      const detail = await getRunDetailForUser(client.runId, client.userId);
      if (!detail) {
        writeEvent(client.response, "forbidden", { runId: client.runId });
        client.response.end();
        return;
      }
      writeEvent(
        client.response,
        "snapshot",
        buildRunViewModel(detail, await resolveReleaseRoadmap(detail.run.project_id))
      );
      await replayEvents(client);
    })
  );
}

async function replayEvents(client: SseClient): Promise<void> {
  const events = await getRunEventsAfterForUser(client.runId, client.userId, client.lastEventId);
  if (!events) {
    client.response.end();
    return;
  }

  for (const event of events) {
    const eventId = Number(event.id);
    writeEvent(client.response, "run_event", event, eventId);
    client.lastEventId = eventId;
  }
}

function addClient(client: SseClient): void {
  const clients = clientsByRunId.get(client.runId) ?? new Map<string, SseClient>();
  clients.set(client.id, client);
  clientsByRunId.set(client.runId, clients);
}

function removeClient(client: SseClient): void {
  const clients = clientsByRunId.get(client.runId);
  clients?.delete(client.id);
  if (clients?.size === 0) clientsByRunId.delete(client.runId);
}

function writeEvent(response: Response, eventName: string, data: unknown, id?: number): void {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function runIdFromNotification(payload: string | undefined): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { run_id?: unknown };
    return typeof parsed.run_id === "string" ? parsed.run_id : null;
  } catch {
    return null;
  }
}

function scheduleReconnect(): void {
  if (listenClient) {
    listenClient.release();
    listenClient = null;
  }
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startRunEventsListener();
  }, 1_000);
}
