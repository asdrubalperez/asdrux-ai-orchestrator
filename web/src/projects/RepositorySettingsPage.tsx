import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, GitBranch, Loader2, Lock, Search } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  disconnectGitHub,
  getGitHubConnectionStatus,
  getProject,
  githubConnectUrl,
  listAccessibleGitHubRepositories,
  setProjectRepository,
} from "./api";
import { queryClient } from "../lib/queryClient";

// FEATURE-042, sección E.4.
export function RepositorySettingsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const navigate = useNavigate();
  const [search, setSearch] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const project = useQuery({ queryKey: ["projects", projectId], queryFn: () => getProject(projectId) });
  const connection = useQuery({ queryKey: ["github", "status"], queryFn: () => getGitHubConnectionStatus() });
  const isConnected = connection.data?.connection.status === "connected";
  const repos = useQuery({
    queryKey: ["github", "repositories"],
    queryFn: () => listAccessibleGitHubRepositories(),
    enabled: isConnected,
  });

  const filteredRepos = (repos.data?.repositories ?? []).filter((repo) =>
    repo.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const choose = async (externalId: string) => {
    setSaving(true);
    setError(null);
    try {
      await setProjectRepository(projectId, externalId);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${projectId}/cases`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo configurar el repositorio.");
    } finally {
      setSaving(false);
    }
  };

  const returnPath = `/projects/${projectId}/settings/repository`;

  // Sección E.9 / Regla 24 de FEATURE-026: desconectar no borra la configuración del proyecto,
  // solo invalida la conexión -- las operaciones de Git quedan bloqueadas hasta reconectar.
  const desconectar = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectGitHub();
      void queryClient.invalidateQueries({ queryKey: ["github", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["github", "repositories"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo desconectar GitHub.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-semibold">Configuración del repositorio</h1>
          <p className="mt-1 text-sm text-zinc-600">{project.data?.project.name}</p>
        </div>
      </header>

      <section className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {project.data?.project.repository ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Repositorio actual: <span className="font-medium">{project.data.project.repository.fullName}</span>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Este proyecto todavía no tiene repositorio configurado. Sin repositorio no se pueden crear casos.
          </div>
        )}

        {connection.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando tu conexión GitHub...
          </div>
        ) : !isConnected ? (
          <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-600">Conectá tu cuenta de GitHub para elegir un repositorio.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = githubConnectUrl(returnPath);
              }}
            >
              <GitBranch className="h-4 w-4" />
              Conectar GitHub
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
            {connection.data ? (
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">Conectado como {connection.data.connection.externalLogin}</p>
                <Button type="button" size="sm" variant="outline" disabled={disconnecting} onClick={() => void desconectar()}>
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Desconectar
                </Button>
              </div>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-zinc-400" />
              <Input
                className="pl-8"
                placeholder="Buscar repositorio..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {repos.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando repositorios...
              </div>
            ) : null}
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filteredRepos.map((repo) => (
                <button
                  type="button"
                  key={repo.externalId}
                  disabled={!repo.permissions.push || saving}
                  onClick={() => void choose(repo.externalId)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="truncate">{repo.fullName}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {repo.visibility === "private" ? <Lock className="h-3.5 w-3.5 text-zinc-400" /> : null}
                    {!repo.permissions.push ? <Badge variant="outline">Solo lectura</Badge> : null}
                  </span>
                </button>
              ))}
            </div>
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          </div>
        )}
      </section>
    </main>
  );
}
