import React from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { registerAccount, AuthApiError } from "./api";

// FEATURE-041, Regla 5.4: la respuesta es siempre neutra -- no hay forma de distinguir, desde acá,
// si el email ya existía. Mostramos el mismo mensaje de éxito en todos los casos no-error-de-
// formato.
export function RegisterView() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [passwordConfirmation, setPasswordConfirmation] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <AuthLayout title="Revisá tu email">
        <p className="text-sm text-zinc-700">
          Si el email es válido, te enviamos un enlace para confirmar tu cuenta. Puede tardar unos minutos en llegar.
        </p>
        <Link to="/login" className="mt-4 block text-sm text-blue-700 underline">
          Volver a iniciar sesión
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Crear cuenta">
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoading(true);
          setError(null);
          try {
            await registerAccount(email, password, passwordConfirmation);
            setDone(true);
          } catch (err) {
            setError(err instanceof AuthApiError ? err.message : "No se pudo completar el registro.");
          } finally {
            setLoading(false);
          }
        }}
      >
        <Input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Input
          type="password"
          placeholder="Contraseña (mínimo 10 caracteres, mayúscula, minúscula, número y símbolo)"
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
        <Button className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Registrarme
        </Button>
      </form>
      <Link to="/login" className="mt-4 block text-sm text-zinc-600 underline">
        Ya tengo cuenta
      </Link>
    </AuthLayout>
  );
}

export function AuthLayout(props: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-950">
      <section className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5">
        <h1 className="text-xl font-semibold">{props.title}</h1>
        <div className="mt-5">{props.children}</div>
      </section>
    </main>
  );
}
