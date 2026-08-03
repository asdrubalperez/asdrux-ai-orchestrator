import assert from "node:assert/strict";
import test from "node:test";
import {
  activeReleaseFromRoadmap,
  artifactsAreEquivalent,
  buildEscalationContext,
  buildReentryContext,
  canonicalJson,
  classifyGateEscalation,
  extractMergeApproval,
  extractReleasePlanDeclaration,
  extractRoadmapApproval,
  isFeatureContinuationContext,
  isMergeApprovalPayload,
  isNotApplicableOutput,
  isReentryContext,
  isReleaseCompletionEscalation,
  isReleasePlanDeclaration,
  isRoadmapApprovalPayload,
  parsePipelineDefinitionRow,
  predecessorRoleFor,
} from "./escalation.js";

test("canonicalJson ordena claves de objetos anidados", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), canonicalJson({ a: { c: 3, d: 4 }, b: 2 }));
});

test("artifactsAreEquivalent ignora orden de claves pero preserva arrays", () => {
  assert.equal(artifactsAreEquivalent({ steps: [{ b: 2, a: 1 }] }, { steps: [{ a: 1, b: 2 }] }), true);
  assert.equal(artifactsAreEquivalent({ steps: [1, 2] }, { steps: [2, 1] }), false);
});

test("parsePipelineDefinitionRow rechaza definitions sin phases validas", () => {
  assert.throws(
    () => parsePipelineDefinitionRow({ name: "x", version: 1, definition: { phases: [{ agentRole: "ghost" }] } }),
    /Definición de pipeline inválida/
  );
});

const VALID_ROADMAP = {
  releases: [
    { id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" },
    { id: "r2", nombre: "Fase 2", alcanceResumen: "Resto del alcance.", estado: "Pendiente" },
  ],
  activeReleaseId: "r1",
};

test("isRoadmapApprovalPayload acepta un roadmap válido con release activo existente", () => {
  assert.equal(isRoadmapApprovalPayload(VALID_ROADMAP), true);
});

test("isRoadmapApprovalPayload rechaza forma inválida (FEATURE-018, riesgo H12)", () => {
  assert.equal(isRoadmapApprovalPayload(null), false);
  assert.equal(isRoadmapApprovalPayload({ releases: [], activeReleaseId: "r1" }), false);
  assert.equal(
    isRoadmapApprovalPayload({ releases: [{ id: "r1" }], activeReleaseId: "r1" }),
    false
  );
  assert.equal(
    isRoadmapApprovalPayload({ ...VALID_ROADMAP, activeReleaseId: "no-existe" }),
    false
  );
});

test("activeReleaseFromRoadmap devuelve el release marcado como activo", () => {
  assert.deepEqual(activeReleaseFromRoadmap(VALID_ROADMAP), VALID_ROADMAP.releases[0]);
});

test("activeReleaseFromRoadmap devuelve null si el valor no es un roadmap válido", () => {
  assert.equal(activeReleaseFromRoadmap(null), null);
  assert.equal(activeReleaseFromRoadmap({ foo: "bar" }), null);
});

// FEATURE-036: activeReleaseId nullable representa ausencia real de release activo (proyecto
// cerrado sin release siguiente) — antes de esta Feature, ese estado no era representable y
// `activeReleaseId` seguía apuntando al último release, ya "Completado".

const CLOSED_ROADMAP = {
  releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Completado" }],
  activeReleaseId: null,
};

test("isRoadmapApprovalPayload acepta un roadmap cerrado (activeReleaseId null, ningún release Activo)", () => {
  assert.equal(isRoadmapApprovalPayload(CLOSED_ROADMAP), true);
});

test("isRoadmapApprovalPayload rechaza activeReleaseId apuntando a un release no Activo (Escenario 3)", () => {
  assert.equal(
    isRoadmapApprovalPayload({
      releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Completado" }],
      activeReleaseId: "r1",
    }),
    false
  );
});

test("isRoadmapApprovalPayload rechaza activeReleaseId null cuando hay un release Activo (Escenario 4)", () => {
  assert.equal(isRoadmapApprovalPayload({ ...VALID_ROADMAP, activeReleaseId: null }), false);
});

test("isRoadmapApprovalPayload rechaza activeReleaseId no nulo sin ningún release Activo (Escenario 5)", () => {
  assert.equal(
    isRoadmapApprovalPayload({
      releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Pendiente" }],
      activeReleaseId: "r1",
    }),
    false
  );
});

test("isRoadmapApprovalPayload rechaza varios releases Activo simultáneos (Escenario 6)", () => {
  assert.equal(
    isRoadmapApprovalPayload({
      releases: [
        { id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" },
        { id: "r2", nombre: "Fase 2", alcanceResumen: "Resto del alcance.", estado: "Activo" },
      ],
      activeReleaseId: "r1",
    }),
    false
  );
});

test("isRoadmapApprovalPayload rechaza activeReleaseId distinto del release realmente Activo (Escenario 7)", () => {
  assert.equal(
    isRoadmapApprovalPayload({
      releases: [
        { id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" },
        { id: "r2", nombre: "Fase 2", alcanceResumen: "Resto del alcance.", estado: "Pendiente" },
      ],
      activeReleaseId: "r2",
    }),
    false
  );
});

test("activeReleaseFromRoadmap devuelve null cuando activeReleaseId es null", () => {
  assert.equal(activeReleaseFromRoadmap(CLOSED_ROADMAP), null);
});

test("activeReleaseFromRoadmap devuelve null si el release referenciado no está Activo, incluso con forma válida", () => {
  // Defensa local (Regla 8): un payload que ya pasó isRoadmapApprovalPayload no debería llegar
  // nunca en este estado, pero el helper no debe confiar únicamente en la coincidencia de ID.
  assert.equal(
    activeReleaseFromRoadmap({
      releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Completado" }],
      activeReleaseId: "r1",
    }),
    null
  );
});

// FEATURE-019

const VALID_RELEASE_PLAN_DECLARATION = {
  features: [
    { id: "f1", nombre: "Feature 1", estado: "Completada" },
    { id: "f2", nombre: "Feature 2", estado: "En curso" },
  ],
  featureActualId: "f2",
};

test("isReleasePlanDeclaration acepta una declaración válida", () => {
  assert.equal(isReleasePlanDeclaration(VALID_RELEASE_PLAN_DECLARATION), true);
});

test("isReleasePlanDeclaration rechaza forma inválida", () => {
  assert.equal(isReleasePlanDeclaration(null), false);
  assert.equal(isReleasePlanDeclaration({ features: [{ id: "f1" }], featureActualId: null }), false);
  assert.equal(isReleasePlanDeclaration({ features: [], featureActualId: 123 }), false);
});

test("extractReleasePlanDeclaration parsea un RELEASE_PLAN válido bolteado a outputArtifact", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: JSON.stringify(VALID_RELEASE_PLAN_DECLARATION) } };
  assert.deepEqual(extractReleasePlanDeclaration({ phase: "planning" }, content), VALID_RELEASE_PLAN_DECLARATION);
});

