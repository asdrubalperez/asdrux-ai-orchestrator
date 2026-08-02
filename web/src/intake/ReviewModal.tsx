import React from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiUrl } from "../lib/api";
import type { BusinessCaseValues, IntakeFieldDefinition, RunCaseSummary } from "./types";

// FEATURE-042, sección B.9: el repositorio deja de pedirse en el intake -- se obtiene siempre
// desde el proyecto activo. `rama_base_trabajo` sigue siendo del caso (Regla D.9/E.7).
const RAMA_BASE_KEY = "rama_base_trabajo";
const REPOSITORIO_KEY = "repositorio";
const TIPO_SOLUCION_KEY = "tipo_solucion";
const TIPO_SOLUCION_OPTIONS = [
  { value: "nueva", label: "Nueva" },
  { value: "mejora_existente", label: "Mejora de una solución ya existente" },
];

// Mismo criterio de slug que suggestBranchName (src/auth/branchValidationService.ts) -- se
// duplica en el frontend porque es una sugerencia editable, no una validación de autoridad (esa
// vive en el backend, D.9, y se revalida igual al confirmar).
function suggestBranchName(seed: string): string {
  const slug = seed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `feature/${slug || "caso"}`;
}

function withDefaults(values: BusinessCaseValues, fields: IntakeFieldDefinition[]): BusinessCaseValues {
  if (values[RAMA_BASE_KEY]) return values;
  const seedField = fields.find((f) => f.field_key !== RAMA_BASE_KEY && f.field_key !== REPOSITORIO_KEY);
  const seed = seedField ? (values[seedField.field_key] ?? "") : "";
  return { ...values, [RAMA_BASE_KEY]: suggestBranchName(seed) };
}

function completenessPercent(values: BusinessCaseValues, fields: IntakeFieldDefinition[]): number {
  if (fields.length === 0) return 0;
  const complete = fields.filter((field) => {
    const value = values[field.field_key];
    return typeof value === "string" && value.trim().length > 0;
  }).length;
  return Math.round((complete / fields.length) * 100);
}

export function ReviewModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  fields: IntakeFieldDefinition[];
  initialValues: BusinessCaseValues;
  onConfirmed: (run: RunCaseSummary, branchWarning: string | null) => void;
}) {
  // Sección B.9: el repositorio no se pide más en el intake nuevo.
  const visibleFields = props.fields.filter((f) => f.field_key !== REPOSITORIO_KEY);
  const [values, setValues] = React.useState<BusinessCaseValues>(() => withDefaults(props.initialValues, visibleFields));
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (props.open) {
      setValues(withDefaults(props.initialValues, visibleFields));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initialValues]);

  const percent = completenessPercent(values, visibleFields);
  const canContinue = percent === 100 && !confirming;

  const setFieldValue = (fieldKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldKey]: value.length > 0 ? value : null }));
  };

  const confirmar = async () => {
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/projects/${encodeURIComponent(props.projectId)}/cases`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessCase: values }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? "La rama indicada no se puede usar en este repositorio.");
        return;
      }
      if (response.status === 409) {
        const body = (await response.json()) as { error?: string; message?: string };
        setError(
          body.error === "project_not_configured"
            ? "Este proyecto todavía no tiene repositorio configurado."
            : (body.message ?? "No se pudo confirmar el caso.")
        );
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { run: RunCaseSummary; branchWarning: string | null };
      props.onConfirmed(body.run, body.branchWarning);
      props.onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el caso.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisión del caso de negocio</DialogTitle>
          <DialogDescription>
            {percent}% completo ({visibleFields.length} campos). Lo que el mapeo no pudo completar queda vacío — nunca
            se inventa contenido.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1 text-sm">
          {visibleFields.map((field) => (
            <FieldEditor key={field.field_key} field={field} value={values[field.field_key] ?? null} onChange={setFieldValue} />
          ))}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button disabled={!canContinue} onClick={() => void confirmar()}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: IntakeFieldDefinition;
  value: string | null;
  onChange: (fieldKey: string, value: string) => void;
}) {
  const isComplete = typeof value === "string" && value.trim().length > 0;
  const isBranchField = field.field_key === RAMA_BASE_KEY;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="font-medium text-zinc-800">{field.label}</label>
        <span className={`text-xs ${isComplete ? "text-emerald-600" : "text-amber-600"}`}>
          {isComplete ? "Completo" : "Vacío"}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        {isBranchField ? "Sugerida automáticamente. Podés editarla antes de confirmar." : field.description}
      </p>
      {field.field_key === TIPO_SOLUCION_KEY ? (
        <select
          className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          value={value ?? ""}
          onChange={(event) => onChange(field.field_key, event.target.value)}
        >
          <option value="">Sin especificar</option>
          {TIPO_SOLUCION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.field_type === "textarea" || field.field_type === "list" ? (
        <textarea
          className="min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          value={value ?? ""}
          onChange={(event) => onChange(field.field_key, event.target.value)}
        />
      ) : (
        <Input value={value ?? ""} onChange={(event) => onChange(field.field_key, event.target.value)} />
      )}
    </div>
  );
}
