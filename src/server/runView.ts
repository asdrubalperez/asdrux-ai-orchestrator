import type { RunRow } from "../db/repository.js";
import {
  isReleasePlanDeclaration,
  isRoadmapApprovalPayload,
  type ReleasePlanFeatureEntry,
} from "../cli/escalation.js";
import type { FeatureDocumentView } from "../features/lifecycle.js";
import type { ProjectBriefDocumentView } from "../features/projectBriefLifecycle.js";
import type { ArchitectureDocumentView } from "../features/architectureLifecycle.js";
import type { ReleasePlanDocumentView } from "../features/releasePlanLifecycle.js";

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

export interface ReleaseRoadmapView {
  releases: Array<{
    id: string;
    nombre: string;
    alcanceResumen: string;
    estado: "Activo" | "Pendiente" | "Completado";
    features: ReleasePlanFeatureEntry[];
  }>;
  /** FEATURE-036: `null` cuando el proyecto está cerrado y no hay ningún release activo. */
  activeReleaseId: string | null;
}

export interface ReleasePlanConfigViewInput {
  release_id: string;
  value: unknown;
}

/** Valida roadmap y planes versionados antes de exponerlos al frontend. */
export function toReleaseRoadmapView(
  value: unknown,
  releasePlans: ReleasePlanConfigViewInput[] = []
): ReleaseRoadmapView | null {
  if (!isRoadmapApprovalPayload(value)) return null;

  const featuresByRelease = new Map<string, ReleasePlanFeatureEntry[]>();
  for (const plan of releasePlans) {
    if (!isRecord(plan.value)) continue;
    const declaration = {
      features: plan.value.features,
      featureActualId: plan.value.featureActualId,
    };
    if (typeof plan.value.ramaBaseTrabajo === "string" && isReleasePlanDeclaration(declaration)) {
      featuresByRelease.set(plan.release_id, declaration.features);
    }
  }

  return {
    activeReleaseId: value.activeReleaseId,
    releases: value.releases.map((release) => ({
      ...release,
      features: featuresByRelease.get(release.id) ?? [],
    })),
  };
}

export interface TimelineNode {
  id: TimelineNodeId;
  label: string;
  status: TimelineNodeStatus;
  summary: string | null;
  /** FEATURE-025-Parte-1: asistente/modelo/authMode reales de esta fase, null hasta que termine. */
  executorMetadata: TimelineExecutorMetadata | null;
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
    outputArtifact: unknown;
    motive: "repeated" | "exhausted" | "user_cancel_requested" | null;
  };
  /**
   * FEATURE-018: roadmap vigente del proyecto (project_config_versions, config_key =
   * "release_roadmap"), null si el proyecto no tiene ninguno aprobado todavía. Se recibe ya
   * resuelto en vez de consultarse acá adentro — buildRunViewModel se mantiene puro y síncrono
   * (mismo criterio que su test suite actual, sobre objetos literales sin DB).
   */
  releaseRoadmap: ReleaseRoadmapView | null;
  featureDocument: FeatureDocumentView | null;
  /** FEATURE-033: null hasta que Architect complete el Project Brief canónico del proyecto. */
  projectBriefDocument: ProjectBriefDocumentView | null;
  /** FEATURE-034: null hasta que Architect complete la Architecture canónica del proyecto. */
  architectureDocument: ArchitectureDocumentView | null;
  /** FEATURE-035: null hasta que Planning complete el Release Plan canónico del release activo. */
  releasePlanDocument: ReleasePlanDocumentView | null;
}

const AGENT_NODES: Array<{ id: Exclude<TimelineNodeId, "user">; label: string }> = [
  { id: "architect", label: "Architect" },
  { id: "functional", label: "Functional" },
  { id: "planning", label: "Planning" },
  { id: "developer", label: "Developer" },
  { id: "qa", label: "QA" },
];
const TIMELINE_NODE_ORDER: TimelineNodeId[] = ["user", "architect", "functional", "planning", "developer", "qa"];

export function buildRunViewModel(
  detail: RunDetailViewInput,
  releaseRoadmap: ReleaseRoadmapView | null = null,
  featureDocument: FeatureDocumentView | null = null,
  projectBriefDocument: ProjectBriefDocumentView | null = null,
  architectureDocument: ArchitectureDocumentView | null = null,
  releasePlanDocument: ReleasePlanDocumentView | null = null
): RunViewModel {
  const timeline = buildTimeline(detail.run, detail.events);
  return {
    run: detail.run,
    timeline,
    narrative: buildNarrative(detail.events),
    escalation: buildEscalationBanner(detail.run, detail.events, detail.artifacts),
    releaseRoadmap,
    featureDocument,
    projectBriefDocument,
    architectureDocument,
    releasePlanDocument,
  };
}

