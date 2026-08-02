import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { listProjects, selectProject } from "./api";
import { queryClient } from "../lib/queryClient";

// FEATURE-042, sección E.2.
export function ProjectsListPage() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["projects", "list"], queryFn: () => listProjects() });

  const open = async (projectId: string) => {
    await selectProject(projectId);
    void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    navigate(`/projects/${projectId}/cases`);
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-semibold">Mis proyectos</h1>
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              Crear proyecto
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-5xl space-y-3 px-4 py-6 sm:px-6 lg:px-8">
        {query.isLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando proyectos...
          </div>
        ) : null}

        {query.isError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            No se pudieron cargar tus proyectos.
          </div>
        ) : null}

        {query.data && query.data.projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
            Todavía no tenés proyectos. Empezá con "Crear proyecto".
          </div>
        ) : null}

        {(query.data?.projects ?? []).map((project) => (
          <div
            key={project.id}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{project.name}</p>
                {project.isSelected ? <Badge variant="secondary">Activo</Badge> : null}
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                {project.repository ? (
                  project.repository.fullName
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Configuración pendiente
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {project.isConfigured ? null : (
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/projects/${project.id}/settings/repository`}>Configurar repositorio</Link>
                </Button>
              )}
              <Button size="sm" onClick={() => void open(project.id)}>
                Abrir
              </Button>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
