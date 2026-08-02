import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Loader2, Lock, Search } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { createProject, getGitHubConnectionStatus, githubConnectUrl, listAccessibleGitHubRepositories } from "./api";
import { queryClient } from "../lib/queryClient";
import type { AccessibleRepository } from "./types";

// FEATURE-042, sección E.3.
export function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = React.useState("");
  const [selectedRepo, setSelectedRepo] = React.useState<AccessibleRepository | null>(null);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createProject({
        name,
        repositoryExternalId: selectedRepo?.externalId,
      });
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
      navigate(`/projects/${result.project.id}/cases`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el proyecto.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-950">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg space-y-5 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <h1 className="text-lg font-semibold">Crear proyecto</h1>
          <p className="mt-1 text-sm text-zinc-600">Nombre del proyecto</p>
          <Input
            className="mt-2"
            autoFocus
            placeholder="Ej: Plataforma principal"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="border-t border-zinc-200 pt-4">
          {connection.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando tu conexión GitHub...
            </div>
          ) : !isConnected ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-600">
                Conectá tu cuenta de GitHub para elegir un repositorio, o guardá el proyecto sin repositorio y
                completalo después.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  window.location.href = githubConnectUrl("/projects/new");
                }}
              >
                <GitBranch className="h-4 w-4" />
                Conectar GitHub
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-800">Repositorio (opcional)</p>
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
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {filteredRepos.map((repo) => (
                  <button
                    type="button"
                    key={repo.externalId}
                    onClick={() => setSelectedRepo(repo)}
                    disabled={!repo.permissions.push}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedRepo?.externalId === repo.externalId
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="truncate">{repo.fullName}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {repo.visibility === "private" ? <Lock className="h-3.5 w-3.5 text-zinc-400" /> : null}
                      {!repo.permissions.push ? <Badge variant="outline">Solo lectura</Badge> : null}
                    </span>
                  </button>
                ))}
              </div>
              {selectedRepo ? (
                <p className="text-xs text-zinc-600">
                  Repositorio seleccionado: <span className="font-medium">{selectedRepo.fullName}</span>
                </p>
              ) : null}
            </div>
          )}
        </div>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {selectedRepo ? "Crear y configurar repositorio" : "Crear proyecto"}
          </Button>
        </div>
      </form>
    </main>
  );
}