export function buildTimeline(run: RunRow, events: RunEventRow[]): TimelineNode[] {
  const nodes = new Map<TimelineNodeId, TimelineNode>();
  nodes.set("user", {
    id: "user",
    label: "User",
    status: events.some((event) => event.event_type === "run_started") ? "iniciado" : "pendiente",
    summary: null,
    executorMetadata: null,
  });

  for (const agent of AGENT_NODES) {
    nodes.set(agent.id, { id: agent.id, label: agent.label, status: "pendiente", summary: null, executorMetadata: null });
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
        node.executorMetadata = payload.executorMetadata;
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
    return { isEscalated: false, agentRole: null, reason: null, outputArtifact: null, motive: null };
  }

  const motive = latestTerminalEscalationMotive(events);
  // FEATURE-017: si el usuario canceló mientras una fase seguía en curso, no hay ningún
  // phase_finished con status "escalated" que latestEscalatedAgentRole pueda encontrar — el
  // agentRole activo en ese momento se registró explícitamente en el propio evento de
  // cancelación forzada (ver src/cli/intakeService.ts, cancelRun).
  const agentRole =
    motive === "user_cancel_requested"
      ? (latestForcedUserEscalationAgentRole(events) ?? latestEscalatedAgentRole(events))
      : latestEscalatedAgentRole(events);
  const artifact = [...artifacts].reverse().find((item) => item.kind === "escalation");
  return {
    isEscalated: true,
    agentRole,
    reason: escalationReasonFromArtifact(artifact?.content) ?? latestEscalationReasonFromEvents(events),
    outputArtifact: outputArtifactFromEscalationArtifact(artifact?.content),
    motive,
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
      return "El usuario respondió el escalamiento.";
    case "escalation_aborted":
      return "El usuario abortó el escalamiento.";
    case "escalation_forced_by_user":
      return "El usuario canceló el run.";
    case "run_halted_external_cancel":
      return "El pipeline se detuvo en el próximo punto de corte tras la cancelación.";
    case "intake_confirmed":
      return "Se confirmó el caso de negocio mapeado.";
    case "repo_clone_failed":
      return runRepoCloneFailedMessage(payload);
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

function phaseFinishedPayload(
  payload: unknown
): { agentRole: string; status: string; summary: string | null; executorMetadata: TimelineExecutorMetadata | null } | null {
  if (!isRecord(payload) || typeof payload.agentRole !== "string" || !isRecord(payload.result)) return null;
  const status = typeof payload.result.status === "string" ? payload.result.status : null;
  if (!status) return null;
  return {
    agentRole: payload.agentRole,
    status,
    summary: typeof payload.result.summary === "string" ? payload.result.summary : null,
    executorMetadata: executorMetadataFromResult(payload.result.executorMetadata),
  };
}

// FEATURE-025-Parte-1: cada fase ya persistía provider/model/authMode reales en su propio evento
// `phase_finished` (PhaseResult.executorMetadata, FEATURE-017), pero ningún lugar de la UI lo
// mostraba -- solo era auditable consultando run_events directamente.
export interface TimelineExecutorMetadata {
  provider: string;
  model: string | null;
  authMode: "api_key" | "cli_session" | null;
}

function executorMetadataFromResult(value: unknown): TimelineExecutorMetadata | null {
  if (!isRecord(value) || typeof value.provider !== "string") return null;
  return {
    provider: value.provider,
    model: typeof value.model === "string" ? value.model : null,
    authMode: value.authMode === "api_key" || value.authMode === "cli_session" ? value.authMode : null,
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

function outputArtifactFromEscalationArtifact(content: unknown): unknown {
  return isRecord(content) && "outputArtifact" in content ? content.outputArtifact : null;
}

function latestTerminalEscalationMotive(
  events: RunEventRow[]
): "repeated" | "exhausted" | "user_cancel_requested" | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === "escalation_repeated_detected") return "repeated";
    if (events[i].event_type === "escalation_exhausted") return "exhausted";
    if (events[i].event_type === "escalation_forced_by_user") return "user_cancel_requested";
  }
  return null;
}

function latestForcedUserEscalationAgentRole(events: RunEventRow[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.event_type === "escalation_forced_by_user") {
      return isRecord(event.payload) && typeof event.payload.agentRole === "string" ? event.payload.agentRole : null;
    }
  }
  return null;
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

function runRepoCloneFailedMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.message === "string") {
    return `Corte técnico antes de invocar al Architect: ${payload.message}`;
  }
  return "Corte técnico: no se pudo preparar el repositorio del caso.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
