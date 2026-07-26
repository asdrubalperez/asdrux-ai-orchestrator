import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  Clock3,
  Code,
  Compass,
  Copy,
  Loader2,
  LogOut,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { apiUrl } from "./lib/api";
import { queryClient } from "./lib/queryClient";
import { CasesList } from "./intake/CasesList";
import { DisparoScreen } from "./intake/DisparoScreen";
import { statusLabel as runStatusLabel, statusVariant as runStatusVariant } from "./intake/statusDisplay";
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
  releaseRoadmap: {
    releases: Array<{ id: string; nombre: string; alcanceResumen: string; estado: string }>;
    activeReleaseId: string;
  } | null;
}

interface CurrentUser {
  id: string;
  handle: string;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

type AppView = "cases" | "intake" | "run";

function AppInner() {
  const [runId, setRunId] = React.useState(() => new URLSearchParams(window.location.search).get("run") ?? "");
  const [activeRunId, setActiveRunId] = React.useState(runId);
  const [view, setView] = React.useState<AppView>(runId ? "run" : "cases");
  const auth = useCurrentUser();

  const openRun = React.useCallback((value: string) => {
    setRunId(value);
    setActiveRunId(value);
    setView("run");
    const url = new URL(window.location.href);
    url.searchParams.set("run", value);
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <>
      {auth.isLoading ? (
        <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Validando sesión...
        </main>
      ) : auth.user ? (
        <main className="min-h-screen bg-zinc-50 text-zinc-950">
          <AppNav view={view} user={auth.user} onNavigate={setView} onLogout={auth.logout} />
          {view === "cases" ? (
            <CasesList onOpenRun={openRun} onNewCase={() => setView("intake")} />
          ) : view === "intake" ? (
            <DisparoScreen onConfirmed={() => setView("cases")} />
          ) : (
            <RunDashboard
              runId={activeRunId}
              draftRunId={runId}
              user={auth.user}
              onDraftChange={setRunId}
              onOpenRun={openRun}
              onLogout={auth.logout}
              hideHeader
            />
          )}
        </main>
      ) : (
        <LoginView onLogin={auth.refresh} />
      )}
    </>
  );
}

function AppNav(props: {
  view: AppView;
  user: CurrentUser;
  onNavigate: (view: AppView) => void;
  onLogout: () => Promise<void>;
}) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Button
            variant={props.view === "cases" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => props.onNavigate("cases")}
          >
            Mis casos
          </Button>
          <Button
            variant={props.view === "intake" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => props.onNavigate("intake")}
          >
            Nuevo caso
          </Button>
        </div>
        <Button
          data-testid="logout-button"
          variant="outline"
          size="sm"
          aria-label="Salir"
          title={`Salir (${props.user.handle})`}
          onClick={() => void props.onLogout()}
        >
          <LogOut className="h-4 w-4" />
          {props.user.handle}
        </Button>
      </div>
    </header>
  );
}