test("extractReleasePlanDeclaration devuelve null para roles distintos de planning", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: JSON.stringify(VALID_RELEASE_PLAN_DECLARATION) } };
  assert.equal(extractReleasePlanDeclaration({ phase: "functional" }, content), null);
});

test("extractReleasePlanDeclaration trata JSON malformado como ausente (riesgo H12 aceptado)", () => {
  const content = { outputArtifact: { text: "plan", releasePlan: "{ no es json" } };
  assert.equal(extractReleasePlanDeclaration({ phase: "planning" }, content), null);
});

test("isReleaseCompletionEscalation detecta el marcador releaseCompleto de Planning", () => {
  assert.equal(
    isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: { releaseCompleto: "true" } }),
    true
  );
});

test("isReleaseCompletionEscalation es false para ambigüedad genérica de Planning o rol distinto", () => {
  assert.equal(isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: null }), false);
  assert.equal(
    isReleaseCompletionEscalation({ phase: "developer" }, { outputArtifact: { releaseCompleto: "true" } }),
    false
  );
});

const VALID_MERGE_APPROVAL = {
  mergeApproval: true,
  baseBranch: "release/base",
  featureBranch: "run/abc",
  featureActualId: "f2",
};

test("isMergeApprovalPayload acepta un payload válido", () => {
  assert.equal(isMergeApprovalPayload(VALID_MERGE_APPROVAL), true);
});

test("isMergeApprovalPayload rechaza forma inválida", () => {
  assert.equal(isMergeApprovalPayload(null), false);
  assert.equal(isMergeApprovalPayload({ mergeApproval: true, baseBranch: "x" }), false);
});

