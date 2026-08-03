import type { IntakeFieldDefinitionRow } from "../db/repository.js";
import type { ResolvedExecutorAuthentication } from "../auth/aiCredentialService.js";
import type { ExecutorProviderName } from "../db/repository.js";
import { selectIntakeMappingAdapter } from "./intakeMappingAdapters.js";

// FEATURE-017, Regla 5: sin runRoleIsolated/pipeline -- no hay run, no hay artifact, no hay
// escalamiento. FEATURE-025-Parte-3, sección 3.1: API key sigue siendo HTTP directo sin Docker
// (secreto sin estado materializado); OAuth reutiliza el holder Docker de los roles reales, sin
// worker (sesión materializada real procesando texto no confiable). La selección entre los 4
// caminos vive en intakeMappingAdapters.ts -- este módulo solo conoce el contrato común
// (buildMappingPrompt/parseMappingResponse), nunca la forma específica de cada proveedor.
export type BusinessCaseValues = Record<string, string | null>;

// FEATURE-031: el mapping de tipo_solucion se equivocaba al interpretar palabras aisladas ("existe")
// sin considerar el sentido completo de la oración, en particular negaciones ("no existe") y
// menciones de soluciones de terceros/sistemas relacionados que no son el objeto de la iniciativa.
// Reglas hardcodeadas acá (no en la columna `description` de intake_field_definitions, que es
// puramente descriptiva) — mismo criterio de especialización por field_key que ya usa
// web/src/intake/ReviewModal.tsx para el <select> de este campo.
const TIPO_SOLUCION_FIELD_KEY = "tipo_solucion";
const TIPO_SOLUCION_ALLOWED_VALUES = new Set(["nueva", "mejora_existente"]);

const TIPO_SOLUCION_CLASSIFICATION_RULES = [
  'Reglas adicionales para clasificar el campo "tipo_solucion":',
  '- Valores permitidos: "nueva", "mejora_existente", o null. Nunca uses ni inventes otro valor.',
  '- Considerá el sentido completo de la oración, nunca una palabra aislada (ej. "existe", "actual", ' +
    '"sistema", "nueva", "mejora", "reemplazo") para decidir.',
  '- Una negación debe interpretarse junto con lo que modifica: "no existe una solución" significa que ' +
    'la solución NO existe -> "nueva". La palabra "existe" dentro de una negación no es evidencia de ' +
    'una solución existente.',
  '- "mejora_existente" exige DOS condiciones a la vez: (a) ya existe una solución/sistema/herramienta ' +
    'que sea el objeto de la iniciativa, Y (b) la iniciativa busca modificarla, ampliarla, corregirla, ' +
    'reemplazarla o mejorarla. Si falta cualquiera de las dos, no es "mejora_existente".',
  '- Una solución de terceros, un competidor, o un sistema relacionado con el que la solución deberá ' +
    'integrarse NO cuenta como "la solución existente" salvo que sea explícitamente el objeto de la ' +
    'iniciativa. Su sola mención no determina el valor.',
  '- Si la entrada no permite determinar con claridad si la iniciativa crea algo inexistente o mejora ' +
    'algo existente, el valor es null. No elijas el valor que te parezca más probable.',
  "Ejemplos:",
  '  "Actualmente no existe una solución para resolver este problema." -> "nueva" (negación de "existe").',
  '  "Existe una herramienta interna que necesita nuevas funcionalidades." -> "mejora_existente" ' +
    '(existe + se modifica).',
  '  "No existe actualmente una herramienta adecuada." -> "nueva" (la palabra "existe" está negada por "no").',
  '  "Existen aplicaciones similares en el mercado, pero la organización no tiene una solución propia." ' +
    '-> "nueva" (lo que existe es de terceros, no el objeto de la iniciativa).',
  '  "La solución deberá integrarse con el sistema existente de facturación." -> null (el sistema ' +
    'existente no es el objeto de la iniciativa, no alcanza para determinar tipo_solucion).',
  '  "Se desarrollará una solución para optimizar la operación." -> null (ambiguo, sin evidencia de ' +
    'inexistencia ni de mejora).',
].join("\n");

