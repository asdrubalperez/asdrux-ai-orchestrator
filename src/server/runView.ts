import type { RunRow } from "../db/repository.js";

export type TimelineNodeId = "user" | "architect" | "functional" | "planning" | "developer" | "qa";
export type TimelineNodeStatus =
  | "pendiente"
  | "iniciado"
  | "en_curso"
  | "completado"
  | "escalado"
  | "fallido"
  | "esperando_respuesta"
  | "respondido";

export interface RunEventRow {
  id: string | number;
  event_type: string;
  payload: unknown;
  created_at: string;
}

export interface ArtifactViewRow {
  id: string;
  phase: string;
  kind: string;
  content: unknown;
  created_at: string;
}

export interface RunDetailViewInput {
  run: RunRow;
  events: RunEventRow[];
  artifacts: ArtifactViewRow[];
}

export interface TimelineNode {
  id: TimelineNodeId;
  label: string;
  status: TimelineNodeStatus;
  summary: string | null;
}

export interface NarrativeEntry {
  id: string;
  createdAt: string;
  eventType: string;
  text: string;
}

export interface RunViewModel {
  run: RunRow;
  timeline: TimelineNode[];
  narrative: NarrativeEntry[];
  escalation: {
    isEscalated: boolean;
    agentRole: string | null;
    reason: string | null;
  };
}

const AGENT_NODES: Array<{ id: Exclude<TimelineNodeId, "user">; label: string }> = [
  { id: "architect", label: "Architect" },
  { id: "functional", label: "Functional" },
  { id: "planning", label: "Planning" },
  { id: "developer", label: "Developer" },
  { id: "qa", label: "QA" },
];
const TIMELINE_NODE_ORDER: TimelineNodeId[] = ["user", "architect", "functional", "planning", "developer", "qa"];

export function buildRunViewModel(detail: RunDetailViewInput): RunViewModel {
  const timeline = buildTimeline(detail.run, detail.events);
  return {
    run: detail.run,
    timeline,
    narrative: buildNarrative(detail.events),
    escalation: buildEscalationBanner(detail.run, detail.events, detail.artifacts),
  };
}

export function buildTimeline(run: RunRow, events: RunEventRow[]): TimelineNode[] {
  const nodes = new Map<TimelineNodeId, TimelineNode>();
  nodes.set("user", {
    id: "user",
    label: "User",
    status: events.some((event) => event.event_type === "run_started") ? "iniciado" : "pendiente",
    summary: null,
  });

  for (const agent of AGENT_NODES) {
    nodes.set(agent.id, { id: agent.id, label: agent.label, status: "pendiente", summary: null });
  }

  for (const event of events) {
    if (event.event_type === "phase_started") {
      const agentRole = agentRoleFromPayload(event.payload);
      const node = agentRole ? nodes.get(agentRole as TimelineNodeId) : undefined;
      if (node) {
        node.status = "en_curso";
        node.summary = null;
      }
    }

    if (event.event_type === "phase_finished") {
      const payload = phaseFinishedPayload(event.payload);
      if (!payload) continue;
      const node = nodes.get(payload.agentRole as TimelineNodeId);
      if (node) {
        node.status = statusForPhaseResult(payload.status);
        node.summary = payload.summary;
      }
    }

    if (event.event_type === "escalation_human_response" || event.event_type === "escalation_aborted") {
      const user = nodes.get("user");
      if (user) user.status = "respondido";
    }
  }

  const user = nodes.get("user");
  if (user && run.status === "escalated" && user.status !== "respondido") {
    user.status = "esperando_respuesta";
  }

  const latestEscalatedRole = latestEscalatedAgentRole(events);
  if (run.status === "escalated" && latestEscalatedRole) {
    const node = nodes.get(latestEscalatedRole as TimelineNodeId);
    if (node) node.status = "escalado";
  }

  return TIMELINE_NODE_ORDER.map((id) => nodes.get(id) as TimelineNode);
}

export function buildNarrative(events: RunEventRow[]): NarrativeEntry[] {
  return events.map((event) => ({
    id: String(event.id),
    createdAt: event.created_at,
    eventType: event.event_type,
    text: narrativeText(event),
  }));
}