test("extractMergeApproval detecta la aprobación de merge sintética atribuida a developer", () => {
  assert.deepEqual(
    extractMergeApproval({ phase: "developer" }, { outputArtifact: VALID_MERGE_APPROVAL }),
    VALID_MERGE_APPROVAL
  );
});

test("extractMergeApproval no confunde una escalación real de ambigüedad de Developer (sin mergeApproval)", () => {
  assert.equal(
    extractMergeApproval({ phase: "developer" }, { outputArtifact: "ambigüedad real, texto libre" }),
    null
  );
});

test("extractMergeApproval devuelve null para roles distintos de developer", () => {
  assert.equal(extractMergeApproval({ phase: "planning" }, { outputArtifact: VALID_MERGE_APPROVAL }), null);
});

// FEATURE-020

test("predecessorRoleFor devuelve el rol inmediatamente anterior en el orden del pipeline", () => {
  assert.equal(predecessorRoleFor("functional"), "architect");
  assert.equal(predecessorRoleFor("planning"), "functional");
  assert.equal(predecessorRoleFor("developer"), "planning");
  assert.equal(predecessorRoleFor("qa"), "developer");
});

test("predecessorRoleFor devuelve null para architect (no participa del mecanismo de paso)", () => {
  assert.equal(predecessorRoleFor("architect"), null);
});

test("buildEscalationContext incluye businessCase (Regla 2/9, fix del bug de FEATURE-019)", () => {
  const context = buildEscalationContext({
    businessCase: { titulo: "caso real" },
    escalationReason: null,
    rejectedArtifact: "propuesta",
    originAgentRole: "architect",
    humanSolution: null,
  });
  assert.deepEqual(context.businessCase, { titulo: "caso real" });
  assert.equal(context.escalationReason, "Escalamiento sin razón explícita persistida.");
});

test("buildReentryContext calcula targetAgentRole vía predecessorRoleFor y preserva attempt/originalVersionRef", () => {
  const context = buildReentryContext({
    businessCase: null,
    escalationReason: "QA rechazó",
    rejectedArtifact: { plan: "v1" },
    originAgentRole: "qa",
    humanSolution: "arreglalo",
    attempt: 2,
    originalVersionRef: "artifact-123",
  });
  assert.equal(context.targetAgentRole, "developer");
  assert.equal(context.attempt, 2);
  assert.equal(context.originalVersionRef, "artifact-123");
});

test("isReentryContext distingue un contexto de reingreso de un artifact normal", () => {
  const reentry = buildReentryContext({
    businessCase: null,
    escalationReason: "algo",
    rejectedArtifact: null,
    originAgentRole: "developer",
    humanSolution: null,
    attempt: 1,
    originalVersionRef: "x",
  });
  assert.equal(isReentryContext(reentry), true);
  assert.equal(isReentryContext({ functionalArtifact: { features: [] } }), false);
  assert.equal(isReentryContext(null), false);
  assert.equal(isReentryContext("texto plano"), false);
});

test("isNotApplicableOutput acepta booleano real, el string 'true' (forma objeto), o la línea NO_APLICA: true embebida en un outputArtifact string (Codex, PHASE_RESULT_SCHEMA restringe outputArtifact a string|null)", () => {
  assert.equal(isNotApplicableOutput({ notApplicable: true }), true);
  assert.equal(isNotApplicableOutput({ notApplicable: "true" }), true);
  assert.equal(isNotApplicableOutput({ notApplicable: false }), false);
  assert.equal(isNotApplicableOutput({ text: "propuesta real" }), false);
  assert.equal(isNotApplicableOutput(null), false);
  assert.equal(isNotApplicableOutput("ARTEFACTO: null\nROADMAP: null\nNO_APLICA: true"), true);
  assert.equal(isNotApplicableOutput("ARTEFACTO: null\nROADMAP: null\nNO_APLICA: null"), false);
  assert.equal(isNotApplicableOutput("ARTEFACTO: propuesta real\nROADMAP: null"), false);
});

// Corrección del runtime de circuitos (triangulación 2026-07-29)

test("isFeatureContinuationContext acepta { featureJustCompleted } con string o null", () => {
  assert.equal(isFeatureContinuationContext({ featureJustCompleted: "f1" }), true);
  assert.equal(isFeatureContinuationContext({ featureJustCompleted: null }), true);
});

