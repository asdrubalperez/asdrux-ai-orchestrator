import React from "react";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../components/ui/button";
import { apiUrl } from "../lib/api";
import { queryClient } from "../lib/queryClient";
import { getProject } from "../projects/api";
import { ReviewModal } from "./ReviewModal";
import type { BusinessCaseValues, IntakeFieldDefinition } from "./types";

// FEATURE-042, sección E.7. `projectId` viene de la ruta -- el repositorio se muestra como
// contexto no editable (ver aviso más abajo), nunca se pide en este formulario.
export function DisparoScreen() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const navigate = useNavigate();

  // Sección E.8: guard real de la ruta, no solo el botón que lleva acá -- un deep link directo a
  // /cases/new sin repositorio configurado no debe poder crear un caso (hallazgo real de prueba
  // manual: el botón "Nuevo caso" de CasesList no tenía este chequeo, solo el del header).
  const project = useQuery({
    queryKey: ["projects", projectId],
    enabled: projectId.length > 0,
    queryFn: () => getProject(projectId),
  });

  const [inputText, setInputText] = React.useState("");
  const [mapping, setMapping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [fields, setFields] = React.useState<IntakeFieldDefinition[]>([]);
  const [values, setValues] = React.useState<BusinessCaseValues>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Todos los hooks ya se declararon arriba, en el mismo orden en cada render -- este return
  // condicional recién ahora es seguro (Reglas de Hooks de React).
  if (project.data && !project.data.project.isConfigured) {
    return <Navigate to={`/projects/${projectId}/settings/repository`} replace />;
  }

  const onFileSelected = async (file: File) => {
    const text = await file.text();
    setInputText(text);
  };

  const mapear = async () => {
    if (inputText.trim().length === 0) return;
    setMapping(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/intake/map"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputText }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { fields: IntakeFieldDefinition[]; values: BusinessCaseValues };
      setFields(body.fields);
      setValues(body.values);
      setReviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mapear el texto.");
    } finally {
      setMapping(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Nuevo caso de negocio</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Pegá el texto de un relevamiento o cargá un archivo .md/.txt. El Orquestador va a mapearlo contra los
          campos predeterminados, sin inventar contenido — lo que no encuentre queda vacío para que lo completes vos.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
          <AlertTriangle className="h-3.5 w-3.5" />
          El repositorio de este caso es el que ya configuraste en el proyecto — no se pide acá.
        </p>

        <textarea
          className="mt-4 min-h-64 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          placeholder="Pegá acá el texto libre de la iniciativa..."
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
        />

        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}

        <div className="mt-4 flex items-center justify-between">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFileSelected(file);
              event.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Cargar archivo .md/.txt
          </Button>
          <Button disabled={mapping || inputText.trim().length === 0} onClick={() => void mapear()}>
            {mapping ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Mapear
          </Button>
        </div>
      </div>

      <ReviewModal
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        projectId={projectId}
        repositoryFullName={project.data?.project.repository?.fullName ?? null}
        fields={fields}
        initialValues={values}
        onConfirmed={() => {
          // El warning de creación de rama ya se mostró y confirmó dentro del propio
          // ReviewModal (ver branchConfirmation) -- repetirlo acá con un alert() nativo
          // era redundante y quedaba encima de un flujo que ya terminó.
          setInputText("");
          setFields([]);
          setValues({});
          void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "cases"] });
          navigate(`/projects/${projectId}/cases`);
        }}
      />
    </section>
  );
}
