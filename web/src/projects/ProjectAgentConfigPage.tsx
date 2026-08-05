import React from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { getProject, setProjectAgentConfigProfile } from "./api";
import { getAgentConfig, getAiCredentialStatuses } from "../agentConfig/api";
import { queryClient } from "../lib/queryClient";

/**
 * FEATURE-041, Regla 5.10/Scope "Separación cuenta/proyecto/caso": esta pantalla es el mirror de
 * solo lectura del proyecto -- muestra qué credenciales están disponibles para la cuenta y permite
 * elegir, para ESTE proyecto puntual, cuál configuración de cuenta aplica (Global o un perfil).
 * Nunca permite editar el contenido de Global/perfiles/credenciales -- eso vive exclusivamente en
 * /settings/agents (el módulo de cuenta), con un link directo desde acá.
 */
export function ProjectAgentConfigPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const project = useQuery({ queryKey: ["projects", projectId], queryFn: () => getProject(projectId) });
  const agentConfig = useQuery({ queryKey: ["agent-config"], queryFn: () => getAgentConfig() });
  const credentials = useQuery({ queryKey: ["agent-credentials"], queryFn: () => getAiCredentialStatuses() });

  const selectedProfileId = project.data?.project.agentConfigProfileId ?? null;

  const select = async (profileId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await setProjectAgentConfigProfile(projectId, profileId);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-lg font-semibold">Configuración de agentes</h1>
          <p className="mt-1 text-sm text-zinc-600">{project.data?.project.name}</p>
        </div>
      </header>

      <section className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Credenciales disponibles</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Solo lectura -- para agregar, quitar o reconectar credenciales, andá a{" "}
            <Link to="/settings/agents" className="underline">
              tu cuenta
            </Link>
            .
          </p>
          <div className="mt-3 space-y-2">
            {credentials.isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            ) : (
              (credentials.data?.credentials ?? []).map((c) => (
                <div key={c.provider} className="flex items-center gap-2 text-sm">
                  <KeyRound className="h-4 w-4 text-zinc-500" />
                  <span className="capitalize">{c.provider}</span>
                  <Badge variant={c.configured ? "success" : "outline"}>{c.configured ? "Configurada" : "Sin configurar"}</Badge>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Configuración para este proyecto</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Elegí Global o uno de tus perfiles personalizados. Para editar el contenido de cada uno, andá a{" "}
            <Link to="/settings/agents" className="underline">
              tu cuenta
            </Link>
            .
          </p>
          {agentConfig.isLoading || project.isLoading ? (
            <Loader2 className="mt-3 h-4 w-4 animate-spin text-zinc-400" />
          ) : (
            <div className="mt-3 space-y-2">
              <ConfigOption
                label="Global"
                description="Misma combinación para los 6 agentes."
                selected={selectedProfileId === null}
                disabled={saving}
                onSelect={() => void select(null)}
              />
              {(agentConfig.data?.profiles ?? []).map((profile) => (
                <ConfigOption
                  key={profile.id}
                  label={profile.name}
                  description="Perfil personalizado."
                  selected={selectedProfileId === profile.id}
                  disabled={saving}
                  onSelect={() => void select(profile.id)}
                />
              ))}
            </div>
          )}
          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}

function ConfigOption(props: {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onSelect}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:opacity-50 ${
        props.selected ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:bg-zinc-50"
      }`}
    >
      <span>
        <span className="font-medium text-zinc-800">{props.label}</span>
        <span className="ml-2 text-xs text-zinc-500">{props.description}</span>
      </span>
      {props.selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
    </button>
  );
}