test("isFeatureContinuationContext rechaza cualquier otra forma, incluyendo campos extra", () => {
  assert.equal(isFeatureContinuationContext(null), false);
  assert.equal(isFeatureContinuationContext("f1"), false);
  assert.equal(isFeatureContinuationContext({ functionalArtifact: { features: [] } }), false);
  assert.equal(isFeatureContinuationContext({ featureJustCompleted: "f1", extra: true }), false);
  assert.equal(isFeatureContinuationContext({ featureJustCompleted: 1 }), false);
});

test("classifyGateEscalation reconoce roadmap_approval solo para architect con ROADMAP válido", () => {
  const roadmap = { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) };
  assert.equal(classifyGateEscalation("architect", roadmap), "roadmap_approval");
  assert.equal(classifyGateEscalation("planning", roadmap), null);
});

test("classifyGateEscalation reconoce release_completion solo para planning con releaseCompleto", () => {
  assert.equal(classifyGateEscalation("planning", { releaseCompleto: "true" }), "release_completion");
  assert.equal(classifyGateEscalation("developer", { releaseCompleto: "true" }), null);
});

test("classifyGateEscalation devuelve null para una escalación genérica (ni roadmap ni release completo)", () => {
  assert.equal(classifyGateEscalation("developer", "ambigüedad real, texto libre"), null);
  assert.equal(classifyGateEscalation("planning", { releasePlan: "{}" }), null);
});

test("extractRoadmapApproval (movida a escalation.ts) sigue parseando un ROADMAP válido bolteado a outputArtifact", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) } };
  assert.deepEqual(extractRoadmapApproval({ phase: "architect" }, content), VALID_ROADMAP);
  assert.equal(extractRoadmapApproval({ phase: "planning" }, content), null);
});

// Corrección del runtime de circuitos: paridad Codex para los 3 extractores de Gate.
// Codex está forzado (PHASE_RESULT_SCHEMA) a que outputArtifact sea SIEMPRE string|null — antes de
// esta corrección, estas 3 funciones exigían "object" y devolvían siempre null/false con Codex.

test("extractRoadmapApproval reconoce ROADMAP cuando outputArtifact es el string real que produce Codex", () => {
  const codexOutput = `RESUMEN: listo\nARTEFACTO: null\nROADMAP: ${JSON.stringify(VALID_ROADMAP)}`;
  assert.deepEqual(extractRoadmapApproval({ phase: "architect" }, { outputArtifact: codexOutput }), VALID_ROADMAP);
});

test("extractRoadmapApproval devuelve null si el string de Codex no trae la línea ROADMAP", () => {
  assert.equal(
    extractRoadmapApproval({ phase: "architect" }, { outputArtifact: "RESUMEN: ambigüedad genérica" }),
    null
  );
});

test("extractReleasePlanDeclaration reconoce RELEASE_PLAN cuando outputArtifact es el string real que produce Codex", () => {
  const codexOutput = `RESUMEN: plan\nRELEASE_PLAN: ${JSON.stringify(VALID_RELEASE_PLAN_DECLARATION)}\nRELEASE_COMPLETO: null`;
  assert.deepEqual(
    extractReleasePlanDeclaration({ phase: "planning" }, { outputArtifact: codexOutput }),
    VALID_RELEASE_PLAN_DECLARATION
  );
});

test("isReleaseCompletionEscalation reconoce RELEASE_COMPLETO cuando outputArtifact es el string real que produce Codex", () => {
  const codexOutput = "RESUMEN: no queda ninguna Feature pendiente\nRELEASE_COMPLETO: true";
  assert.equal(isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: codexOutput }), true);
});

test("isReleaseCompletionEscalation sigue aceptando el booleano real ademas del string 'true'", () => {
  assert.equal(
    isReleaseCompletionEscalation({ phase: "planning" }, { outputArtifact: { releaseCompleto: true } }),
    true
  );
});

test("classifyGateEscalation también clasifica correctamente con outputArtifact string (forma de Codex)", () => {
  const roadmapOutput = `RESUMEN: listo\nROADMAP: ${JSON.stringify(VALID_ROADMAP)}`;
  assert.equal(classifyGateEscalation("architect", roadmapOutput), "roadmap_approval");
  assert.equal(classifyGateEscalation("planning", "RESUMEN: cierre\nRELEASE_COMPLETO: true"), "release_completion");
});
