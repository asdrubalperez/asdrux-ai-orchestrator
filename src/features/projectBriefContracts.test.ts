import assert from "node:assert/strict";
import test from "node:test";
import { EVALUACION_PRELIMINAR_ITEMS, parseProjectBriefPayload } from "./projectBriefContracts.js";

function validPayload(): Record<string, unknown> {
  return {
    declarativos: {
      identidadSistema: "Sistema nuevo, greenfield.",
      accesoCodigoFuente: "No Aplica",
      restriccionesNegocio: "Ninguna.",
      intencionNegocio: "Reducir tiempo de onboarding.",
    },
    contexto: {
      problema: "Onboarding manual lento.",
      situacionActual: "Se hace por planilla.",
      valorEsperado: "Onboarding automático en minutos.",
    },
    evaluacionPreliminar: EVALUACION_PRELIMINAR_ITEMS.map((item) => ({
      item,
      estado: "No",
      comentario: "",
    })),
    esquemaPreliminar: {
      flujoEsperado: "Usuario completa formulario.",
      sistemasInvolucrados: "Backend de usuarios.",
      integracionesNecesarias: "Ninguna.",
      expuestoInternet: "No.",
    },
    complejidadTecnica: "Baja",
    hallazgos: "",
  };
}

test("parsea PROJECT_BRIEF en forma de objeto estructurado (Claude)", () => {
  const payload = parseProjectBriefPayload({ projectBrief: validPayload() });
  assert.equal(payload.complejidadTecnica, "Baja");
  assert.equal(payload.evaluacionPreliminar.length, EVALUACION_PRELIMINAR_ITEMS.length);
});

test("parsea PROJECT_BRIEF en forma de texto plano (Codex)", () => {
  const line = `PROJECT_BRIEF: ${JSON.stringify(validPayload())}`;
  const payload = parseProjectBriefPayload(`ESTADO: completed\n${line}\nRAZON_ESCALAMIENTO: null`);
  assert.equal(payload.declarativos.identidadSistema, "Sistema nuevo, greenfield.");
});

test("rechaza payload con campos adicionales (schema cerrado)", () => {
  const invalid = { ...validPayload(), extra: true };
  assert.throws(() => parseProjectBriefPayload({ projectBrief: invalid }));
});

test("rechaza si falta alguno de los 8 ítems fijos de evaluación preliminar", () => {
  const invalid = validPayload();
  invalid.evaluacionPreliminar = (invalid.evaluacionPreliminar as unknown[]).slice(0, 7);
  assert.throws(() => parseProjectBriefPayload({ projectBrief: invalid }));
});

test("rechaza estado de evaluación fuera del enum del template", () => {
  const invalid = validPayload();
  const items = invalid.evaluacionPreliminar as Array<Record<string, unknown>>;
  items[0] = { ...items[0], estado: "Tal vez" };
  assert.throws(() => parseProjectBriefPayload({ projectBrief: invalid }));
});

test("rechaza complejidadTecnica fuera de Alta/Media/Baja", () => {
  const invalid = { ...validPayload(), complejidadTecnica: "Extrema" };
  assert.throws(() => parseProjectBriefPayload({ projectBrief: invalid }));
});

test("declarativo vacío no pasa el parser (Architect debe escalar, nunca inventar el valor)", () => {
  const invalid = validPayload();
  (invalid.declarativos as Record<string, unknown>).identidadSistema = "";
  assert.throws(() => parseProjectBriefPayload({ projectBrief: invalid }));
});
