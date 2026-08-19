import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Play, Eye, XCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { apiUrl } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { getProject } from "../projects/api";
import { statusLabel, statusVariant } from "./statusDisplay";
import type { CaseTree, CaseTreeFeature, CaseTreeRelease, CaseTreeRun } from "./types";

// FEATURE-042, sección B.7/E.6: filtra exclusivamente por el proyecto activo -- ya no consume
// listRunsForUser(userId) sin scope de proyecto.
// FEATURE-045: la pantalla pasa de listar Runs planos a representar el árbol Caso -> Release ->
// Feature -> Run/Reingreso que ya llega resuelto del backend (Regla 13) -- este componente solo
// maneja estado visual (expandido/colapsado), sin reconstruir ninguna relación de dominio.
export function CasesList() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const navigate = useNavigate();

  // Sección E.8: "Nuevo caso" bloqueado si el proyecto no tiene repositorio configurado -- mismo
  // criterio que el botón de navegación de ProjectShell (misma queryKey, sin refetch adicional).
  const project = useQuery({
    queryKey: ["projects", projectId],
    enabled: projectId.length > 0,
    queryFn: () => getProject(projectId),
  });
  const isConfigured = project.data?.project.isConfigured ?? false;

  const query = useQuery({
    queryKey: ["projects", projectId, "cases"],
    enabled: projectId.length > 0,
    queryFn: async () => {
      const response = await fetch(apiUrl(`/projects/${encodeURIComponent(projectId)}/cases`), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { cases: CaseTree[] };
      return body.cases;
    },
  });

  const [startingId, setStartingId] = React.useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "cases"] });

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const iniciar = async (runId: string) => {
    setStartingId(runId);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}/start`), {
        method: "POST",
        credentials: "include",
      });
      if (response.status === 422) {
        const body = (await response.json()) as { error?: string; message?: string };
        setError(body.message ?? "No se pudo iniciar el run: falló un chequeo técnico previo al Architect.");
        refresh();
        return;
      }
      if (response.status === 409) {
        const body = (await response.json()) as { error?: string; message?: string };
        setError(
          body.error === "git_connection_required"
            ? "Tu conexión GitHub no es válida -- reconectala antes de iniciar este caso."
            : (body.message ?? "No se pudo iniciar el run.")
        );
        refresh();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      refresh();
      navigate(`/projects/${projectId}/cases/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el run.");
    } finally {
      setStartingId(null);
    }
  };

  const cancelar = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/runs/${encodeURIComponent(cancelTarget)}/cancel`), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar el run.");
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };

  const runActions = (run: CaseTreeRun) => (
    <div className="flex shrink-0 gap-2">
      {run.status === "sin_iniciar" ? (
        <Button size="sm" disabled={startingId === run.id} onClick={() => void iniciar(run.id)}>
          {startingId === run.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Iniciar
        </Button>
      ) : null}
      {run.status === "running" ? (
        <Button size="sm" variant="destructive" onClick={() => setCancelTarget(run.id)}>
          <XCircle className="h-4 w-4" />
          Cancelar
        </Button>
      ) : null}
      {run.status !== "sin_iniciar" ? (
        <Button size="sm" variant="outline" onClick={() => navigate(`/projects/${projectId}/cases/${run.id}`)}>
          <Eye className="h-4 w-4" />
          Visualizar
        </Button>
      ) : null}
    </div>
  );

  const renderRun = (run: CaseTreeRun, depth: number) => (
    <div key={run.id}>
      <div
        className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ marginLeft: depth * 20 }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
            {run.kind === "reentry" ? <Badge variant="outline">Reingreso</Badge> : null}
            <span className="truncate font-mono text-xs text-zinc-500" title={run.id}>
              {run.id.slice(0, 8)}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {run.currentPhase ? `Fase: ${run.currentPhase} — ` : ""}
            Creado: {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        {runActions(run)}
      </div>
      {run.children.map((child) => renderRun(child, depth + 1))}
    </div>
  );

  const renderFeature = (caseKey: string, feature: CaseTreeFeature) => {
    const key = `feature:${caseKey}:${feature.id}`;
    const isCollapsed = collapsed.has(key);
    return (
      <div key={feature.id} className="ml-5 space-y-2 border-l border-zinc-200 pl-4">
        <button
          type="button"
          onClick={() => toggle(key)}
          className="flex items-center gap-1 text-sm font-medium text-zinc-800"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {feature.featureCode} · {feature.name}
        </button>
        {!isCollapsed ? <div className="space-y-2">{feature.runs.map((run) => renderRun(run, 0))}</div> : null}
      </div>
    );
  };

  const renderRelease = (caseKey: string, release: CaseTreeRelease) => {
    const key = `release:${caseKey}:${release.id}`;
    const isCollapsed = collapsed.has(key);
    return (
      <div key={release.id} className="ml-5 space-y-2 border-l border-zinc-200 pl-4">
        <button
          type="button"
          onClick={() => toggle(key)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-800"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {release.nombre}
          <Badge variant="outline">{release.estado}</Badge>
        </button>
        {!isCollapsed ? (
          <div className="space-y-2">
            {release.features.map((feature) => renderFeature(caseKey, feature))}
            {release.runs.map((run) => renderRun(run, 1))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderCase = (caseTree: CaseTree) => {
    const key = `case:${caseTree.caseKey}`;
    const isCollapsed = collapsed.has(key);
    return (
      <div key={caseTree.caseKey} className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
        <button type="button" onClick={() => toggle(key)} className="flex items-center gap-2 text-left">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="font-mono text-sm font-semibold text-zinc-900">{caseTree.displayName}</span>
          <span className="text-xs text-zinc-500">{new Date(caseTree.createdAt).toLocaleString()}</span>
        </button>
        {!isCollapsed ? (
          <div className="space-y-2">
            {caseTree.releases.map((release) => renderRelease(caseTree.caseKey, release))}
            {caseTree.runs.map((run) => renderRun(run, 1))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Casos</h2>
        <Button
          disabled={!isConfigured}
          title={isConfigured ? undefined : "Configurá un repositorio de GitHub para crear casos en este proyecto"}
          onClick={() => navigate(`/projects/${projectId}/cases/new`)}
        >
          Nuevo caso
        </Button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {query.isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando casos...
        </div>
      ) : null}

      {query.data && query.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
          Todavía no cargaste ningún caso en este proyecto. Empezá con "Nuevo caso".
        </div>
      ) : null}

      <div className="space-y-3">{(query.data ?? []).map((caseTree) => renderCase(caseTree))}</div>

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este run?</AlertDialogTitle>
            <AlertDialogDescription>
              Si hay una fase realmente en ejecución, la cancelación se aplica recién en el próximo punto de corte
              natural del pipeline — no interrumpe el proceso activo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Volver</AlertDialogCancel>
            <AlertDialogAction disabled={cancelling} onClick={() => void cancelar()}>
              {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancelar run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
