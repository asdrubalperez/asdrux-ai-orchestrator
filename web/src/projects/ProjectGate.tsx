import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { listProjects } from "./api";

/**
 * FEATURE-042, sección C.3: gate posterior al login. Es el elemento de la ruta "/" -- decide a
 * dónde navegar sin nunca inventar una selección por orden o antigüedad (Regla B.9 / la
 * desestimación completa de FEATURE-030 depende de que este gate no "adivine" nada).
 */
export function ProjectGate() {
  const query = useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => listProjects(),
  });

  if (query.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Cargando tus proyectos...
      </main>
    );
  }

  if (query.isError || !query.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-rose-700">
        No se pudieron cargar tus proyectos.
      </main>
    );
  }

  const { projects, selectedProjectId } = query.data;

  if (projects.length === 0) {
    return <Navigate to="/projects/new" replace />;
  }

  const selected = selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null;
  if (selected) {
    return <Navigate to={`/projects/${selected.id}/cases`} replace />;
  }

  return <Navigate to="/projects" replace />;
}
