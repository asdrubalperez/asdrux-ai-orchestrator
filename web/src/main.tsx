import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, Clock3, Loader2, Radio, Search } from "lucide-react";
import "./styles.css";

type TimelineStatus =
  | "pendiente"
  | "iniciado"
  | "en_curso"
  | "completado"
  | "escalado"
  | "fallido"
  | "esperando_respuesta"
  | "respondido";

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
    id: string;
    label: string;
    status: TimelineStatus;
    summary: string | null;
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
  };
}

const queryClient = new QueryClient();

function App() {
  const [runId, setRunId] = React.useState(() => new URLSearchParams(window.location.search).get("run") ?? "");
  const [activeRunId, setActiveRunId] = React.useState(runId);

  return (
    <QueryClientProvider client={queryClient}>
      <RunDashboard runId={activeRunId} draftRunId={runId} onDraftChange={setRunId} onOpenRun={setActiveRunId} />
    </QueryClientProvider>
  );
}

function RunDashboard(props: {
  runId: string;
  draftRunId: string;
  onDraftChange: (value: string) => void;
  onOpenRun: (value: string) => void;
}) {
  const query = useRunQuery(props.runId);
  useRunStream(props.runId, query.refresh);

  const run = query.data;
  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">FEATURE-013A</p>
            <h1 className="text-2xl font-semibold tracking-normal">Run en curso</h1>
          </div>
          <form
            className="flex w-full gap-2 lg:w-[34rem]"
            onSubmit={(event) => {
              event.preventDefault();
              props.onOpenRun(props.draftRunId.trim());
              const url = new URL(window.location.href);
              url.searchParams.set("run", props.draftRunId.trim());
              window.history.replaceState(null, "", url);
            }}
          >
            <input
              className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-zinc-900"
              placeholder="Run ID"
              value={props.draftRunId}
              onChange={(event) => props.onDraftChange(event.target.value)}
            />
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800">
              <Search className="h-4 w-4" />
              Abrir
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[1fr_22rem] lg:px-8">
        <section className="space-y-4">
          {!props.runId ? <EmptyState /> : null}
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState /> : null}
          {run ? (
            <>
              <RunSummary run={run} />
              {run.escalation.isEscalated ? <EscalationBanner run={run} /> : null}
              <Timeline nodes={run.timeline} />
              <Narrative entries={run.narrative} />
            </>
          ) : null}
        </section>

        <aside className="space-y-4">
          <ConnectionPanel runId={props.runId} />
          {run ? <MetadataPanel run={run} /> : null}
        </aside>
      </div>
    </main>
  );
}

function useRunQuery(runId: string) {
  const query = useQuery({
    queryKey: ["run", runId],
    enabled: runId.length > 0,
    queryFn: async () => {
      const response = await fetch(`/runs/${encodeURIComponent(runId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as RunViewModel;
    },
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["run", runId] });
  }, [runId]);

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh,
  };
}

function useRunStream(runId: string, refresh: () => void) {
  React.useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/runs/${encodeURIComponent(runId)}/stream`);
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

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
      <Radio className="mx-auto mb-3 h-8 w-8 text-zinc-400" />
      <p className="text-sm text-zinc-600">Ingresá un Run ID para observar su estado en vivo.</p>
    </div>
  );
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
      No se pudo cargar el run con el usuario configurado para 013A.
    </div>
  );
}

function RunSummary({ run }: { run: RunViewModel }) {
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric label="Estado" value={run.run.status} />
      <Metric label="Fase actual" value={run.run.current_phase ?? "sin fase"} />
      <Metric label="Eventos" value={String(run.narrative.length)} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold">{value}</p>
    </div>
  );
}

function EscalationBanner({ run }: { run: RunViewModel }) {
  return (
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold">Escalamiento abierto</h2>
          <p className="mt-1 text-sm">
            {run.escalation.agentRole ?? "Un agente"} requiere intervención humana.
            {run.escalation.reason ? ` ${run.escalation.reason}` : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function Timeline({ nodes }: { nodes: RunViewModel["timeline"] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Timeline</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {nodes.map((node) => (
          <div key={node.id} className="min-h-32 rounded-md border border-zinc-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{node.label}</p>
              <StatusIcon status={node.status} />
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">{statusLabel(node.status)}</p>
            {node.summary ? <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{node.summary}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Narrative({ entries }: { entries: RunViewModel["narrative"] }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Bitácora narrativa</h2>
      <div className="mt-4 space-y-3">
        {entries.map((entry) => (
          <article key={entry.id} className="border-l-2 border-zinc-200 pl-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm font-medium">{entry.text}</p>
              <span className="text-xs text-zinc-500">{entry.eventType}</span>
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
      <h2 className="text-sm font-semibold">Conexión</h2>
      <div className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
        <Radio className="h-4 w-4 text-emerald-600" />
        {runId ? "SSE activo para el run seleccionado" : "Sin run seleccionado"}
      </div>
    </section>
  );
}

function MetadataPanel({ run }: { run: RunViewModel }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold">Metadata</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <MetadataItem label="Run ID" value={run.run.id} />
        <MetadataItem label="Branch" value={run.run.branch_name ?? "sin branch"} />
        <MetadataItem label="Creado" value={new Date(run.run.created_at).toLocaleString()} />
        <MetadataItem label="Actualizado" value={new Date(run.run.updated_at).toLocaleString()} />
      </dl>
    </section>
  );
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

function statusLabel(status: TimelineStatus) {
  return status.replaceAll("_", " ");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
