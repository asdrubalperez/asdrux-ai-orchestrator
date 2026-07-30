import React from "react";
import { CheckCircle2, Circle, PlayCircle } from "lucide-react";
import { Badge } from "./components/ui/badge";

export interface ReleasePlanFeatureView {
  id: string;
  nombre: string;
  estado: "Pendiente" | "En curso" | "Completada";
}

export interface ReleaseRoadmapView {
  releases: Array<{
    id: string;
    nombre: string;
    alcanceResumen: string;
    estado: "Activo" | "Pendiente" | "Completado";
    features: ReleasePlanFeatureView[];
  }>;
  /** FEATURE-036: `null` cuando el proyecto está cerrado y no hay ningún release activo. */
  activeReleaseId: string | null;
}

export function ReleasePlanPanel({ releaseRoadmap }: { releaseRoadmap: ReleaseRoadmapView | null }) {
  if (!releaseRoadmap) {
    return (
      <section className="h-full rounded-lg border border-zinc-200 bg-white p-4">
        <PanelLabel />
        <p className="mt-2 text-sm text-zinc-600">
          Todavía no hay un Roadmap de Releases aprobado para este proyecto.
        </p>
      </section>
    );
  }

  return (
    <section className="h-full rounded-lg border border-zinc-200 bg-white p-4">
      <PanelLabel />
      {releaseRoadmap.activeReleaseId === null ? (
        <p className="mt-2 text-sm text-zinc-600">Sin release activo.</p>
      ) : null}
      <div className="mt-4 space-y-4 text-sm">
        {releaseRoadmap.releases.map((release) => (
          <div key={release.id}>
            <ReleasePlanItem
              status={release.estado}
              label={release.nombre}
              isActive={release.id === releaseRoadmap.activeReleaseId}
            />
            <div className="ml-6 mt-2 space-y-2">
              {release.features.map((feature) => (
                <ReleasePlanItem key={feature.id} status={feature.estado} label={feature.nombre} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReleasePlanItem({
  status,
  label,
  isActive = false,
}: {
  status: "Activo" | "Pendiente" | "Completado" | "En curso" | "Completada";
  label: string;
  isActive?: boolean;
}) {
  const visualStatus =
    status === "Completado" || status === "Completada"
      ? "completed"
      : status === "Activo" || status === "En curso"
        ? "in-progress"
        : "pending";
  const Icon = visualStatus === "completed" ? CheckCircle2 : visualStatus === "in-progress" ? PlayCircle : Circle;
  const color =
    visualStatus === "completed"
      ? "text-emerald-600"
      : visualStatus === "in-progress"
        ? "text-sky-600"
        : "text-zinc-400";

  return (
    <div className="flex items-center gap-2 text-zinc-700">
      <Icon aria-label={visualStatus} className={`h-4 w-4 ${color}`} />
      <span>{label}</span>
      {isActive ? <Badge variant="success">Activo</Badge> : null}
    </div>
  );
}

function PanelLabel() {
  return <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Release Plan</p>;
}
