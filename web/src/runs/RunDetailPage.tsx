import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  Code,
  Compass,
  Copy,
  Download,
  FileText,
  Loader2,
  Radio,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { apiUrl } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { statusLabel as runStatusLabel, statusVariant as runStatusVariant } from "../intake/statusDisplay";
import { ReleasePlanPanel, type ReleaseRoadmapView } from "../ReleasePlanPanel";

type TimelineStatus =
  | "pendiente"
  | "iniciado"
  | "en_curso"
  | "completado"
  | "escalado"
  | "fallido"
  | "esperando_respuesta"
  | "respondido";

type TimelineNodeId = "user" | "architect" | "functional" | "planning" | "developer" | "qa";

interface RunViewModel {
  run: {
    id: string;
    current_phase: string | null;
    status: string;
    branch_name: string | null;
    created_at: string;
    updated_at: string;
  };
  timeline: Array<{
    id: TimelineNodeId;
    label: string;
    status: TimelineStatus;
    summary: string | null;
    /** FEATURE-025-Parte-1: asistente/modelo/authMode reales que corrieron esta fase. */
    executorMetadata: { provider: string; model: string | null; authMode: "api_key" | "cli_session" | null } | null;
  }>;
  narrative: Array<{
    id: string;
    createdAt: string;
    eventType: string;
    text: string;
  }>;
  escalation: {
    isEscalated: boolean;
    agentRole: string | null;
    reason: string | null;
    outputArtifact: unknown;
    motive: "repeated" | "exhausted" | "user_cancel_requested" | null;
  };
  releaseRoadmap: ReleaseRoadmapView | null;
  featureDocument: {
    featureId: string;
    featureCode: string;
    name: string;
    publicationState: "not_materialized" | "materialized" | "committed" | "pushed";
    path: string;
    commitSha: string | null;
    canonicalArtifactId: string;
    approvalMode: "manual" | "auto";
    humanMergeAuthorization: "pending" | "not_required" | "approved" | "rejected";
    markdown: string | null;
    complete: boolean;
    reason: "CONTENT_TOO_LARGE" | null;
  } | null;
  /** FEATURE-033: documento canónico del Project Brief del proyecto, si Architect ya lo produjo. */
  projectBriefDocument: {
    projectId: string;
    templateKey: string;
    templateVersion: string;
    path: string;
    canonicalArtifactId: string;
    materialized: boolean;
    markdown: string | null;
    complete: boolean;
    reason: "CONTENT_TOO_LARGE" | null;
  } | null;
}

