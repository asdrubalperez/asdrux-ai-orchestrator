import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ExternalLink, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { queryClient } from "../lib/queryClient";
import { useCurrentUser } from "../auth/useCurrentUser";
import { AuthApiError, changePassword, setDisplayName } from "../auth/api";
import { ApiError } from "./api";
import {
  cancelOAuthLogin,
  createAgentConfigProfile,
  clearProfileRoleAgentConfig,
  deleteAgentConfigProfile,
  deleteAiCredential,
  disconnectOAuth,
  getAgentConfig,
  getAiCredentialStatuses,
  getOAuthConnectionStatuses,
  pollCodexLogin,
  renameAgentConfigProfile,
  setAiCredential,
  setGlobalAgentConfig,
  setProfileRoleAgentConfig,
  startOAuthLogin,
  submitClaudeLoginCode,
} from "./api";
import type {
  AgentConfigProfile,
  AgentRole,
  AiCredentialStatus,
  AuthMode,
  EffectiveAgentConfig,
  ExecutorProviderName,
  OAuthConnectionStatus,
  OAuthLoginChallenge,
} from "./types";

const ROLE_LABELS: Record<AgentRole, string> = {
  architect: "Architect",
  functional: "Functional",
  planning: "Planning",
  developer: "Developer",
  qa: "QA",
  intake: "Asistente de Entrada (mapeo del caso de negocio)",
};

// FEATURE-025-Parte-1 (ampliación): "intake" no es una fase del pipeline (no aparece en el
// timeline de un run), pero se configura con exactamente el mismo mecanismo -- override propio o
// herencia de la config global. Hoy solo funciona con Claude + API key propia (Codex/OAuth quedan
// para FEATURE-025-Parte-3).
// Orden del flujo real: el mapeo de intake ocurre antes que cualquier fase del pipeline.
const ALL_ROLES: AgentRole[] = ["intake", "architect", "functional", "planning", "developer", "qa"];

const PROVIDER_LABELS: Record<ExecutorProviderName, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

const DEFAULT_CONFIG: EffectiveAgentConfig = { executorProvider: "claude", authMode: "api_key", model: null };

