import { test } from "node:test";
import assert from "node:assert/strict";
import type { IntakeFieldDefinitionRow } from "../db/repository.js";
import { buildMappingPrompt, completenessPercent, parseMappingResponse } from "./mapBusinessCase.js";

function field(key: string, order: number): IntakeFieldDefinitionRow {
  return {
    id: `field-${key}`,
    field_key: key,
    field_order: order,
    label: key,
    description: `descripción de ${key}`,
    field_type: "text",
    updated_at: new Date(0).toISOString(),
  };
}

const FIELDS = [field("vision", 1), field("canales", 2)];

test("buildMappingPrompt incluye las claves de campo y el texto de entrada, sin ediciones previas", () => {
  const { system, user } = buildMappingPrompt("texto de relevamiento", FIELDS);
  assert.match(system, /"vision"/);
  assert.match(system, /"canales"/);
  assert.match(system, /NUNCA inventes contenido/);
  assert.match(user, /texto de relevamiento/);
  assert.doesNotMatch(user, /ya completados a mano/);
});

test("buildMappingPrompt incluye los valores ya editados a mano cuando se pasan", () => {
  const { user } = buildMappingPrompt("texto", FIELDS, { vision: "ya completado" });
  assert.match(user, /ya completados a mano/);
  assert.match(user, /ya completado/);
});

test("parseMappingResponse extrae solo las claves definidas, vacíos como null", () => {
  const raw = JSON.stringify({ vision: "una visión clara", canales: "", inventado: "no debería aparecer" });
  const result = parseMappingResponse(raw, FIELDS);
  assert.deepEqual(result, { vision: "una visión clara", canales: null });
});

test("parseMappingResponse tolera fences de markdown alrededor del JSON", () => {
  const raw = "```json\n" + JSON.stringify({ vision: "x", canales: null }) + "\n```";
  const result = parseMappingResponse(raw, FIELDS);
  assert.deepEqual(result, { vision: "x", canales: null });
});

test("parseMappingResponse rechaza salida que no es JSON", () => {
  assert.throws(() => parseMappingResponse("esto no es JSON", FIELDS));
});

test("parseMappingResponse rechaza un JSON que no es un objeto plano", () => {
  assert.throws(() => parseMappingResponse("[1,2,3]", FIELDS));
});

test("completenessPercent calcula sobre el total de campos definidos, redondeado", () => {
  assert.equal(completenessPercent({ vision: "algo", canales: null }, FIELDS), 50);
  assert.equal(completenessPercent({ vision: "algo", canales: "otro" }, FIELDS), 100);
  assert.equal(completenessPercent({ vision: null, canales: null }, FIELDS), 0);
  assert.equal(completenessPercent({ vision: "   ", canales: "otro" }, FIELDS), 50);
});

// FEATURE-031

const FIELDS_WITH_TIPO_SOLUCION = [field("tipo_solucion", 1), ...FIELDS];

test("buildMappingPrompt agrega las reglas de clasificación de tipo_solucion solo cuando ese campo está presente", () => {
  const withField = buildMappingPrompt("texto", FIELDS_WITH_TIPO_SOLUCION);
  assert.match(withField.system, /Reglas adicionales para clasificar el campo "tipo_solucion"/);
  assert.match(withField.system, /negación de "existe"/);
  assert.match(withField.system, /mejora_existente" exige DOS condiciones/);

  const withoutField = buildMappingPrompt("texto", FIELDS);
  assert.doesNotMatch(withoutField.system, /tipo_solucion/);
});

test("parseMappingResponse acepta los dos valores válidos de tipo_solucion", () => {
  assert.equal(
    parseMappingResponse(JSON.stringify({ tipo_solucion: "nueva" }), FIELDS_WITH_TIPO_SOLUCION).tipo_solucion,
    "nueva"
  );
  assert.equal(
    parseMappingResponse(JSON.stringify({ tipo_solucion: "mejora_existente" }), FIELDS_WITH_TIPO_SOLUCION)
      .tipo_solucion,
    "mejora_existente"
  );
});

test("parseMappingResponse descarta cualquier valor de tipo_solucion fuera del dominio permitido (Regla 5.1)", () => {
  assert.equal(
    parseMappingResponse(JSON.stringify({ tipo_solucion: "otra_cosa" }), FIELDS_WITH_TIPO_SOLUCION).tipo_solucion,
    null
  );
  assert.equal(
    parseMappingResponse(JSON.stringify({ tipo_solucion: null }), FIELDS_WITH_TIPO_SOLUCION).tipo_solucion,
    null
  );
});

test("canales se mapea como texto plano, sin ningún tratamiento especial por su field_type", () => {
  const listField: IntakeFieldDefinitionRow = { ...field("canales", 1), field_type: "textarea" };
  const result = parseMappingResponse(
    JSON.stringify({ canales: "Portal web y atención telefónica." }),
    [listField]
  );
  assert.equal(result.canales, "Portal web y atención telefónica.");
});