export function buildMappingPrompt(
  inputText: string,
  fields: IntakeFieldDefinitionRow[],
  previousValues?: BusinessCaseValues
): { system: string; user: string } {
  const fieldsDescription = fields
    .map((field) => `- "${field.field_key}" (${field.field_type}): ${field.label} — ${field.description}`)
    .join("\n");

  const hasTipoSolucion = fields.some((field) => field.field_key === TIPO_SOLUCION_FIELD_KEY);

  const system = [
    "Sos un mapeador de texto libre a una estructura de campos predeterminada.",
    "Reglas estrictas:",
    "1. NUNCA inventes contenido. Si el texto de entrada no menciona algo relacionado a un campo, ese campo va en null.",
    "2. No dialogues con el usuario ni hagas preguntas de seguimiento — esta es una única llamada.",
    "3. Respondé EXCLUSIVAMENTE con un objeto JSON plano, sin texto antes ni después, sin markdown, sin bloques de código.",
    "4. El JSON debe tener exactamente estas claves, cada una con un valor string o null:",
    fieldsDescription,
    ...(hasTipoSolucion ? ["", TIPO_SOLUCION_CLASSIFICATION_RULES] : []),
  ].join("\n");

  const editedFieldsNote =
    previousValues && Object.keys(previousValues).length > 0
      ? [
          "",
          "Valores ya completados a mano por el usuario (no los pierdas ni los reemplaces por otra cosa; el mapeo puede completar los campos que sigan vacíos):",
          JSON.stringify(previousValues, null, 2),
        ].join("\n")
      : "";

  const user = ["TEXTO DE ENTRADA:", "", inputText, editedFieldsNote].join("\n");

  return { system, user };
}

export function parseMappingResponse(raw: string, fields: IntakeFieldDefinitionRow[]): BusinessCaseValues {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`El modelo no devolvió JSON válido: ${(err as Error).message}\nRespuesta: ${raw}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`El modelo devolvió un JSON que no es un objeto plano.\nRespuesta: ${raw}`);
  }

  const record = parsed as Record<string, unknown>;
  const result: BusinessCaseValues = {};
  for (const field of fields) {
    const value = record[field.field_key];
    const stringValue = typeof value === "string" && value.trim().length > 0 ? value : null;
    // FEATURE-031, Regla 5.1 / Restricción obligatoria #1: tipo_solucion no puede contener valores
    // fuera del dominio permitido, sin importar lo que el modelo haya devuelto — la validación de
    // dominio es del código, no queda librada a que el prompt se respete siempre.
    result[field.field_key] =
      field.field_key === TIPO_SOLUCION_FIELD_KEY &&
      stringValue !== null &&
      !TIPO_SOLUCION_ALLOWED_VALUES.has(stringValue)
        ? null
        : stringValue;
  }
  return result;
}

// FEATURE-025-Parte-3, sección 7.13: timeout propio del mapeo de intake, independiente de los
// timeouts largos de fase del pipeline (ARCHITECT_TIMEOUT_MS y similares en runStart.ts) -- esto es
// una única llamada corta, no una fase con tools/iteraciones.
function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
export const INTAKE_MAPPING_TIMEOUT_MS = parsePositiveIntEnv("INTAKE_MAPPING_TIMEOUT_MS", 60_000);

export async function mapBusinessCase(params: {
  inputText: string;
  fields: IntakeFieldDefinitionRow[];
  previousValues?: BusinessCaseValues;
  provider: ExecutorProviderName;
  /** Modelo resuelto por el caller; si no hay uno configurado, cada adaptador usa su default económico. */
  model: string | null;
  /**
   * FEATURE-025-Parte-1/2/3: resuelta por el caller (`mapIntakeText`, contra la credencial propia
   * del usuario para el rol "intake") -- sin fallback a una variable de entorno global, mismo
   * criterio que los Executors de los 5 roles reales. Determina qué adaptador se usa (sección 3.1):
   * api_key -> HTTP directo; cli_session -> holder Docker de los roles reales, sin worker.
   */
  authentication: ResolvedExecutorAuthentication;
  timeoutMs?: number;
}): Promise<BusinessCaseValues> {
  const { system, user } = buildMappingPrompt(params.inputText, params.fields, params.previousValues);
  const adapter = selectIntakeMappingAdapter(params.provider, params.authentication);
  const rawText = await adapter.map({
    systemPrompt: system,
    userPrompt: user,
    model: params.model,
    timeoutMs: params.timeoutMs ?? INTAKE_MAPPING_TIMEOUT_MS,
  });
  return parseMappingResponse(rawText, params.fields);
}

/** FEATURE-017, Estrategia Algorítmica: campos_completos / 12 * 100, redondeado. */
export function completenessPercent(values: BusinessCaseValues, fields: IntakeFieldDefinitionRow[]): number {
  if (fields.length === 0) return 0;
  const complete = fields.filter((field) => {
    const value = values[field.field_key];
    return typeof value === "string" && value.trim().length > 0;
  }).length;
  return Math.round((complete / fields.length) * 100);
}
