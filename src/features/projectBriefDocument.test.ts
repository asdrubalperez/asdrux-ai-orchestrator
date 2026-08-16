import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { projectBriefTemplateMetadata, renderProjectBriefDocument } from "./projectBriefDocument.js";
import { EVALUACION_PRELIMINAR_ITEMS, type ProjectBriefPayload } from "./projectBriefContracts.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const payload: ProjectBriefPayload = {
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
  evaluacionPreliminar: EVALUACION_PRELIMINAR_ITEMS.map((item, index) => ({
    item,
    estado: index === 0 ? ("Sí" as const) : ("No" as const),
    comentario: index === 0 ? "Reutiliza el módulo de usuarios." : "",
  })),
  esquemaPreliminar: {
    flujoEsperado: "Usuario completa formulario, sistema crea cuenta.",
    sistemasInvolucrados: "Backend de usuarios.",
    integracionesNecesarias: "Ninguna.",
    expuestoInternet: "No.",
  },
  complejidadTecnica: "Baja",
  hallazgos: "",
};

test("renderiza las 6 secciones del template en orden fijo", () => {
  const projection = renderProjectBriefDocument(payload);
  assert.match(projection.markdown, /## 0\. Chequeo Declarativo/);
  assert.match(projection.markdown, /## 1\. Contexto de la Iniciativa/);
  assert.match(projection.markdown, /## 2\. Evaluación Preliminar/);
  assert.match(projection.markdown, /## 3\. Esquema Preliminar de Solución \(TO BE\)/);
  assert.match(projection.markdown, /## 4\. Conclusión/);
  assert.match(projection.markdown, /## 5\. Hallazgos y Anomalías/);
  assert.ok(projection.markdown.indexOf("## 0.") < projection.markdown.indexOf("## 1."));
  assert.ok(projection.markdown.indexOf("## 1.") < projection.markdown.indexOf("## 5."));
  assert.ok(projection.markdown.endsWith("\n"));
  assert.doesNotMatch(projection.markdown, /\r/);
});

test("proyección es determinista", () => {
  const a = renderProjectBriefDocument(payload).markdown;
  const b = renderProjectBriefDocument(payload).markdown;
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
});

test("los 8 ítems de evaluación preliminar aparecen con su estado", () => {
  const markdown = renderProjectBriefDocument(payload).markdown;
  for (const item of EVALUACION_PRELIMINAR_ITEMS) {
    assert.ok(markdown.includes(item), `falta el ítem: ${item}`);
  }
});

test("sin hallazgos declarados, cae al placeholder explícito", () => {
  const markdown = renderProjectBriefDocument(payload).markdown;
  assert.match(markdown, /Sin hallazgos\./);
});

test("metadata conserva versión, hash y snapshot del asset distribuido", () => {
  const metadata = projectBriefTemplateMetadata({
    runbookVersion: "v1.0",
    assetRelativePath: "01-PROJECT-BRIEF-TEMPLATE.md",
    assetHash: "abc123",
    content: "# Template\n",
  });

  assert.equal(metadata.templateVersion, "v1.0");
  assert.equal(metadata.templateHash, "abc123");
  assert.deepEqual(metadata.templateSnapshot.descriptor, {
    key: "runbook-project-brief",
    version: "v1.0",
    sections: [
      "declarative_gate",
      "context",
      "preliminary_evaluation",
      "preliminary_schema",
      "conclusion",
      "findings",
    ],
  });
});