/** FEATURE-033: helper puro y reusable — dispara la descarga del Markdown canónico en el navegador. */
function downloadMarkdown(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function RunDetailPage() {
  const params = useParams<{ projectId: string; caseId: string }>();
  const runId = params.caseId ?? "";
  const query = useRunQuery(runId);
  useRunStream(runId, query.refresh);

  const run = query.data;

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
      {query.isLoading ? <LoadingState /> : null}
      {query.isError ? <ErrorState /> : null}
      {run ? (
        <>
          <RunOverview run={run} runId={runId} />
          <ProjectBriefPanel document={run.projectBriefDocument} />
          <FeatureDocumentPanel document={run.featureDocument} />
          {run.escalation.isEscalated ? (
            <EscalationActionBanner run={run} projectId={params.projectId ?? ""} onRefresh={query.refresh} />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-4">
              <Timeline nodes={run.timeline} />
              <Narrative entries={run.narrative} />
            </div>
            <ReleasePlanPanel releaseRoadmap={run.releaseRoadmap} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function useRunQuery(runId: string) {
  const query = useQuery({
    queryKey: ["run", runId],
    enabled: runId.length > 0,
    queryFn: async () => {
      const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}`), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as RunViewModel;
    },
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["run", runId] });
  }, [runId]);

  return { data: query.data ?? null, isLoading: query.isLoading, isError: query.isError, refresh };
}

function useRunStream(runId: string, refresh: () => void) {
  React.useEffect(() => {
    if (!runId) return;
    const source = new EventSource(apiUrl(`/runs/${encodeURIComponent(runId)}/stream`), { withCredentials: true });
    source.addEventListener("snapshot", refresh);
    source.addEventListener("run_event", refresh);
    source.onerror = () => {
      refresh();
    };
    return () => {
      source.close();
    };
  }, [runId, refresh]);
}

function LoadingState() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
      <Loader2 className="h-4 w-4 animate-spin" />
      Cargando run...
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
      No se pudo cargar este run.
    </div>
  );
}

function RunOverview({ run, runId }: { run: RunViewModel; runId: string }) {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <StatusMetric label="Estado" status={run.run.status} />
      <Metric label="Fase actual" value={run.run.current_phase ?? "sin fase"} />
      <Metric label="Eventos" value={String(run.narrative.length)} />
      <ConnectionPanel runId={runId} />
      <MetadataPanel run={run} />
    </section>
  );
}

function FeatureDocumentPanel({ document }: { document: RunViewModel["featureDocument"] }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!document || document.publicationState !== "pushed") return;
    const key = `feature-document-seen:${document.featureId}:${document.commitSha ?? "pending"}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "true");
    setOpen(true);
  }, [document]);

  if (!document) return null;
  const copy = async () => {
    if (document.markdown) await navigator.clipboard.writeText(document.markdown);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-zinc-500" />
          <div>
            <h2 className="text-sm font-semibold">
              {document.featureCode} — {document.name}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {document.publicationState} · {document.path}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Ver documento de Feature
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{document.featureCode} — Documento canónico</DialogTitle>
            <DialogDescription>
              Estado: {document.publicationState}. Approval mode: {document.approvalMode}.
            </DialogDescription>
          </DialogHeader>
          {document.markdown ? (
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-800">
              {document.markdown}
            </pre>
          ) : (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              El documento supera 64 KiB. El contenido completo no está disponible en esta versión.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void copy()} disabled={!document.markdown}>
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
            <Button onClick={() => setOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * FEATURE-033: mismo lenguaje visual que `FeatureDocumentPanel` (card + Dialog + Copiar), sin
 * tocar ese componente ya validado — panel dedicado, no una generalización forzada en este pase.
 * Agrega "Descargar", ausente hoy en el panel de Feature.
 */
function ProjectBriefPanel({ document }: { document: RunViewModel["projectBriefDocument"] }) {
  const [open, setOpen] = React.useState(false);

  if (!document) return null;
  const copy = async () => {
    if (document.markdown) await navigator.clipboard.writeText(document.markdown);
  };
  const download = () => {
    if (document.markdown) downloadMarkdown("PROJECT-BRIEF.md", document.markdown);
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-zinc-500" />
          <div>
            <h2 className="text-sm font-semibold">Project Brief</h2>
            <p className="mt-1 text-xs text-zinc-500">
              {document.materialized ? "materializado" : "no materializado"} · {document.path}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Ver documento
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Project Brief — Documento canónico</DialogTitle>
            <DialogDescription>Template: {document.templateKey}@{document.templateVersion}.</DialogDescription>
          </DialogHeader>
          {document.markdown ? (
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-800">
              {document.markdown}
            </pre>
          ) : (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              El documento supera 64 KiB. El contenido completo no está disponible en esta versión.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void copy()} disabled={!document.markdown}>
              <Copy className="h-4 w-4" />
              Copiar
            </Button>
            <Button variant="outline" onClick={download} disabled={!document.markdown}>
              <Download className="h-4 w-4" />
              Descargar .md
            </Button>
            <Button onClick={() => setOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>{label}</CardLabel>
      <p className="mt-3 text-sm text-zinc-600">{value}</p>
    </div>
  );
}

function StatusMetric({ label, status }: { label: string; status: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>{label}</CardLabel>
      <div className="mt-3">
        <Badge variant={runStatusVariant(status)}>{runStatusLabel(status)}</Badge>
      </div>
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold">{children}</h2>;
}

function EscalationActionBanner({
  run,
  projectId,
  onRefresh,
}: {
  run: RunViewModel;
  projectId: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold">Escalamiento abierto</h2>
            <p className="mt-1 text-sm">
              {escalationMotiveText(run.escalation.motive, run.escalation.agentRole)}
              {run.escalation.reason ? ` ${run.escalation.reason}` : ""}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Validar Ahora
        </Button>
      </div>
      <EscalationResponseDialog run={run} projectId={projectId} open={open} onOpenChange={setOpen} onRefresh={onRefresh} />
    </section>
  );
}

function EscalationResponseDialog({
  run,
  projectId,
  open,
  onOpenChange,
  onRefresh,
}: {
  run: RunViewModel;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = React.useState<"choice" | "solution">("choice");
  const [solution, setSolution] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setMode("choice");
      setSolution("");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const submit = async (body: { abort: true } | { solution: string }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/runs/${encodeURIComponent(run.run.id)}/respond`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.status === 409) throw new Error("Este escalamiento ya fue respondido.");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = (await response.json().catch(() => null)) as { childRunId?: string } | null;
      onOpenChange(false);

      // El humano respondió y el pipeline sigue en un run nuevo (encadenado) -- lo natural es
      // seguir viéndolo ahí, no quedarse mirando el run padre ya resuelto/abortado.
      if (result?.childRunId && projectId) {
        navigate(`/projects/${encodeURIComponent(projectId)}/cases/${encodeURIComponent(result.childRunId)}`);
        return;
      }

      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo responder el escalamiento.");
    } finally {
      setLoading(false);
    }
  };

  const canSubmitSolution = solution.trim().length > 0 && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle>Validar Ahora</DialogTitle>
          <DialogDescription>{escalationMotiveText(run.escalation.motive, run.escalation.agentRole)}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain pr-1 text-sm">
          {run.escalation.reason ? (
            <div className="min-w-0">
              <p className="font-medium">Motivo del agente</p>
              <p className="mt-1 break-words text-zinc-600">{run.escalation.reason}</p>
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="font-medium">Artifact rechazado</p>
            <pre className="mt-1 max-h-56 max-w-full min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
              {formatArtifact(run.escalation.outputArtifact)}
            </pre>
          </div>
          <p className="font-medium">¿Deseas que el agente continúe con indicaciones tuyas?</p>
          {mode === "solution" ? (
            <textarea
              className="min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition-colors placeholder:text-zinc-500 focus:border-zinc-900"
              placeholder="Indicación para continuar..."
              value={solution}
              onChange={(event) => setSolution(event.target.value)}
            />
          ) : null}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter className="min-w-0">
          {mode === "choice" ? (
            <>
              <Button variant="outline" disabled={loading} onClick={() => void submit({ abort: true })}>
                No
              </Button>
              <Button disabled={loading} onClick={() => setMode("solution")}>
                Sí
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={loading} onClick={() => setMode("choice")}>
                Volver
              </Button>
              <Button disabled={!canSubmitSolution} onClick={() => void submit({ solution })}>
                Continuar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function escalationMotiveText(motive: RunViewModel["escalation"]["motive"], agentRole: string | null) {
  if (motive === "repeated") return "Se repitió el mismo resultado — se necesita tu validación.";
  if (motive === "exhausted") return "Se agotaron los 3 reintentos internos — se necesita tu validación.";
  if (motive === "user_cancel_requested") return "Cancelaste este run — se está deteniendo en el próximo punto de corte.";
  return `${agentRole ?? "Un agente"} requiere intervención humana.`;
}

function formatArtifact(value: unknown) {
  if (value === null || value === undefined) return "Sin artifact rechazado disponible.";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function Timeline({ nodes }: { nodes: RunViewModel["timeline"] }) {
  return (
    <section data-testid="timeline" className="rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>Pipeline</CardLabel>
      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {nodes.map((node) => (
          <div key={node.id} className="min-h-32 rounded-md border border-zinc-200 p-3">
            <div className="flex flex-col items-center gap-2 text-center">
              <RoleAvatar nodeId={node.id} status={node.status} />
              <p className="text-sm font-medium">{node.label}</p>
              <Badge variant={statusVariant(node.status)}>{statusLabel(node.status)}</Badge>
            </div>
            {node.executorMetadata ? (
              <p
                className="mt-2 line-clamp-2 break-words text-center text-xs text-zinc-500"
                title={executorMetadataLabel(node.executorMetadata)}
              >
                {executorMetadataLabel(node.executorMetadata)}
              </p>
            ) : null}
            {node.summary ? <p className="mt-3 line-clamp-3 text-sm text-zinc-600">{node.summary}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// FEATURE-025-Parte-1: el owner pidió poder confirmar, antes de correr un caso real, qué
// asistente/modelo/modo de autenticación se usó efectivamente en cada fase -- el dato ya se
// persistía por fase (PhaseResult.executorMetadata, FEATURE-017) pero ninguna pantalla lo mostraba.
function executorMetadataLabel(metadata: NonNullable<RunViewModel["timeline"][number]["executorMetadata"]>): string {
  const parts = [metadata.provider, metadata.model, metadata.authMode === "cli_session" ? "OAuth" : "API key"];
  return parts.filter(Boolean).join(" · ");
}

function RoleAvatar({ nodeId, status }: { nodeId: TimelineNodeId; status: TimelineStatus }) {
  const Icon = roleIcon(nodeId);
  return (
    <div
      data-role-avatar={nodeId}
      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-700"
    >
      <Icon className="h-6 w-6" />
      <div className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full border border-white bg-white shadow-sm [&_svg]:h-4 [&_svg]:w-4">
        <StatusIcon status={status} />
      </div>
    </div>
  );
}

function roleIcon(nodeId: TimelineNodeId) {
  switch (nodeId) {
    case "user":
      return User;
    case "architect":
      return Compass;
    case "functional":
      return Settings;
    case "planning":
      return Calendar;
    case "developer":
      return Code;
    case "qa":
      return ShieldCheck;
  }
}

function Narrative({ entries }: { entries: RunViewModel["narrative"] }) {
  const orderedEntries = [...entries].reverse();

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>Bitácora narrativa</CardLabel>
      <div className="mt-4 space-y-3">
        {orderedEntries.map((entry) => (
          <article key={entry.id} className="border-l-2 border-zinc-200 pl-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-medium">{entry.text}</p>
              <Badge variant="outline">{entry.eventType}</Badge>
            </div>
            <time className="text-xs text-zinc-500">{new Date(entry.createdAt).toLocaleString()}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

function ConnectionPanel({ runId }: { runId: string }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>Conexión</CardLabel>
      <div className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
        <Radio className="h-4 w-4 text-emerald-600" />
        {runId ? "SSE activo" : "Sin run seleccionado"}
      </div>
    </section>
  );
}

function MetadataPanel({ run }: { run: RunViewModel }) {
  return (
    <section className="col-span-2 rounded-lg border border-zinc-200 bg-white p-4 md:col-span-4 xl:col-span-4">
      <CardLabel>Datos de la Ejecución</CardLabel>
      <dl className="mt-3 grid grid-cols-4 gap-x-4 gap-y-3 text-sm">
        <CopyableMetadataItem label="Run ID" value={run.run.id} />
        <CopyableMetadataItem label="Branch" value={run.run.branch_name ?? "sin branch"} />
        <MetadataItem label="Creado" value={new Date(run.run.created_at).toLocaleString()} />
        <MetadataItem label="Actualizado" value={new Date(run.run.updated_at).toLocaleString()} />
      </dl>
    </section>
  );
}

function CopyableMetadataItem({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const displayValue = truncateIdentifier(value);

  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2">
        <span className="min-w-0 font-mono text-sm text-zinc-800" title={value}>{displayValue}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-zinc-500 hover:text-zinc-950"
          aria-label={`Copiar ${label}`}
          title={`Copiar ${value}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </dd>
    </div>
  );
}

function truncateIdentifier(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...`;
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-zinc-800">{value}</dd>
    </div>
  );
}

function StatusIcon({ status }: { status: TimelineStatus }) {
  const className = `h-5 w-5 ${statusColor(status)}`;
  if (status === "completado" || status === "iniciado" || status === "respondido") return <CheckCircle2 className={className} />;
  if (status === "en_curso") return <Clock3 className={className} />;
  if (status === "escalado" || status === "esperando_respuesta" || status === "fallido") {
    return <AlertTriangle className={className} />;
  }
  return <Circle className={className} />;
}

function statusColor(status: TimelineStatus) {
  if (status === "completado" || status === "iniciado" || status === "respondido") return "text-emerald-600";
  if (status === "en_curso") return "text-sky-600";
  if (status === "escalado" || status === "esperando_respuesta") return "text-amber-600";
  if (status === "fallido") return "text-rose-600";
  return "text-zinc-400";
}

function statusVariant(status: TimelineStatus): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "completado" || status === "iniciado" || status === "respondido") return "success";
  if (status === "en_curso") return "secondary";
  if (status === "escalado" || status === "esperando_respuesta") return "warning";
  if (status === "fallido") return "destructive";
  return "outline";
}

function statusLabel(status: TimelineStatus) {
  return status.replaceAll("_", " ");
}
