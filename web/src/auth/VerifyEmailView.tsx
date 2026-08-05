import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "./RegisterView";
import { verifyEmail, AuthApiError } from "./api";

// Escenario 4/5: verificación sin inicio automático de sesión -- siempre redirige a login (Scope).
export function VerifyEmailView() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = React.useState<"pending" | "ok" | "error">("pending");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Enlace inválido.");
      return;
    }
    verifyEmail(token)
      .then(() => setStatus("ok"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof AuthApiError ? err.message : "No se pudo verificar el email.");
      });
  }, [token]);

  return (
    <AuthLayout title="Verificación de email">
      {status === "pending" ? <Loader2 className="h-5 w-5 animate-spin text-zinc-400" /> : null}
      {status === "ok" ? (
        <>
          <p className="text-sm text-emerald-700">Tu email quedó verificado.</p>
          <Link to="/login" className="mt-4 block text-sm text-blue-700 underline">
            Iniciar sesión
          </Link>
        </>
      ) : null}
      {status === "error" ? (
        <>
          <p className="text-sm text-rose-700">{error}</p>
          <Link to="/login" className="mt-4 block text-sm text-blue-700 underline">
            Volver a iniciar sesión
          </Link>
        </>
      ) : null}
    </AuthLayout>
  );
}
