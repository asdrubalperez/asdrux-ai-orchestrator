import assert from "node:assert/strict";
import test from "node:test";
import type { PhaseResult } from "../../contracts/executor.js";
import { latestEscalationArtifact } from "../respondService.js";
import {
  decideLinearEscalationKind,
  persistReleasePlanIfDeclared,
  ramaBaseTrabajoFromBusinessCase,
  runDeveloperQaLoop,
  shapeRoleContext,
} from "./runStart.js";

test("Planning escalado no persiste RELEASE_PLAN ni exige FEATURE_UPDATE", async () => {
  const result: PhaseResult = {
    status: "escalated",
    outputArtifact: {
      releasePlan: JSON.stringify({
        features: [{ id: "f1", nombre: "Feature vigente", estado: "En curso" }],
        featureActualId: "f1",
      }),
    },
    summary: "Planning detectó una inconsistencia y escaló.",
    escalationReason: "El estado recibido es contradictorio.",
  };

  await assert.doesNotReject(() =>
    persistReleasePlanIfDeclared({
      projectId: "project-no-debe-consultarse",
      runId: "run-escalado",
      result,
      fallbackRamaBaseTrabajo: "main",
      phaseFinishedEventId: 1,
    })
  );
});

test("ramaBaseTrabajoFromBusinessCase lee rama_base_trabajo del business_case crudo de un run raíz", () => {
  assert.equal(ramaBaseTrabajoFromBusinessCase({ rama_base_trabajo: "release/mvp" }), "release/mvp");
});

test("ramaBaseTrabajoFromBusinessCase devuelve undefined para un contexto sin rama_base_trabajo (ej. continuación { featureJustCompleted })", () => {
  assert.equal(ramaBaseTrabajoFromBusinessCase({ featureJustCompleted: "f1" }), undefined);
  assert.equal(ramaBaseTrabajoFromBusinessCase(null), undefined);
});

// FEATURE-020, bug encontrado en prueba real: con la Regla 6 del camino genérico de
// respondService.ts (siempre FULL_PIPELINE), el initialContext de la primera Feature de
// cualquier release es un ReentryContext (con businessCase anidado), no el business_case crudo.
test("ramaBaseTrabajoFromBusinessCase encuentra rama_base_trabajo anidado en businessCase de un ReentryContext", () => {
  const reentryContext = {
    businessCase: { rama_base_trabajo: "release/mvp", repositorio: "git@github.com:org/repo.git" },
    escalationReason: "Roadmap aprobado por el usuario.",
    rejectedArtifact: null,
    originAgentRole: "architect",
    targetAgentRole: null,
    humanSolution: "aprobado",
    attempt: 1,
    originalVersionRef: "config-row-id",
  };
  assert.equal(ramaBaseTrabajoFromBusinessCase(reentryContext), "release/mvp");
});

test("ramaBaseTrabajoFromBusinessCase devuelve undefined si el ReentryContext no tiene businessCase real", () => {
  const reentryContext = {
    businessCase: null,
    escalationReason: "algo",
    rejectedArtifact: null,
    originAgentRole: "architect",
    targetAgentRole: null,
    humanSolution: null,
    attempt: 1,
    originalVersionRef: "x",
  };
  assert.equal(ramaBaseTrabajoFromBusinessCase(reentryContext), undefined);
});

test("runDeveloperQaLoop agota 3 builds rotos y deja el artifact respondible", async () => {
  const artifacts: unknown[] = [];
  let developerCalls = 0;
  let qaCalls = 0;
  const completedDeveloper: PhaseResult = {
    status: "completed",
    outputArtifact: { patch: "intentado" },
    summary: "Developer terminó.",
    escalationReason: null,
  };
  const executor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      qaCalls += 1;
      throw new Error("QA no debe invocarse cuando el build falla.");
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["executor"];
  const developerExecutor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      developerCalls += 1;
      return completedDeveloper;
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["developerExecutor"];

  const result = await runDeveloperQaLoop({
    executor,
    developerExecutor,
    readRole: async () => "instrucciones",
    runId: "run-build-loop",
    planningResult: planningResult(),
    maxAttempts: 3,
    phaseTiming: { agentRole: null, startedAt: null },
    services: loopServices(artifacts, {
      ran: true,
      exitCode: 2,
      stdout: "",
      stderr: "tsc: error persistente",
      timedOut: false,
    }),
  });

  assert.equal(result.status, "escalated");
  assert.equal(developerCalls, 3);
  assert.equal(qaCalls, 0);
  assert.equal(latestEscalationArtifact(artifacts).phase, "developer");
});

