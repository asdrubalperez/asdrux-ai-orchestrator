import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { queryClient } from "../lib/queryClient";
import { useCurrentUser } from "../auth/useCurrentUser";
import {
  AdminApiError,
  createAccount,
  demoteToUser,
  getAccountProjects,
  listAccounts,
  promoteToAdmin,
  reactivateAccount,
  resendVerificationByAdmin,
  suspendAccount,
  type AdminAccountEntry,
} from "./api";

const ROLE_LABEL: Record<AdminAccountEntry["role"], string> = {
  user: "Usuario",
  admin: "Administrador",
  superadmin: "Superadministrador",
};

const STATUS_LABEL: Record<AdminAccountEntry["status"], string> = {
  pending_verification: "Pendiente de verificación",
  active: "Activa",
  suspended: "Suspendida",
};

// FEATURE-041, Regla 5.8/Scope "Visibilidad administrativa": listado + acciones + lectura de
// proyectos ajenos, sin secretos ni acciones operativas. La autorización real vive en backend
// (accountAdminService.ts) -- esta pantalla solo oculta acciones que el actor no puede ejercer
// para no invitar a intentar algo que el servidor va a rechazar de todos modos.
export function AdminUsersPage() {
  const { user: actor } = useCurrentUser();
  const accountsQuery = useQuery({ queryKey: ["admin", "accounts"], queryFn: () => listAccounts() });
  const [newEmail, setNewEmail] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["admin", "accounts"] });

  const create = async () => {
    if (!newEmail.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createAccount(newEmail.trim());
      setNewEmail("");
      invalidate();
    } catch (err) {
      setCreateError(err instanceof AdminApiError ? err.message : "No se pudo crear la cuenta.");
    } finally {
      setCreating(false);
    }
  };

  if (!actor || (actor.role !== "admin" && actor.role !== "superadmin")) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-zinc-600">No tenés acceso a esta sección.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Administración de cuentas</h1>
          <p className="mt-1 text-sm text-zinc-600">Gestión de usuarios, roles y estado.</p>
        </div>
        <Link to="/projects" className="text-sm text-zinc-600 underline">
          Volver a proyectos
        </Link>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Crear cuenta</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Sin contraseña temporal -- la persona recibe un correo de activación y elige su propia contraseña.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Input type="email" placeholder="Email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
          <Button size="sm" disabled={creating || !newEmail.trim()} onClick={() => void create()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear
          </Button>
        </div>
        {createError ? <p className="mt-2 text-sm text-rose-700">{createError}</p> : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Usuarios</h2>
        {accountsQuery.isLoading ? (
          <Loader2 className="mt-4 h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <div className="mt-4 divide-y divide-zinc-100">
            {(accountsQuery.data?.accounts ?? []).map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                actorRole={actor.role}
                actorId={actor.id}
                expanded={expandedId === account.id}
                onToggleExpand={() => setExpandedId((current) => (current === account.id ? null : account.id))}
                onChanged={invalidate}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function AccountRow(props: {
  account: AdminAccountEntry;
  actorRole: "user" | "admin" | "superadmin";
  actorId: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void;
}) {
  const { account } = props;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["admin", "accounts", account.id, "projects"],
    queryFn: () => getAccountProjects(account.id),
    enabled: props.expanded,
  });

  const isSelf = account.id === props.actorId;
  const canManage = !account.is_protected_superadmin && !isSelf && (account.role !== "admin" || props.actorRole === "superadmin");
  const canPromote = !isSelf && account.role === "user";
  const canDemote = !isSelf && account.role === "admin" && props.actorRole === "superadmin";

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      props.onChanged();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-zinc-800">{account.email ?? "(sin email)"}</p>
            {account.is_protected_superadmin ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : null}
          </div>
          <p className="text-xs text-zinc-500">{account.display_name ?? "(sin nombre)"}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="outline">{ROLE_LABEL[account.role]}</Badge>
            <Badge variant={account.status === "active" ? "success" : account.status === "suspended" ? "warning" : "outline"}>
              {STATUS_LABEL[account.status]}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={props.onToggleExpand}>
            {props.expanded ? "Ocultar proyectos" : "Ver proyectos"}
          </Button>
          {account.status === "pending_verification" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => resendVerificationByAdmin(account.id))}>
              Reenviar verificación
            </Button>
          ) : null}
          {canManage && account.status === "active" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => suspendAccount(account.id))}>
              Suspender
            </Button>
          ) : null}
          {canManage && account.status === "suspended" ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => reactivateAccount(account.id))}>
              Reactivar
            </Button>
          ) : null}
          {canPromote ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => promoteToAdmin(account.id))}>
              Promover a admin
            </Button>
          ) : null}
          {canDemote ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => demoteToUser(account.id))}>
              Degradar a usuario
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {props.expanded ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
          {projectsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
          ) : (projectsQuery.data?.projects.length ?? 0) === 0 ? (
            <p className="text-zinc-500">Sin proyectos.</p>
          ) : (
            <ul className="space-y-1">
              {projectsQuery.data!.projects.map((project) => (
                <li key={project.id} className="flex items-center justify-between">
                  <span>{project.name}</span>
                  <span className="text-xs text-zinc-500">{project.repositoryFullName ?? "sin repositorio"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
