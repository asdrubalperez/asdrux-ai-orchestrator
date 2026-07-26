import type { IntakeFieldDefinitionRow } from "../db/repository.js";

// FEATURE-017, Regla 5 y sección 7.3: llamada directa y simple al proveedor, sin
// runRoleIsolated/holder/worker/Docker — no hay tools que dar, así que no existe el problema que
// ese aislamiento resuelve (canal de respuesta con tools + credencial real). Usa la misma
// ANTHROPIC_API_KEY que ya vive en el backend del Orquestador, vía fetch nativo a la Messages API
// (no hay SDK de Anthropic como dependencia en este repo — ver executor/claudeCodeExecutor.ts).
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// FEATURE-017, Scope/Excluido #5: sin elección de proveedor/modelo expuesta al usuario — default
// fijo del sistema, mismo criterio que las fases reales sin override. Modelo económico: esta
// llamada es extracción estructurada de texto, no razonamiento complejo.
const DEFAULT_MAPPING_MODEL = "claude-haiku-4-5-20251001";

export type BusinessCaseValues = Record<string, string | null>;

export function buildMappingPrompt(
  inputText: string,
  fields: IntakeFieldDefinitionRow[],
  previousValues?: BusinessCaseValues
): { system: string; user: string } {
  const fieldsDescription = fields
    .map((field) => `- "${field.field_key}" (${field.field_type}): ${field.label} — ${field.description}`)
    .join("\n");

  const system = [
    "Sos un mapeador de texto libre a una estructura de campos predeterminada.",
    "Reglas estrictas:",
    "1. NUNCA inventes contenido. Si el texto de entrada no menciona algo relacionado a un campo, ese campo va en null.",
    "2. No dialogues con el usuario ni hagas preguntas de seguimiento — esta es una única llamada.",
    "3. Respondé EXCLUSIVAMENTE con un objeto JSON plano, sin texto antes ni después, sin markdown, sin bloques de código.",
    "4. El JSON debe tener exactamente estas claves, cada una con un valor string o null:",
    fieldsDescription,
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
    result[field.field_key] = typeof value === "string" && value.trim().length > 0 ? value : null;
  }
  return result;
}

export async function mapBusinessCase(params: {
  inputText: string;
  fields: IntakeFieldDefinitionRow[];
  previousValues?: BusinessCaseValues;
}): Promise<BusinessCaseValues> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY no está definida en el entorno del proceso.");
  }

  const { system, user } = buildMappingPrompt(params.inputText, params.fields, params.previousValues);

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_MAPPING_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic Messages API respondió ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
  const textBlock = payload.content?.find((block) => block.type === "text" && typeof block.text === "string");
  if (!textBlock?.text) {
    throw new Error("La respuesta del modelo no tiene contenido de texto.");
  }

  return parseMappingResponse(textBlock.text, params.fields);
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
