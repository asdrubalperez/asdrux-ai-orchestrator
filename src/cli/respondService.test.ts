import assert from "node:assert/strict";
import test from "node:test";
import { computeReleaseClosureRoadmap, findOriginatingReentryContext, previousAttemptFromEvents } from "./respondService.js";
import { extractRoadmapApproval } from "./escalation.js";

const VALID_ROADMAP = {
  releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" }],
  activeReleaseId: "r1",
};

test("extractRoadmapApproval devuelve null para escalaciones que no son de architect", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) } };
  assert.equal(extractRoadmapApproval({ phase: "planning" }, content), null);
});

test("extractRoadmapApproval devuelve null cuando el outputArtifact no trae roadmap (ambigüedad genérica)", () => {
  assert.equal(extractRoadmapApproval({ phase: "architect" }, { outputArtifact: "propuesta en texto plano" }), null);
  assert.equal(extractRoadmapApproval({ phase: "architect" }, { outputArtifact: null }), null);
});

test("extractRoadmapApproval parsea un ROADMAP válido bolteado a outputArtifact", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(VALID_ROADMAP) } };
  assert.deepEqual(extractRoadmapApproval({ phase: "architect" }, content), VALID_ROADMAP);
});

test("extractRoadmapApproval trata JSON malformado como si no hubiera roadmap (riesgo H12 aceptado)", () => {
  const content = { outputArtifact: { text: "diseño", roadmap: "{ esto no es json" } };
  assert.equal(extractRoadmapApproval({ phase: "architect" }, content), null);
});

test("extractRoadmapApproval rechaza un roadmap con activeReleaseId inexistente", () => {
  const malformed = { releases: VALID_ROADMAP.releases, activeReleaseId: "no-existe" };
  const content = { outputArtifact: { text: "diseño", roadmap: JSON.stringify(malformed) } };
  assert.equal(extractRoadmapApproval({ phase: "architect" }, content), null);
});

// FEATURE-036, Escenario 1: cierre con release siguiente pendiente.
test("computeReleaseClosureRoadmap activa el siguiente release Pendiente y no cierra el proyecto", () => {
  const roadmap = {
    releases: [
      { id: "r1", nombre: "MVP", alcanceResumen: "Primera entrega", estado: "Activo" as const },
      { id: "r2", nombre: "Evolución", alcanceResumen: "Segunda entrega", estado: "Pendiente" as const },
    ],
    activeReleaseId: "r1",
  };
  const result = computeReleaseClosureRoadmap(roadmap);
  assert.equal(result.hasNextRelease, true);
  assert.deepEqual(result.roadmap, {
    releases: [
      { id: "r1", nombre: "MVP", alcanceResumen: "Primera entrega", estado: "Completado" },
      { id: "r2", nombre: "Evolución", alcanceResumen: "Segunda entrega", estado: "Activo" },
    ],
    activeReleaseId: "r2",
  });
});

// FEATURE-036, Escenario 2: cierre del último release, sin ningún Pendiente.
test("computeReleaseClosureRoadmap cierra el último release con activeReleaseId null", () => {
  const roadmap = {
    releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Primera entrega", estado: "Activo" as const }],
    activeReleaseId: "r1",
  };
  const result = computeReleaseClosureRoadmap(roadmap);
  assert.equal(result.hasNextRelease, false);
  assert.deepEqual(result.roadmap, {
    releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Primera entrega", estado: "Completado" }],
    activeReleaseId: null,
  });
});

test("computeReleaseClosureRoadmap no deja ningún release Activo aunque el roadmap leído tuviera más de uno (defensa sección 7.4)", () => {
  const roadmap = {
    releases: [
      { id: "r1", nombre: "MVP", alcanceResumen: "Primera entrega", estado: "Activo" as const },
      { id: "r2", nombre: "Duplicado", alcanceResumen: "Inconsistencia previa", estado: "Activo" as const },
    ],
    activeReleaseId: "r1",
  };
  const result = computeReleaseClosureRoadmap(roadmap);
  assert.equal(result.hasNextRelease, false);
  assert.ok(result.roadmap.releases.every((release) => release.estado !== "Activo"));
  assert.equal(result.roadmap.activeReleaseId, null);
});

test("previousAttemptFromEvents devuelve 0 cuando el run padre no nació del mecanismo de reingreso (primer recorrido)", () => {
  assert.equal(previousAttemptFromEvents([]), 0);
  assert.equal(
    previousAttemptFromEvents([{ event_type: "run_started", payload: {} }, { event_type: "phase_finished", payload: {} }]),
    0
  );
});

test("previousAttemptFromEvents lee el attempt del último escalation_retry_context_prepared con forma de reingreso", () => {
  const events = [
    { event_type: "run_started", payload: {} },
    {
      event_type: "escalation_retry_context_prepared",
      payload: {
        context: {
          businessCase: null,
          escalationReason: "algo",
          rejectedArtifact: null,
          originAgentRole: "developer",
          targetAgentRole: "planning",
          humanSolution: null,
          attempt: 2,
          originalVersionRef: "v1",
        },
      },
    },
  ];
  assert.equal(previousAttemptFromEvents(events), 2);
});

test("previousAttemptFromEvents ignora escalation_retry_context_prepared con forma vieja (sin targetAgentRole)", () => {
  const events = [
    {
      event_type: "escalation_retry_context_prepared",
      payload: { context: { escalationReason: "algo", rejectedArtifact: null, originAgentRole: "architect", humanSolution: null } },
    },
  ];
  assert.equal(previousAttemptFromEvents(events), 0);
});

test("findOriginatingReentryContext devuelve null si el run no nació del mecanismo de reingreso", () => {
  assert.equal(findOriginatingReentryContext([]), null);
});

test("findOriginatingReentryContext devuelve el contexto completo (Regla 7: comparar originAgentRole/rejectedArtifact contra la nueva escalación)", () => {
  const events = [
    {
      event_type: "escalation_retry_context_prepared",
      payload: {
        context: {
          businessCase: null,
          escalationReason: "QA rechazó",
          rejectedArtifact: { plan: "v1" },
          originAgentRole: "qa",
          targetAgentRole: "developer",
          humanSolution: "arreglalo",
          attempt: 1,
          originalVersionRef: "artifact-1",
        },
      },
    },
  ];
  const context = findOriginatingReentryContext(events);
  assert.equal(context?.originAgentRole, "qa");
  assert.deepEqual(context?.rejectedArtifact, { plan: "v1" });
});