function RunDashboard(props: {
  runId: string;
  draftRunId: string;
  user: CurrentUser;
  onDraftChange: (value: string) => void;
  onOpenRun: (value: string) => void;
  onLogout: () => Promise<void>;
  hideHeader?: boolean;
}) {
  const query = useRunQuery(props.runId);
  useRunStream(props.runId, query.refresh);

  const run = query.data;
  const openRun = React.useCallback(
    (value: string) => {
      props.onDraftChange(value);
      props.onOpenRun(value);
      const url = new URL(window.location.href);
      url.searchParams.set("run", value);
      window.history.replaceState(null, "", url);
    },
    [props.onDraftChange, props.onOpenRun]
  );

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      {props.hideHeader ? null : (
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">FEATURE-013A</p>
              <h1 className="text-2xl font-semibold tracking-normal">Run en curso</h1>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center">
              <form
                className="flex w-full gap-2 lg:w-[34rem]"
                onSubmit={(event) => {
                  event.preventDefault();
                  openRun(props.draftRunId.trim());
                }}
              >
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Run ID"
                  value={props.draftRunId}
                  onChange={(event) => props.onDraftChange(event.target.value)}
                />
                <Button>
                  <Search className="h-4 w-4" />
                  Abrir
                </Button>
              </form>
              <Button
                data-testid="logout-button"
                variant="outline"
                aria-label="Salir"
                title={`Salir (${props.user.handle})`}
                onClick={() => void props.onLogout()}
              >
                <LogOut className="h-4 w-4" />
                {props.user.handle}
              </Button>
            </div>
          </div>
        </header>
      )}

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <section className="space-y-4">
          {!props.runId ? <EmptyState /> : null}
          {query.isLoading ? <LoadingState /> : null}
          {query.isError ? <ErrorState /> : null}
          {run ? (
            <>
              <RunOverview run={run} runId={props.runId} />
              {run.escalation.isEscalated ? (
                <EscalationActionBanner run={run} onRefresh={query.refresh} onOpenRun={openRun} />
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
        </section>
      </div>
    </main>
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

function useCurrentUser() {
  const query = useQuery({
    queryKey: ["auth", "me"],
    retry: false,
    queryFn: async () => {
      const response = await fetch(apiUrl("/auth/me"), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { user: CurrentUser };
      return body.user;
    },
  });

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    logout: async () => {
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
      queryClient.setQueryData(["auth", "me"], null);
      queryClient.removeQueries({ queryKey: ["run"] });
    },
  };
}

function LoginView({ onLogin }: { onLogin: () => Promise<void> }) {
  const [handle, setHandle] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-950">
      <section className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5">
        <h1 className="text-xl font-semibold">Ingresar</h1>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            setError(null);
            try {
              const response = await fetch(apiUrl("/auth/login"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ handle, password }),
              });
              if (!response.ok) throw new Error("Credenciales inválidas");
              await onLogin();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Input
            placeholder="Handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button
            className="w-full"
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar
          </Button>
        </form>
      </section>
    </main>
  );
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
  onRefresh,
  onOpenRun,
}: {
  run: RunViewModel;
  onRefresh: () => void;
  onOpenRun: (runId: string) => void;
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
      <EscalationResponseDialog
        run={run}
        open={open}
        onOpenChange={setOpen}
        onRefresh={onRefresh}
        onOpenRun={onOpenRun}
      />
    </section>
  );
}

function EscalationResponseDialog({
  run,
  open,
  onOpenChange,
  onRefresh,
  onOpenRun,
}: {
  run: RunViewModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onOpenRun: (runId: string) => void;
}) {
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
      const payload = (await response.json()) as { status?: string; childRunId?: string };

      onOpenChange(false);
      if (payload.childRunId) {
        onOpenRun(payload.childRunId);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Validar Ahora</DialogTitle>
          <DialogDescription>
            {escalationMotiveText(run.escalation.motive, run.escalation.agentRole)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {run.escalation.reason ? (
            <div>
              <p className="font-medium">Motivo del agente</p>
              <p className="mt-1 text-zinc-600">{run.escalation.reason}</p>
            </div>
          ) : null}
          <div>
            <p className="font-medium">Artifact rechazado</p>
            <pre className="mt-1 max-h-56 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
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

        <DialogFooter>
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
            {node.summary ? <p className="mt-3 line-clamp-3 text-sm text-zinc-600">{node.summary}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
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

function ReleasePlanPanel({ releaseRoadmap }: { releaseRoadmap: RunViewModel["releaseRoadmap"] }) {
  if (!releaseRoadmap) {
    return (
      <section className="h-full rounded-lg border border-zinc-200 bg-white p-4">
        <CardLabel>Release Plan</CardLabel>
        <p className="mt-2 text-sm text-zinc-600">
          Todavía no hay un Roadmap de Releases aprobado para este proyecto.
        </p>
      </section>
    );
  }

  return (
    <section className="h-full rounded-lg border border-zinc-200 bg-white p-4">
      <CardLabel>Release Plan</CardLabel>
      <div className="mt-4 space-y-3 text-sm">
        {releaseRoadmap.releases.map((release) => (
          <ReleasePlanItem
            key={release.id}
            status={release.estado}
            label={release.nombre}
            isActive={release.id === releaseRoadmap.activeReleaseId}
          />
        ))}
      </div>
    </section>
  );
}

function ReleasePlanItem({
  status,
  label,
  isActive,
}: {
  status: string;
  label: string;
  isActive: boolean;
}) {
  const done = status === "Completado";
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-2 text-zinc-700">
      <Icon className={`h-4 w-4 ${done ? "text-emerald-600" : "text-zinc-400"}`} />
      <span>{label}</span>
      <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Activo" : status}</Badge>
    </div>
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
