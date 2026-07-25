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

// FEATURE-017, Regla 4: Rama Base de Trabajo tiene default "main" si el usuario no indica nada,
// pero cuenta como completa con ese default — no exige que el usuario la toque para llegar al 100%.
const RAMA_BASE_KEY = "rama_base_trabajo";
const TIPO_SOLUCION_KEY = "tipo_solucion";
// Sección 7.1: el schema de intake_field_definitions no tiene columna de opciones — las del único
// campo `select` del MVP (tipo_solucion) quedan fijas acá, no leídas de la definición.
const TIPO_SOLUCION_OPTIONS = [
  { value: "nueva", label: "Nueva" },
  { value: "mejora_existente", label: "Mejora existente" },
];

function withDefaults(values: BusinessCaseValues): BusinessCaseValues {
  if (values[RAMA_BASE_KEY]) return values;
  return { ...values, [RAMA_BASE_KEY]: "main" };
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
  fields: IntakeFieldDefinition[];
  inputText: string;
  initialValues: BusinessCaseValues;
  onConfirmed: (run: RunCaseSummary) => void;
}) {
  const [values, setValues] = React.useState<BusinessCaseValues>(() => withDefaults(props.initialValues));
  const [recalculating, setRecalculating] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (props.open) {
      setValues(withDefaults(props.initialValues));
      setError(null);
    }
  }, [props.open, props.initialValues]);

  const percent = completenessPercent(values, props.fields);
  const canContinue = percent === 100 && !confirming;

  const setFieldValue = (fieldKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldKey]: value.length > 0 ? value : null }));
  };

  const recalcular = async () => {
    setRecalculating(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/intake/map"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputText: props.inputText, previousValues: values }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { values: BusinessCaseValues };
      setValues(withDefaults(body.values));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo recalcular el mapeo.");
    } finally {
      setRecalculating(false);
    }
  };

  const confirmar = async () => {
    setConfirming(true);
    setError(null);
    try {
      const response = await fetch(apiUrl("/runs"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessCase: values }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { run: RunCaseSummary };
      props.onConfirmed(body.run);
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
            {percent}% completo ({props.fields.length} campos). Lo que el mapeo no pudo completar queda vacío — nunca
            se inventa contenido.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1 text-sm">
          {props.fields.map((field) => (
            <FieldEditor key={field.field_key} field={field} value={values[field.field_key] ?? null} onChange={setFieldValue} />
          ))}
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={recalculating || confirming} onClick={() => void recalcular()}>
            {recalculating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Recalcular
          </Button>
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

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="font-medium text-zinc-800">{field.label}</label>
        <span className={`text-xs ${isComplete ? "text-emerald-600" : "text-amber-600"}`}>
          {isComplete ? "Completo" : "Vacío"}
        </span>
      </div>
      <p className="text-xs text-zinc-500">{field.description}</p>
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