function buildEscalationBanner(run: RunRow, events: RunEventRow[], artifacts: ArtifactViewRow[]) {
  if (run.status !== "escalated") {
    return { isEscalated: false, agentRole: null, reason: null };
  }

  const agentRole = latestEscalatedAgentRole(events);
  const artifact = [...artifacts].reverse().find((item) => item.kind === "escalation");
  return {
    isEscalated: true,
    agentRole,
    reason: escalationReasonFromArtifact(artifact?.content) ?? latestEscalationReasonFromEvents(events),
  };
}

function narrativeText(event: RunEventRow): string {
  const payload = event.payload;
  switch (event.event_type) {
    case "run_started":
      return "Run iniciado.";
    case "phase_started": {
      const agentRole = agentRoleFromPayload(payload);
      return agentRole ? `${agentRole} comenzó su fase.` : "Una fase comenzó.";
    }
    case "phase_finished": {
      const result = phaseFinishedPayload(payload);
      if (result?.summary) return result.summary;
      return "Una fase terminó.";
    }
    case "escalation_opened": {
      const agentRole = agentRoleFromPayload(payload);
      return agentRole ? `${agentRole} abrió un escalamiento.` : "Se abrió un escalamiento.";
    }
    case "escalation_repeated_detected":
      return "Se detectó que el mismo hallazgo volvió a presentarse.";
    case "escalation_exhausted":
      return "Se agotó el circuito de escalamiento automático.";
    case "escalation_retry_context_prepared":
      return "Se preparó el contexto acumulado para reintentar el circuito.";
    case "escalation_human_response":
      return "El humano respondió el escalamiento.";
    case "escalation_aborted":
      return "El humano abortó el escalamiento.";
    case "run_error":
      return runErrorMessage(payload);
    case "test_executed":
      return "Se ejecutó el comando de test declarado por Planning.";
    case "loop_exhausted":
      return "Se agotó el loop Developer/QA.";
    case "run_committed":
      return "Los cambios aprobados fueron commiteados.";
    case "run_pushed":
      return "La rama del run fue publicada.";
    case "worktree_cleaned":
      return "El worktree del run fue limpiado.";
    default:
      return `Evento registrado: ${event.event_type}.`;
  }
}

function statusForPhaseResult(status: string): TimelineNodeStatus {
  if (status === "completed") return "completado";
  if (status === "escalated") return "escalado";
  if (status === "failed" || status === "rejected") return "fallido";
  return "fallido";
}

function phaseFinishedPayload(payload: unknown): { agentRole: string; status: string; summary: string | null } | null {
  if (!isRecord(payload) || typeof payload.agentRole !== "string" || !isRecord(payload.result)) return null;
  const status = typeof payload.result.status === "string" ? payload.result.status : null;
  if (!status) return null;
  return {
    agentRole: payload.agentRole,
    status,
    summary: typeof payload.result.summary === "string" ? payload.result.summary : null,
  };
}

function agentRoleFromPayload(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.agentRole === "string" ? payload.agentRole : null;
}

function latestEscalatedAgentRole(events: RunEventRow[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.event_type === "phase_finished") {
      const result = phaseFinishedPayload(event.payload);
      if (result?.status === "escalated") return result.agentRole;
    }
  }
  return null;
}

function escalationReasonFromArtifact(content: unknown): string | null {
  return isRecord(content) && typeof content.escalationReason === "string" ? content.escalationReason : null;
}

function latestEscalationReasonFromEvents(events: RunEventRow[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const eventPayload = events[i].payload;
    const result = phaseFinishedPayload(eventPayload);
    const rawResult = isRecord(eventPayload) && isRecord(eventPayload.result) ? eventPayload.result : null;
    if (result?.status === "escalated" && rawResult && typeof rawResult.escalationReason === "string") {
      return rawResult.escalationReason;
    }
  }
  return null;
}

function runErrorMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.message === "string") return `Error del run: ${payload.message}`;
  return "El run registró un error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