test("runDeveloperQaLoop agota 3 rechazos de QA y deja la escalación después del último verdict", async () => {
  const artifacts: unknown[] = [];
  let developerCalls = 0;
  let qaCalls = 0;
  const executor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      qaCalls += 1;
      return {
        status: "rejected",
        outputArtifact: { finding: `rechazo-${qaCalls}` },
        summary: `QA rechazó intento ${qaCalls}.`,
        escalationReason: null,
      } satisfies PhaseResult;
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["executor"];
  const developerExecutor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      developerCalls += 1;
      return {
        status: "completed",
        outputArtifact: { patch: `intento-${developerCalls}` },
        summary: `Developer intento ${developerCalls}.`,
        escalationReason: null,
      } satisfies PhaseResult;
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["developerExecutor"];

  const result = await runDeveloperQaLoop({
    executor,
    developerExecutor,
    readRole: async () => "instrucciones",
    runId: "run-qa-loop",
    planningResult: planningResult(),
    maxAttempts: 3,
    phaseTiming: { agentRole: null, startedAt: null },
    services: loopServices(artifacts, {
      ran: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
    }),
  });

  assert.equal(result.status, "escalated");
  assert.equal(developerCalls, 3);
  assert.equal(qaCalls, 3);
  const latest = latestEscalationArtifact(artifacts);
  assert.equal(latest.phase, "qa");
  assert.equal((latest.content as { attempt: number }).attempt, 3);
});

