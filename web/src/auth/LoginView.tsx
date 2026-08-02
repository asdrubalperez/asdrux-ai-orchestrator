import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiUrl } from "../lib/api";

export function LoginView({ onLogin }: { onLogin: () => Promise<void> }) {
  const [handle, setHandle] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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
            try {
              const response = await fetch(apiUrl("/auth/login"), {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ handle, password }),
              });
              if (!response.ok) throw new Error("Credenciales inválidas");
              await onLogin();
            } catch (err) {
              setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Input placeholder="Handle" value={handle} onChange={(event) => setHandle(event.target.value)} />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
          <Button className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Entrar
          </Button>
        </form>
      </section>
    </main>
  );
}
