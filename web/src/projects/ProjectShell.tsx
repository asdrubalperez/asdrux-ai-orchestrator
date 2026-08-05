import React from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, FolderGit2, ListChecks, LogOut, Plus, Settings } from "lucide-react";
import { Button } from "../components/ui/button";
import { listProjects, selectProject } from "./api";
import { queryClient } from "../lib/queryClient";
import type { CurrentUser } from "../auth/useCurrentUser";

/**
 * FEATURE-042, sección E.1/E.5. Envuelve todas las rutas `/projects/:projectId/*` -- resuelve el
 * proyecto activo exclusivamente desde el route param (sección C.4), nunca desde
 * `last_selected_project_id` (esa preferencia solo decide a dónde entrar después del login).
 */
export function ProjectShell(props: { user: CurrentUser; onLogout: () => Promise<void> }) {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const [selectorOpen, setSelectorOpen] = React.useState(false);

  const query = useQuery({ queryKey: ["projects", "list"], queryFn: () => listProjects() });
  const activeProject = query.data?.projects.find((p) => p.id === projectId);

  // Sección C.5: el proyecto de la URL no existe, no es tuyo, o dejó de estar disponible.
  if (query.data && !activeProject) {
    return <Navigate to="/projects" replace />;
  }

  const switchTo = async (id: string) => {
    setSelectorOpen(false);
    await selectProject(id);
    void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    navigate(`/projects/${id}/cases`);
  };

  const isNewCase = location.pathname.endsWith("/cases/new");
  const isSettings = location.pathname.includes("/settings/");

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button variant="ghost" size="sm" onClick={() => setSelectorOpen((v) => !v)}>
                <FolderGit2 className="h-4 w-4" />
                {activeProject?.name ?? "Proyecto"}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {selectorOpen ? (
                <div className="absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-1 shadow-md">
                  {(query.data?.projects ?? []).map((project) => (
                    <button
                      key={project.id}
                      onClick={() => void switchTo(project.id)}
                      className={`block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-100 ${
                        project.id === projectId ? "font-medium" : ""
                      }`}
                    >
                      {project.name}
                    </button>
                  ))}
                  <div className="mt-1 border-t border-zinc-200 pt-1">
                    <Link
                      to="/projects"
                      onClick={() => setSelectorOpen(false)}
                      className="block rounded px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
                    >
                      Ver todos
                    </Link>
                    <Link
                      to="/projects/new"
                      onClick={() => setSelectorOpen(false)}
                      className="block rounded px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
                    >
                      Crear proyecto
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              variant={!isNewCase && !isSettings ? "secondary" : "ghost"}
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/cases`)}
            >
              <ListChecks className="h-4 w-4" />
              Casos
            </Button>
            <Button
              variant={isNewCase ? "secondary" : "ghost"}
              size="sm"
              disabled={!activeProject?.isConfigured}
              title={activeProject?.isConfigured ? undefined : "Configurá un repositorio para crear casos"}
              onClick={() => navigate(`/projects/${projectId}/cases/new`)}
            >
              <Plus className="h-4 w-4" />
              Nuevo caso
            </Button>
            <Button
              variant={isSettings ? "secondary" : "ghost"}
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/settings/repository`)}
            >
              <Settings className="h-4 w-4" />
              Repositorio
            </Button>
            <Button
              variant={location.pathname.includes("/settings/agent-config") ? "secondary" : "ghost"}
              size="sm"
              onClick={() => navigate(`/projects/${projectId}/settings/agent-config`)}
            >
              <Bot className="h-4 w-4" />
              Config. de agentes
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {props.user.role === "admin" || props.user.role === "superadmin" ? (
              <Button variant="ghost" size="sm" onClick={() => navigate("/admin/users")}>
                Administración
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => navigate("/settings/agents")}>
              Mi cuenta
            </Button>
            <Button
              data-testid="logout-button"
              variant="outline"
              size="sm"
              aria-label="Salir"
              title={`Salir (${props.user.displayName ?? props.user.handle})`}
              onClick={() => void props.onLogout()}
            >
              <LogOut className="h-4 w-4" />
              {props.user.displayName ?? props.user.handle}
            </Button>
          </div>
        </div>
      </header>

      {activeProject && !activeProject.isConfigured && !isSettings ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 sm:px-6 lg:px-8">
          Configurá un repositorio de GitHub para crear casos de negocio en este proyecto —{" "}
          <Link to={`/projects/${projectId}/settings/repository`} className="underline">
            configurar ahora
          </Link>
          .
        </div>
      ) : null}

      <Outlet />
    </div>
  );
}
