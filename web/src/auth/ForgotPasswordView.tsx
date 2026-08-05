import React from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { AuthLayout } from "./RegisterView";
import { forgotPassword, AuthApiError } from "./api";

// Escenario 8: respuesta neutra sin importar si el email existe (Regla 5.4).
export function ForgotPasswordView() {
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <AuthLayout title="Revisá tu email">
        <p className="text-sm text-zinc-700">
          Si el email está registrado, te enviamos un enlace para restablecer tu contraseña.
        </p>
        <Link to="/login" className="mt-4 block text-sm text-blue-700 underline">
          Volver a iniciar sesión
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recuperar contraseña">
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          setError(null);
          try {
            await forgotPassword(email);
            setDone(true);
          } catch (err) {
            setError(err instanceof AuthApiError ? err.message : "No se pudo procesar la solicitud.");
          } finally {
            setLoading(false);
          }
        }}
      >
        <Input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <Button className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Enviar enlace
        </Button>
      </form>
      <Link to="/login" className="mt-4 block text-sm text-zinc-600 underline">
        Volver a iniciar sesión
      </Link>
    </AuthLayout>
  );
}