// FEATURE-041: módulo de cuenta -- nombre visible, contraseña, credenciales/conexiones de IA,
// configuración Global y hasta 3 perfiles personalizados. Todo lo que antes vivía repartido entre
// FEATURE-025-Parte-1 (esta pantalla) y el gate de onboarding converge acá: es exactamente la
// superficie exenta del gate "cuenta activa sin nombre visible -- solo accede al módulo de cuenta"
// (Regla 5.2), y el único lugar donde Global/perfiles/credenciales se editan (la config del
// proyecto solo *selecciona* cuál de estas opciones aplica, ver ProjectAgentConfigSelector).
export function AgentConfigPage() {
  const { user, refresh } = useCurrentUser();
  const configQuery = useQuery({ queryKey: ["agent-config"], queryFn: () => getAgentConfig() });
  const credentialsQuery = useQuery({ queryKey: ["agent-credentials"], queryFn: () => getAiCredentialStatuses() });
  const oauthQuery = useQuery({ queryKey: ["ai-oauth-connections"], queryFn: () => getOAuthConnectionStatuses() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["agent-config"] });
  };
  const invalidateCredentials = () => {
    void queryClient.invalidateQueries({ queryKey: ["agent-credentials"] });
  };
  const invalidateOAuth = () => {
    void queryClient.invalidateQueries({ queryKey: ["ai-oauth-connections"] });
  };

  const onboardingPending = !!user && !user.displayName;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Mi cuenta</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Perfil, contraseña, credenciales de IA y las configuraciones de agente disponibles para tus proyectos
            (Global y hasta {configQuery.data?.maxProfiles ?? 3} perfiles personalizados).
          </p>
        </div>
        {!onboardingPending ? (
          <Link to="/projects" className="text-sm text-zinc-600 underline">
            Volver a proyectos
          </Link>
        ) : null}
      </div>

      {onboardingPending ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Elegí un nombre visible para poder acceder al resto de la aplicación.
        </section>
      ) : null}

      <ProfileSection displayName={user?.displayName ?? null} email={user?.email ?? null} onSaved={refresh} />

      <PasswordSection />

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Conexiones OAuth (personal)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Conectá tu propia cuenta de Claude o ChatGPT para usar el modo "Sesión OAuth". Reemplaza la sesión
          compartida del servidor por una conexión tuya, aislada.
        </p>
        <div className="mt-4 space-y-4">
          {oauthQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : (
            (["claude", "codex"] as const).map((provider) => (
              <OAuthConnectionRow
                key={provider}
                provider={provider}
                status={oauthQuery.data?.connections.find((c) => c.provider === provider) ?? null}
                onChanged={invalidateOAuth}
              />
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Credenciales de IA</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Tu propia API key por proveedor. Nunca se muestra de nuevo después de guardarla.
        </p>
        <div className="mt-4 space-y-4">
          {credentialsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : (
            (["claude", "codex"] as const).map((provider) => (
              <CredentialRow
                key={provider}
                provider={provider}
                status={credentialsQuery.data?.credentials.find((c) => c.provider === provider) ?? null}
                onChanged={invalidateCredentials}
              />
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Configuración Global</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Se aplica a los 6 agentes en cualquier proyecto que no tenga un perfil personalizado seleccionado. Siempre
          existe como opción -- un proyecto nuevo la usa por defecto.
        </p>
        {configQuery.isLoading ? (
          <Loader2 className="mt-4 h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <div className="mt-4">
            <AgentConfigForm
              value={configQuery.data?.global ?? DEFAULT_CONFIG}
              catalog={configQuery.data?.catalog ?? { claude: [], codex: [] }}
              onSave={async (config) => {
                await setGlobalAgentConfig(config);
                invalidate();
              }}
            />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Perfiles personalizados</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Cada perfil puede definir una combinación distinta por agente (ej. modelos livianos para proyectos
              simples, avanzados para proyectos complejos). Un proyecto elige, como máximo, uno.
            </p>
          </div>
        </div>
        {configQuery.isLoading ? (
          <Loader2 className="mt-4 h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <ProfilesManager
            profiles={configQuery.data?.profiles ?? []}
            maxProfiles={configQuery.data?.maxProfiles ?? 3}
            catalog={configQuery.data?.catalog ?? { claude: [], codex: [] }}
            globalConfig={configQuery.data?.global ?? DEFAULT_CONFIG}
            onChanged={invalidate}
          />
        )}
      </section>
    </main>
  );
}

function ProfileSection(props: { displayName: string | null; email: string | null; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(props.displayName ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(props.displayName ?? "");
  }, [props.displayName]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await setDisplayName(name.trim());
      await props.onSaved();
      setEditing(false);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "No se pudo guardar el nombre.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Perfil</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">Email</label>
          <p className="text-sm text-zinc-800">{props.email ?? "-"}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-600">Nombre visible</label>
          {editing || !props.displayName ? (
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" />
              <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm text-zinc-800">{props.displayName}</p>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Editar
              </Button>
            </div>
          )}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await changePassword(currentPassword, newPassword, confirmation);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Contraseña</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Input
          type="password"
          placeholder="Contraseña actual"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <Input
          type="password"
          placeholder="Contraseña nueva"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Input
          type="password"
          placeholder="Confirmar contraseña nueva"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={saving || !currentPassword || !newPassword || !confirmation}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Cambiar contraseña
        </Button>
        {success ? <p className="text-sm text-emerald-700">Contraseña actualizada. Vas a tener que volver a iniciar sesión.</p> : null}
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </section>
  );
}

function ProfilesManager(props: {
  profiles: AgentConfigProfile[];
  maxProfiles: number;
  catalog: Record<ExecutorProviderName, string[]>;
  globalConfig: EffectiveAgentConfig;
  onChanged: () => void;
}) {
  const [newProfileName, setNewProfileName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = React.useState<string | null>(null);

  const create = async () => {
    if (!newProfileName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { profile } = await createAgentConfigProfile(newProfileName.trim());
      setJustCreatedId(profile.id);
      setNewProfileName("");
      props.onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? `Ya tenés el máximo de ${props.maxProfiles} perfiles.`
          : "No se pudo crear el perfil."
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {props.profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          catalog={props.catalog}
          globalConfig={props.globalConfig}
          onChanged={props.onChanged}
          defaultExpanded={profile.id === justCreatedId}
        />
      ))}

      {props.profiles.length < props.maxProfiles ? (
        <div className="flex items-center gap-2 border-t border-zinc-100 pt-4">
          <Input
            placeholder="Nombre del perfil nuevo (ej. Complejidades avanzadas)"
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
          />
          <Button size="sm" disabled={creating || !newProfileName.trim()} onClick={() => void create()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear perfil
          </Button>
        </div>
      ) : (
        <p className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
          Ya tenés el máximo de {props.maxProfiles} perfiles.
        </p>
      )}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

function ProfileCard(props: {
  profile: AgentConfigProfile;
  catalog: Record<ExecutorProviderName, string[]>;
  globalConfig: EffectiveAgentConfig;
  onChanged: () => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(props.defaultExpanded ?? false);
  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(props.profile.name);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const customizedCount = Object.keys(props.profile.roles).length;

  const rename = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await renameAgentConfigProfile(props.profile.id, name.trim());
      setRenaming(false);
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo renombrar el perfil.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgentConfigProfile(props.profile.id);
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar el perfil.");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-zinc-200 p-4">
      <div className="flex items-center justify-between">
        {renaming ? (
          <div className="flex items-center gap-2">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void rename()}>
              Guardar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="h-4 w-4 text-zinc-500" /> : <ChevronRight className="h-4 w-4 text-zinc-500" />}
            <p className="text-sm font-medium text-zinc-800">{props.profile.name}</p>
            <span className="text-xs text-zinc-500">
              {customizedCount === 0 ? "sin agentes personalizados" : `${customizedCount} agente(s) personalizado(s)`}
            </span>
          </button>
        )}
        {!renaming ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
              Renombrar
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {!expanded ? null : (
      <div className="mt-4 space-y-4 divide-y divide-zinc-100">
        {ALL_ROLES.map((role) => (
          <div key={role} className={role === "intake" ? "" : "pt-4"}>
            <ProfileRoleOverride
              role={role}
              override={props.profile.roles[role] ?? null}
              effectiveFallback={props.globalConfig}
              catalog={props.catalog}
              onSave={async (config) => {
                await setProfileRoleAgentConfig(props.profile.id, role, config);
                props.onChanged();
              }}
              onClear={async () => {
                await clearProfileRoleAgentConfig(props.profile.id, role);
                props.onChanged();
              }}
            />
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function ProfileRoleOverride(props: {
  role: AgentRole;
  override: EffectiveAgentConfig | null;
  effectiveFallback: EffectiveAgentConfig;
  catalog: Record<ExecutorProviderName, string[]>;
  onSave: (config: EffectiveAgentConfig) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [clearError, setClearError] = React.useState<string | null>(null);

  if (!editing && !props.override) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-800">{ROLE_LABELS[props.role]}</p>
          <p className="text-xs text-zinc-500">Usa la configuración global.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Personalizar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-800">{ROLE_LABELS[props.role]}</p>
        </div>
        {props.override ? (
          <Button
            variant="outline"
            size="sm"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              setClearError(null);
              try {
                await props.onClear();
              } catch (err) {
                setClearError(err instanceof Error ? err.message : "No se pudo quitar el override.");
              } finally {
                setClearing(false);
              }
            }}
          >
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Quitar override
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        )}
      </div>
      {clearError ? <p className="text-sm text-rose-700">{clearError}</p> : null}
      <AgentConfigForm value={props.override ?? props.effectiveFallback} catalog={props.catalog} onSave={props.onSave} />
    </div>
  );
}

function AgentConfigForm(props: {
  value: EffectiveAgentConfig;
  catalog: Record<ExecutorProviderName, string[]>;
  onSave: (config: EffectiveAgentConfig) => Promise<void>;
}) {
  const [provider, setProvider] = React.useState<ExecutorProviderName>(props.value.executorProvider);
  const [model, setModel] = React.useState<string | null>(props.value.model);
  const [authMode, setAuthMode] = React.useState<AuthMode>(props.value.authMode);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setProvider(props.value.executorProvider);
    setModel(props.value.model);
    setAuthMode(props.value.authMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value.executorProvider, props.value.model, props.value.authMode]);

  const modelsForProvider = props.catalog[provider] ?? [];

  const changeProvider = (next: ExecutorProviderName) => {
    setProvider(next);
    // FEATURE-025-Parte-1, Regla 5.3.6: si el modelo actual no es compatible con el nuevo
    // asistente, se limpia -- nunca queda persistida una combinación inconsistente.
    if (!(props.catalog[next] ?? []).includes(model ?? "")) {
      setModel(null);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.onSave({ executorProvider: provider, authMode, model });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-600">Asistente</label>
        <select
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          value={provider}
          onChange={(event) => changeProvider(event.target.value as ExecutorProviderName)}
        >
          {(Object.keys(PROVIDER_LABELS) as ExecutorProviderName[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-600">Modelo</label>
        <select
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          value={model ?? ""}
          onChange={(event) => setModel(event.target.value.length > 0 ? event.target.value : null)}
        >
          <option value="">Sin especificar (default del proveedor)</option>
          {modelsForProvider.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-600">Autenticación</label>
        <select
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          value={authMode}
          onChange={(event) => setAuthMode(event.target.value as AuthMode)}
        >
          <option value="api_key">API key propia</option>
          <option value="cli_session">Sesión OAuth (personal)</option>
        </select>
      </div>

      <div className="sm:col-span-3">
        {error ? <p className="mb-2 text-sm text-rose-700">{error}</p> : null}
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar
        </Button>
      </div>
    </div>
  );
}

function CredentialRow(props: {
  provider: ExecutorProviderName;
  status: AiCredentialStatus | null;
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await setAiCredential(props.provider, apiKey);
      // Regla 5.6.5: la API key nunca vuelve a mostrarse -- se limpia del formulario apenas se envía.
      setApiKey("");
      setEditing(false);
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la credencial.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await deleteAiCredential(props.provider);
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la credencial.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-800">{PROVIDER_LABELS[props.provider]}</span>
          {props.status?.configured ? (
            <Badge variant="success">Configurada</Badge>
          ) : (
            <Badge variant="warning">Sin configurar</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {props.status?.configured ? "Rotar" : "Configurar"}
          </Button>
          {props.status?.configured ? (
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            type="password"
            placeholder="API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button size="sm" disabled={saving || !apiKey.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Guardar
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

const OAUTH_STATUS_LABEL: Record<OAuthConnectionStatus["status"], string> = {
  not_connected: "No conectado",
  connected: "Conectado",
  reauth_required: "Requiere reautenticación",
};

function OAuthConnectionRow(props: {
  provider: ExecutorProviderName;
  status: OAuthConnectionStatus | null;
  onChanged: () => void;
}) {
  const [challenge, setChallenge] = React.useState<OAuthLoginChallenge | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeRunIds, setActiveRunIds] = React.useState<string[] | null>(null);
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const statusValue = props.status?.status ?? "not_connected";

  const authenticate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startOAuthLogin(props.provider);
      setChallenge(result);
      if (result.provider === "codex") {
        pollCodex(result.attemptId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la conexión.");
    } finally {
      setBusy(false);
    }
  };

  const pollCodex = (attemptId: string) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const outcome = await pollCodexLogin(attemptId);
        if (outcome.pending) {
          pollCodex(attemptId);
          return;
        }
        setChallenge(null);
        props.onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo confirmar la conexión de Codex.");
        setChallenge(null);
      }
    }, 3000);
  };

  const submitCode = async () => {
    if (challenge?.provider !== "claude" || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await submitClaudeLoginCode(challenge.attemptId, code);
      setChallenge(null);
      setCode("");
      props.onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el código.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!challenge) return;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setBusy(true);
    try {
      await cancelOAuthLogin(props.provider, challenge.attemptId);
    } catch {
      // best-effort
    } finally {
      setChallenge(null);
      setCode("");
      setBusy(false);
    }
  };

  const disconnect = async (force: boolean) => {
    setBusy(true);
    setError(null);
    setActiveRunIds(null);
    try {
      await disconnectOAuth(props.provider, force);
      props.onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray((err.body as any)?.activeRunIds)) {
        setActiveRunIds((err.body as { activeRunIds: string[] }).activeRunIds);
        return;
      }
      setError(err instanceof Error ? err.message : "No se pudo desconectar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-800">{PROVIDER_LABELS[props.provider]}</span>
          <Badge variant={statusValue === "connected" ? "success" : statusValue === "reauth_required" ? "warning" : "outline"}>
            {OAUTH_STATUS_LABEL[statusValue]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {statusValue === "connected" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void disconnect(false)}>
              <Trash2 className="h-4 w-4" />
              Desconectar
            </Button>
          ) : challenge ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel()}>
              Cancelar
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void authenticate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {statusValue === "reauth_required" ? "Reautenticar" : "Autenticar"}
            </Button>
          )}
        </div>
      </div>

      {challenge?.provider === "claude" ? (
        <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <a
            href={challenge.authorizeUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-sm text-blue-700 underline"
          >
            Abrir autorización de Claude <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <div className="flex items-center gap-2">
            <Input placeholder="Código de autorización" value={code} onChange={(event) => setCode(event.target.value)} />
            <Button size="sm" disabled={busy || !code.trim()} onClick={() => void submitCode()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </div>
        </div>
      ) : null}

      {challenge?.provider === "codex" ? (
        <div className="space-y-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <a
            href={challenge.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-blue-700 underline"
          >
            Abrir autorización de Codex <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <p>
            Código: <span className="font-mono font-semibold">{challenge.userCode}</span>
          </p>
          {challenge.expiresAt ? <p className="text-xs text-zinc-500">Vence: {challenge.expiresAt}</p> : null}
          <p className="text-xs text-zinc-500">Esperando confirmación en el navegador...</p>
        </div>
      ) : null}

      {activeRunIds ? (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Tenés {activeRunIds.length} run(s) en curso. Desconectar ahora podría afectarlos si necesitan renovar sesión.</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setActiveRunIds(null)}>
              Esperar
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void disconnect(true)}>
              Desconectar igual
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
