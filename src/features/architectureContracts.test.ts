import assert from "node:assert/strict";
import test from "node:test";
import { deriveSeveridad, parseArchitecturePayload, type NivelRiesgo, type Severidad } from "./architectureContracts.js";

function validPayload(): Record<string, unknown> {
  return {
    analisisTecnico: {
      descripcionMacro: "Módulo interno puro.",
      backend: "Ninguno adicional.",
      frontend: "No aplica.",
      basesDatos: "Ninguna.",
      integracionesApis: "Ninguna.",
      requiereInfraestructura: { valor: "No", detalle: "" },
      consumeServiciosExternos: { valor: "No", detalle: "" },
      tecnologiaNuevaProducto: { valor: "No", detalle: "" },
    },
    componentes: [{ nombre: "calculateTip", tipo: "función", descripcion: "Cálculo puro." }],
    riesgos: [
      { situacionAnalizada: "Redondeo incorrecto.", riesgo: "Bajo", impacto: "Medio", accionRecomendada: "Tests unitarios." },
    ],
    hallazgos: "",
  };
}

test("parsea ARCHITECTURE en forma de objeto estructurado (Claude)", () => {
  const payload = parseArchitecturePayload({ architecture: validPayload() });
  assert.equal(payload.analisisTecnico.descripcionMacro, "Módulo interno puro.");
  assert.equal(payload.componentes.length, 1);
  assert.equal(payload.riesgos[0].severidad, "Baja");
});

test("parsea ARCHITECTURE en forma de texto plano (Codex)", () => {
  const line = `ARCHITECTURE: ${JSON.stringify(validPayload())}`;
  const payload = parseArchitecturePayload(`ESTADO: completed\n${line}\nRAZON_ESCALAMIENTO: null`);
  assert.equal(payload.componentes[0].nombre, "calculateTip");
});

test("rechaza payload con campos adicionales (schema cerrado)", () => {
  const invalid = { ...validPayload(), roadmap: { releases: [] } };
  assert.throws(() => parseArchitecturePayload({ architecture: invalid }));
});

test("rechaza payload sin analisisTecnico/componentes/riesgos/hallazgos", () => {
  const invalid = validPayload();
  delete (invalid as Record<string, unknown>).hallazgos;
  assert.throws(() => parseArchitecturePayload({ architecture: invalid }));
});

test("rechaza riesgo/impacto fuera de Bajo/Medio/Alto", () => {
  const invalid = validPayload();
  const riesgos = invalid.riesgos as Array<Record<string, unknown>>;
  riesgos[0] = { ...riesgos[0], riesgo: "Extremo" };
  assert.throws(() => parseArchitecturePayload({ architecture: invalid }));
});

test("rechaza valor de condición técnica fuera de Sí/No", () => {
  const invalid = validPayload();
  (invalid.analisisTecnico as Record<string, unknown>).requiereInfraestructura = { valor: "Tal vez", detalle: "" };
  assert.throws(() => parseArchitecturePayload({ architecture: invalid }));
});

test("no acepta 'severidad' declarada por el modelo -- el parser siempre la deriva", () => {
  const withSeveridad = validPayload();
  (withSeveridad.riesgos as Array<Record<string, unknown>>)[0].severidad = "Alta";
  assert.throws(() => parseArchitecturePayload({ architecture: withSeveridad }));
});

test("deriveSeveridad coincide exactamente con la matriz del Runbook (02-ARCHITECTURE-TEMPLATE.md §3)", () => {
  const expected: Array<[NivelRiesgo, NivelRiesgo, Severidad]> = [
    ["Bajo", "Bajo", "Baja"],
    ["Bajo", "Medio", "Baja"],
    ["Bajo", "Alto", "Media"],
    ["Medio", "Bajo", "Baja"],
    ["Medio", "Medio", "Alta"],
    ["Medio", "Alto", "Alta"],
    ["Alto", "Bajo", "Media"],
    ["Alto", "Medio", "Alta"],
    ["Alto", "Alto", "Alta"],
  ];
  for (const [riesgo, impacto, severidad] of expected) {
    assert.equal(deriveSeveridad(riesgo, impacto), severidad, `${riesgo}+${impacto} debería ser ${severidad}`);
  }
});
