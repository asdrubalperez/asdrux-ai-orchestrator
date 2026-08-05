import React from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiUrl } from "../lib/api";
import { resendVerification, AuthApiError } from "./api";

// FEATURE-041: el label pasa de "Handle" a "Email" -- las cuentas self-service se identifican por
// email (Scope: "No se introduce username"); el body sigue enviando `handle` porque el backend
// normaliza el email como handle en el login (Regla 5.4), sin tocar el contrato existente.
export function LoginView({ onLogin }: { onLogin: () => Promise<void> }) {
  const [handle, setHandle] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [showResend, setShowResend] = React.useState(false);
  const [resendDone, setResendDone] = React.useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-950">
      <section className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5">
        <h1 className="text-xl font-semibold">Ingresar</h1>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            setError(null);
            setShowResend(false);
            try {
              const response = await fetch(apiUrl("/auth/login"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ handle, password }),
              });
              if (!response.ok) {
                const body = await response.json().catch(() => null);
                if (body?.error === "account_not_verified") {
                  setError("Tu cuenta todavía no verificó el email.");
                  setShowResend(true);
                } else if (body?.error === "account_suspended") {
                  setError("Tu cuenta está suspendida.");
                } else {
                  setError("Email o contraseña inválidos.");
                }
                return;
              }
              await onLogin();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Input placeholder="Email" value={handle} onChange={(event) => setHandle(event.target.value)} />
          <Input
            placeholder="Contraseña"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          {showResend ? (
            resendDone ? (
              <p className="text-sm text-emerald-700">Si la cuenta existe, te reenviamos el email de verificación.</p>
            ) : (
              <button
                type="button"
                className="text-sm text-blue-700 underline"
                onClick={async () => {
                  try {
                    await resendVerification(handle);
                  } catch (err) {
                    if (!(err instanceof AuthApiError)) throw err;
                  } finally {
                    setResendDone(true);
                  }
                }}
              >
                Reenviar email de verificación
              </button>
            )
          ) : null}
          <Button className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar
          </Button>
        </form>
        <div className="mt-4 flex items-center justify-between text-sm">
          <Link to="/register" className="text-zinc-600 underline">
            Crear cuenta
          </Link>
          <Link to="/forgot-password" className="text-zinc-600 underline">
            Olvidé mi contraseña
          </Link>
        </div>
      </section>
    </main>
  );
}
