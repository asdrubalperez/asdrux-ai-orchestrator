import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import {
  getChildRunId,
  getCurrentProjectConfig,
  getReleasePlansByRelease,
  getRunDetailForUser,
  getRunEventsAfterForUser,
} from "../db/repository.js";
import { buildRunViewModel, toReleaseRoadmapView } from "./runView.js";
import { getFeatureDocumentForRun } from "../features/lifecycle.js";

/** FEATURE-018: mismo criterio que resolveReleaseRoadmap en app.ts (no importado desde acá para no
 * crear un import circular app.ts <-> sse.ts). */
async function resolveReleaseRoadmap(projectId: string | null) {
  if (!projectId) return null;
  const [config, releasePlans] = await Promise.all([
    getCurrentProjectConfig(projectId, "release_roadmap"),
    getReleasePlansByRelease(projectId),
  ]);
  return toReleaseRoadmapView(config?.value ?? null, releasePlans);
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

  const [roadmap, featureDocument, childRunId] = await Promise.all([
    resolveReleaseRoadmap(detail.run.project_id),
    getFeatureDocumentForRun(params.runId),
    getChildRunId(params.runId),
  ]);
  writeEvent(
    params.response,
    "snapshot",
    buildRunViewModel(detail, roadmap, featureDocument, null, null, null, childRunId)
  );
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

/**
 * Fix (2026-08-17), hallazgo en vivo: cada NOTIFY de Postgres disparaba `handleNotification` de
 * forma independiente (`void`, sin awaitear ni serializar) -- cuando un escalamiento se abre,
 * llegan al menos dos notificaciones casi seguidas (el insert de `run_events` con `runs.status`
 * todavía viejo, y el update de `runs.status` poco después), y como ambos handlers corrían
 * concurrentemente, no había garantía de que la query de la notificación más reciente terminara de
 * escribir al stream DESPUÉS que la más vieja -- el usuario reportó tener que salir y reentrar a la
 * vista de un caso para ver un escalamiento que el servidor ya sabía que existía. Esta cola
 * coalescente por `runId` garantiza que, para un mismo run, nunca corran dos consultas/escrituras
 * de snapshot en paralelo, y que la última notificación que llega mientras una ya está en curso
 * dispare una repetición final tras esa consulta -- así el último snapshot que ven los clientes
 * siempre refleja el estado más reciente en DB, sin importar el orden de llegada de las notify.
 */
const notificationQueueByRunId = new Map<string, { processing: boolean; pending: boolean }>();

async function handleNotification(payload: string | undefined): Promise<void> {
  const runId = runIdFromNotification(payload);
  if (!runId) return;
  await scheduleRunRefresh(runId);
}

async function scheduleRunRefresh(runId: string): Promise<void> {
  let state = notificationQueueByRunId.get(runId);
  if (!state) {
    state = { processing: false, pending: false };
    notificationQueueByRunId.set(runId, state);
  }
  if (state.processing) {
    state.pending = true;
    return;
  }
  state.processing = true;
  try {
    do {
      state.pending = false;
      await pushRunSnapshotToClients(runId);
    } while (state.pending);
  } finally {
    state.processing = false;
    if (!state.pending) notificationQueueByRunId.delete(runId);
  }
}

async function pushRunSnapshotToClients(runId: string): Promise<void> {
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
      const [roadmap, featureDocument, childRunId] = await Promise.all([
        resolveReleaseRoadmap(detail.run.project_id),
        getFeatureDocumentForRun(client.runId),
        getChildRunId(client.runId),
      ]);
      writeEvent(
        client.response,
        "snapshot",
        buildRunViewModel(detail, roadmap, featureDocument, null, null, null, childRunId)
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
