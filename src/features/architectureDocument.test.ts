import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { architectureTemplateMetadata, renderArchitectureDocument } from "./architectureDocument.js";
import type { ArchitecturePayload } from "./architectureContracts.js";
import type { RoadmapApprovalPayload } from "../cli/escalation.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const payload: ArchitecturePayload = {
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
    {
      situacionAnalizada: "Redondeo incorrecto.",
      riesgo: "Bajo",
      impacto: "Medio",
      severidad: "Baja",
      accionRecomendada: "Tests unitarios.",
    },
  ],
  hallazgos: "",
};

const roadmap: RoadmapApprovalPayload = {
  releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Cálculo de propina.", estado: "Activo" }],
  activeReleaseId: "r1",
};

test("renderiza las 5 secciones del template en orden fijo, con §0 desde el Roadmap aprobado", () => {
  const projection = renderArchitectureDocument(payload, roadmap);
  assert.match(projection.markdown, /## 0\. Roadmap de Releases/);
  assert.match(projection.markdown, /## 1\. Análisis Técnico/);
  assert.match(projection.markdown, /## 2\. Componentes Técnicos/);
  assert.match(projection.markdown, /## 3\. Análisis de Riesgo/);
  assert.match(projection.markdown, /## 4\. Hallazgos y Anomalías/);
  assert.ok(projection.markdown.indexOf("## 0.") < projection.markdown.indexOf("## 1."));
  assert.ok(projection.markdown.indexOf("## 3.") < projection.markdown.indexOf("## 4."));
  assert.match(projection.markdown, /MVP/);
  assert.match(projection.markdown, /Activo/);
  assert.ok(projection.markdown.endsWith("\n"));
  assert.doesNotMatch(projection.markdown, /\r/);
});

test("el payload de Architect no aporta el Roadmap -- §0 sale exclusivamente de approvedRoadmap", () => {
  const otherRoadmap: RoadmapApprovalPayload = {
    releases: [{ id: "r9", nombre: "Otro Release", alcanceResumen: "Otro alcance.", estado: "Pendiente" }],
    activeReleaseId: null,
  };
  const markdown = renderArchitectureDocument(payload, otherRoadmap).markdown;
  assert.match(markdown, /Otro Release/);
  assert.doesNotMatch(markdown, /MVP/);
});

test("la tabla de riesgo imprime la severidad ya derivada, sin recalcularla", () => {
  const markdown = renderArchitectureDocument(payload, roadmap).markdown;
  assert.match(markdown, /Redondeo incorrecto\..*\| Bajo \| Medio \| Baja \|/);
});

test("proyección es determinista", () => {
  const a = renderArchitectureDocument(payload, roadmap).markdown;
  const b = renderArchitectureDocument(payload, roadmap).markdown;
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
});

test("sin hallazgos declarados, cae al placeholder explícito", () => {
  const markdown = renderArchitectureDocument(payload, roadmap).markdown;
  assert.match(markdown, /Sin hallazgos\./);
});

test("metadata conserva versión, hash y snapshot del asset distribuido", () => {
  const metadata = architectureTemplateMetadata({
    runbookVersion: "v1.0",
    assetRelativePath: "02-ARCHITECTURE-TEMPLATE.md",
    assetHash: "abc123",
    content: "# Template\n",
  });

  assert.equal(metadata.templateVersion, "v1.0");
  assert.equal(metadata.templateHash, "abc123");
  assert.deepEqual(metadata.templateSnapshot.descriptor, {
    key: "runbook-architecture",
    version: "v1.0",
    sections: ["roadmap", "technical_analysis", "components", "risk_analysis", "findings"],
  });
});
