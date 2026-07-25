import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Eye, XCircle } from "lucide-react";
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
import type { RunCaseSummary } from "./types";

function statusVariant(status: string): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "completed") return "success";
  if (status === "running" || status === "retrying") return "secondary";
  if (status === "escalated") return "warning";
  if (status === "failed" || status === "aborted") return "destructive";
  return "outline";
}

function statusLabel(status: string): string {
  if (status === "sin_iniciar") return "Sin iniciar";
  return status;
}

export function CasesList(props: { onOpenRun: (runId: string) => void; onNewCase: () => void }) {
  const query = useQuery({
    queryKey: ["runs", "mine"],
    queryFn: async () => {
      const response = await fetch(apiUrl("/runs"), { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { runs: RunCaseSummary[] };
      return body.runs;
    },
  });

  const [startingId, setStartingId] = React.useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["runs", "mine"] });

  const iniciar = async (runId: string) => {
    setStartingId(runId);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}/start`), {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      refresh();
      props.onOpenRun(runId);
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

  return (
    <section className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Mis casos</h2>
        <Button onClick={props.onNewCase}>Nuevo caso</Button>
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
          Todavía no cargaste ningún caso. Empezá con "Nuevo caso".
        </div>
      ) : null}

      <div className="space-y-2">
        {(query.data ?? []).map((run) => (
          <div
            key={run.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
                <span className="truncate font-mono text-xs text-zinc-500">{run.id}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {run.current_phase ? `Fase: ${run.current_phase} — ` : ""}
                Creado: {new Date(run.created_at).toLocaleString()}
              </p>
            </div>

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
                <Button size="sm" variant="outline" onClick={() => props.onOpenRun(run.id)}>
                  <Eye className="h-4 w-4" />
                  Visualizar
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

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
