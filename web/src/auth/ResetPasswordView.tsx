import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AuthLayout } from "./RegisterView";
import { activateAccount, resetPassword, AuthApiError } from "./api";

// Escenario 9: contraseña actualizada, token invalidado, todas las sesiones revocadas,
// redirección a login (Scope). `mode="activate"` reusa exactamente el mismo formulario para
// cuentas creadas por un administrador -- mismo flujo, solo cambia el endpoint y el copy.
export function ResetPasswordView(props: { mode?: "reset" | "activate" }) {
  const mode = props.mode ?? "reset";
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <AuthLayout title={mode === "activate" ? "Cuenta activada" : "Contraseña actualizada"}>
        <p className="text-sm text-emerald-700">Ya podés iniciar sesión con tu nueva contraseña.</p>
        <Link to="/login" className="mt-4 block text-sm text-blue-700 underline">
          Iniciar sesión
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={mode === "activate" ? "Activar cuenta" : "Restablecer contraseña"}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!token) {
            setError("Enlace inválido.");
            return;
          }
          setLoading(true);
          setError(null);
          try {
            if (mode === "activate") await activateAccount(token, password, passwordConfirmation);
            else await resetPassword(token, password, passwordConfirmation);
            setDone(true);
          } catch (err) {
            setError(err instanceof AuthApiError ? err.message : "No se pudo completar la operación.");
          } finally {
            setLoading(false);
          }
        }}
      >
        <Input
          type="password"
          placeholder="Contraseña nueva (mínimo 10 caracteres, mayúscula, minúscula, número y símbolo)"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Confirmar contraseña"
          value={passwordConfirmation}
          onChange={(event) => setPasswordConfirmation(event.target.value)}
          required
        />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <Button className="w-full" disabled={loading || !token}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mode === "activate" ? "Activar cuenta" : "Restablecer contraseña"}
        </Button>
      </form>
    </AuthLayout>
  );
}