test("FEATURE-023: QA factual pasado requiere readiness estable de Developer antes de continuar", async () => {
  const artifacts: unknown[] = [];
  const contributions: Array<{ contribution: { purpose: string } }> = [];
  let developerCalls = 0;
  let eventId = 0;
  const executor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () =>
      ({
        status: "completed",
        outputArtifact: {
          qaResult: {
            testStatus: "passed",
            testsExecuted: ["node --test fake.test.js"],
            evidence: "1 test passed",
            defects: [],
            observations: [],
            qualityRisks: [],
          },
        },
        summary: "Tests pasados.",
        escalationReason: null,
      }) satisfies PhaseResult,
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["executor"];
  const developerExecutor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      developerCalls += 1;
      return developerCalls === 1
        ? ({
            status: "completed",
            outputArtifact: {
              implementation: {
                implementationSummary: "Cambio localizado.",
                filesChanged: ["src/a.ts"],
                decisions: [],
                technicalEvidence: ["build"],
              },
            },
            summary: "Implementado.",
            escalationReason: null,
          } satisfies PhaseResult)
        : ({
            status: "completed",
            outputArtifact: {
              readiness: {
                readiness: "ready",
                summary: "Listo.",
                knownRisks: [],
                requiresCodeChanges: false,
                finalNotes: [],
              },
            },
            summary: "Readiness declarado.",
            escalationReason: null,
          } satisfies PhaseResult);
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["developerExecutor"];
  const baseServices = loopServices(artifacts, {
    ran: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
  });

  const result = await runDeveloperQaLoop({
    executor,
    developerExecutor,
    readRole: async () => "instrucciones",
    runId: "run-readiness",
    planningResult: planningResult(),
    maxAttempts: 3,
    featureLifecycle: true,
    phaseTiming: { agentRole: null, startedAt: null },
    services: {
      ...baseServices,
      recordRunEvent: async () => ++eventId,
      testExecutor: {
        run: async () => ({ exitCode: 0, stdout: "pass", stderr: "", timedOut: false }),
      },
      persistFeatureContribution: async (value) => {
        contributions.push(value as never);
        return {} as never;
      },
      gitReadinessSnapshot: async () => ({ branch: "run/x", headSha: "abc", treeHash: "tree" }),
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(developerCalls, 2);
  assert.deepEqual(contributions.map((item) => item.contribution.purpose), [
    "developer-implementation",
    "qa-result",
    "developer-readiness",
  ]);
});

// Corrección del runtime de circuitos (triangulación 2026-07-29)

const SHARED = { activeRelease: { id: "r1", nombre: "MVP", alcanceResumen: "x", estado: "Activo" }, releasePlan: null };

test("shapeRoleContext NO envuelve { featureJustCompleted } en functionalArtifact (bug confirmado)", () => {
  const shaped = shapeRoleContext({ featureJustCompleted: "f1" }, SHARED) as Record<string, unknown>;
  assert.equal(shaped.featureJustCompleted, "f1");
  assert.equal("functionalArtifact" in shaped, false);
  assert.deepEqual(shaped.activeRelease, SHARED.activeRelease);
});

test("shapeRoleContext NO envuelve un ReentryContext, preserva su forma", () => {
  const reentry = { escalationReason: "x", targetAgentRole: "planning", rejectedArtifact: null };
  const shaped = shapeRoleContext(reentry, SHARED) as Record<string, unknown>;
  assert.equal(shaped.escalationReason, "x");
  assert.equal(shaped.targetAgentRole, "planning");
  assert.equal("functionalArtifact" in shaped, false);
});

test("shapeRoleContext SÍ envuelve un artifact real de Functional en functionalArtifact", () => {
  const functionalOutput = { features: [{ id: "f1", nombre: "x", resumen: "y", prioridad: "P0" }] };
  const shaped = shapeRoleContext(functionalOutput, SHARED) as Record<string, unknown>;
  assert.deepEqual(shaped.functionalArtifact, functionalOutput);
});

test("decideLinearEscalationKind reintenta en el lugar cuando el pipeline incluye Architect", () => {
  assert.equal(
    decideLinearEscalationKind({ isRepeated: false, attempt: 1, maxAttempts: 3, pipelineHasArchitect: true }),
    "retry-in-place"
  );
});

test("decideLinearEscalationKind cruza de pipeline cuando Architect no está disponible", () => {
  assert.equal(
    decideLinearEscalationKind({ isRepeated: false, attempt: 1, maxAttempts: 3, pipelineHasArchitect: false }),
    "retry-cross-pipeline"
  );
});

test("decideLinearEscalationKind detiene por contenido repetido, incluso sin Architect en el pipeline", () => {
  assert.equal(
    decideLinearEscalationKind({ isRepeated: true, attempt: 1, maxAttempts: 3, pipelineHasArchitect: false }),
    "stop"
  );
});

test("decideLinearEscalationKind detiene al agotar intentos, incluso con Architect disponible", () => {
  assert.equal(
    decideLinearEscalationKind({ isRepeated: false, attempt: 3, maxAttempts: 3, pipelineHasArchitect: true }),
    "stop"
  );
});

function planningResult(): PhaseResult {
  return {
    status: "completed",
    outputArtifact: { comandoTest: "node --test fake.test.js" },
    summary: "Planning listo.",
    escalationReason: null,
  };
}

function loopServices(
  artifacts: unknown[],
  buildResult: { ran: boolean; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
): NonNullable<Parameters<typeof runDeveloperQaLoop>[0]["services"]> {
  let artifactId = 0;
  return {
    haltIfCancelledExternally: async () => undefined,
    updateRunCurrentPhase: async () => undefined,
    recordRunEvent: async () => undefined,
    persistArtifact: async (artifact: { runId: string; phase: string; kind: string; content: unknown }) => {
      artifactId += 1;
      artifacts.push({ id: `artifact-${artifactId}`, ...artifact });
    },
    buildExecutor: { runIfNeeded: async () => buildResult },
    testExecutor: {
      run: async () => ({ exitCode: 1, stdout: "", stderr: "tests fallan", timedOut: false }),
    },
  } as unknown as NonNullable<Parameters<typeof runDeveloperQaLoop>[0]["services"]>;
}
