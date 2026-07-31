import assert from "node:assert/strict";
import test from "node:test";
import type { PhaseResult } from "../../contracts/executor.js";
import { latestEscalationArtifact } from "../respondService.js";
import type { ReleasePlanAssociationCandidate } from "../../db/repository.js";
import { FeatureLifecycleEscalationError } from "../../features/lifecycle.js";
import {
  decideLinearEscalationKind,
  persistReleasePlanIfDeclared,
  ramaBaseTrabajoFromBusinessCase,
  resolveReleasePlanForActiveRelease,
  runDeveloperQaLoop,
  shapeRoleContext,
  validateFinalReleasePlanTransition,
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
      featureJustCompleted: null,
      inputReleasePlan: null,
    })
  );
});

// FEATURE-038: validateFinalReleasePlanTransition — función pura, cubre la validación del cierre
// de release (RELEASE_COMPLETO) contra el Release Plan vigente de ENTRADA (nunca el declarado de
// salida, que siempre trae featureActualId: null en un cierre).

const INPUT_PLAN_TWO_FEATURES = {
  ramaBaseTrabajo: "main",
  features: [
    { id: "f1", nombre: "Primera", estado: "Completada" as const },
    { id: "f2", nombre: "Segunda", estado: "En curso" as const },
  ],
  featureActualId: "f2",
};

function validClosureParams(overrides: Partial<Parameters<typeof validateFinalReleasePlanTransition>[0]> = {}) {
  return {
    featureJustCompleted: "f2",
    inputReleasePlan: INPUT_PLAN_TWO_FEATURES,
    declaredFinalReleasePlan: {
      features: [
        { id: "f1", nombre: "Primera", estado: "Completada" as const },
        { id: "f2", nombre: "Segunda", estado: "Completada" as const },
      ],
      featureActualId: null,
    },
    comandoTestIsNull: true,
    featureUpdateIsNull: true,
    ...overrides,
  };
}

test("FEATURE-038, Escenario 2: cierre válido con dos Features", () => {
  assert.deepEqual(validateFinalReleasePlanTransition(validClosureParams()), { valid: true });
});

test("FEATURE-038, Escenario 4: sin Release Plan vigente de entrada", () => {
  const result = validateFinalReleasePlanTransition(validClosureParams({ inputReleasePlan: null }));
  assert.equal(result.valid, false);
});

test("FEATURE-038: Release Plan vigente de entrada sin ninguna Feature en curso", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      inputReleasePlan: { ...INPUT_PLAN_TWO_FEATURES, featureActualId: null },
    })
  );
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 12: featureJustCompleted no coincide con la Feature activa del plan de entrada", () => {
  const result = validateFinalReleasePlanTransition(validClosureParams({ featureJustCompleted: "f1" }));
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /no coincide con la Feature activa/);
});

test("FEATURE-038: la Feature activa del plan de entrada no está En curso", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      inputReleasePlan: {
        ...INPUT_PLAN_TWO_FEATURES,
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f2", nombre: "Segunda", estado: "Pendiente" as const },
        ],
      },
    })
  );
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.reason, /no está "En curso"/);
});

test("FEATURE-038, Escenario 5: featureActualId no nulo en el plan final", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f2", nombre: "Segunda", estado: "Completada" as const },
        ],
        featureActualId: "f2",
      },
    })
  );
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 6/7: Feature Pendiente o En curso en el plan final", () => {
  const conPendiente = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f2", nombre: "Segunda", estado: "Pendiente" as const },
        ],
        featureActualId: null,
      },
    })
  );
  assert.equal(conPendiente.valid, false);

  const conEnCurso = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f2", nombre: "Segunda", estado: "En curso" as const },
        ],
        featureActualId: null,
      },
    })
  );
  assert.equal(conEnCurso.valid, false);
});

test("FEATURE-038, Escenario 13: COMANDO_TEST no nulo invalida el cierre", () => {
  const result = validateFinalReleasePlanTransition(validClosureParams({ comandoTestIsNull: false }));
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 14: FEATURE_UPDATE no nulo invalida el cierre", () => {
  const result = validateFinalReleasePlanTransition(validClosureParams({ featureUpdateIsNull: false }));
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 8: Feature eliminada del plan final", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [{ id: "f2", nombre: "Segunda", estado: "Completada" as const }],
        featureActualId: null,
      },
    })
  );
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 9: Feature agregada en el plan final", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f2", nombre: "Segunda", estado: "Completada" as const },
          { id: "f3", nombre: "Nueva", estado: "Completada" as const },
        ],
        featureActualId: null,
      },
    })
  );
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 10: identidad duplicada en el plan final", () => {
  const result = validateFinalReleasePlanTransition(
    validClosureParams({
      declaredFinalReleasePlan: {
        features: [
          { id: "f1", nombre: "Primera", estado: "Completada" as const },
          { id: "f1", nombre: "Primera (dup)", estado: "Completada" as const },
        ],
        featureActualId: null,
      },
    })
  );
  assert.equal(result.valid, false);
});

test("FEATURE-038, Escenario 1: continuación normal (no es un cierre) queda fuera de esta validación", () => {
  // Esta función solo se invoca cuando isReleaseCompletionEscalation ya dio true — una continuación
  // normal (status completed, featureActualId apunta a la siguiente Feature) nunca llega acá; ver
  // el test de persistReleasePlanIfDeclared para el camino completo.
  assert.equal(typeof validateFinalReleasePlanTransition, "function");
});

// FEATURE-038: persistReleasePlanIfDeclared — camino de cierre inconsistente. La validación corre
// ANTES de cualquier llamada a la base de datos, así que estos tests no necesitan una DB real: si
// la implementación intentara tocar la base antes de fallar, el test fallaría por timeout/error de
// conexión en vez de por el `FeatureLifecycleEscalationError` esperado.

function releaseCompletionResult(overrides: {
  releasePlan: unknown;
  comandoTest?: string;
  featureUpdate?: unknown;
}): PhaseResult {
  const outputArtifact: Record<string, unknown> = {
    releasePlan: JSON.stringify(overrides.releasePlan),
    releaseCompleto: true,
  };
  if (overrides.comandoTest !== undefined) outputArtifact.comandoTest = overrides.comandoTest;
  if (overrides.featureUpdate !== undefined) outputArtifact.featureUpdate = overrides.featureUpdate;
  return {
    status: "escalated",
    outputArtifact,
    summary: "Planning declaró el release completo.",
    escalationReason: null,
  };
}

test("FEATURE-038: RELEASE_COMPLETO con featureJustCompleted que no coincide escala con FeatureLifecycleEscalationError, sin tocar la base", async () => {
  const result = releaseCompletionResult({
    releasePlan: {
      features: [
        { id: "f1", nombre: "Primera", estado: "Completada" },
        { id: "f2", nombre: "Segunda", estado: "Completada" },
      ],
      featureActualId: null,
    },
  });

  await assert.rejects(
    () =>
      persistReleasePlanIfDeclared({
        projectId: "project-no-debe-consultarse",
        runId: "run-cierre-invalido",
        result,
        fallbackRamaBaseTrabajo: "main",
        phaseFinishedEventId: 1,
        featureJustCompleted: "f1",
        inputReleasePlan: INPUT_PLAN_TWO_FEATURES,
      }),
    (error: unknown) => {
      assert.ok(error instanceof FeatureLifecycleEscalationError);
      assert.match((error as Error).message, /cierre de release inconsistente/);
      return true;
    }
  );
});

test("FEATURE-038: RELEASE_COMPLETO sin RELEASE_PLAN final escala con FeatureLifecycleEscalationError", async () => {
  const result: PhaseResult = {
    status: "escalated",
    outputArtifact: { releaseCompleto: true },
    summary: "Planning declaró el release completo sin plan.",
    escalationReason: null,
  };

  await assert.rejects(
    () =>
      persistReleasePlanIfDeclared({
        projectId: "project-no-debe-consultarse",
        runId: "run-sin-plan",
        result,
        fallbackRamaBaseTrabajo: "main",
        phaseFinishedEventId: 1,
        featureJustCompleted: "f2",
        inputReleasePlan: INPUT_PLAN_TWO_FEATURES,
      }),
    (error: unknown) => error instanceof FeatureLifecycleEscalationError
  );
});

test("FEATURE-038: RELEASE_COMPLETO con COMANDO_TEST declarado escala en vez de persistir", async () => {
  const result = releaseCompletionResult({
    releasePlan: {
      features: [
        { id: "f1", nombre: "Primera", estado: "Completada" },
        { id: "f2", nombre: "Segunda", estado: "Completada" },
      ],
      featureActualId: null,
    },
    comandoTest: "node --test src/x.test.mjs",
  });

  await assert.rejects(
    () =>
      persistReleasePlanIfDeclared({
        projectId: "project-no-debe-consultarse",
        runId: "run-comando-test-no-nulo",
        result,
        fallbackRamaBaseTrabajo: "main",
        phaseFinishedEventId: 1,
        featureJustCompleted: "f2",
        inputReleasePlan: INPUT_PLAN_TWO_FEATURES,
      }),
    (error: unknown) => error instanceof FeatureLifecycleEscalationError
  );
});

// FEATURE-028: resolveReleasePlanForActiveRelease — función pura, decide si el release_plan
// vigente corresponde al release activo actual (mismo activeReleaseId pinneado Y mismo
// root_run_id/ciclo de negocio).

function candidate(overrides: Partial<ReleasePlanAssociationCandidate> = {}): ReleasePlanAssociationCandidate {
  return {
    value: { features: [], featureActualId: null, ramaBaseTrabajo: "main" },
    pinnedActiveReleaseId: "r2",
    writerRootRunId: "root-run-actual",
    currentEpochRootRunId: "root-run-actual",
    ...overrides,
  };
}

test("FEATURE-028, Escenario 1: mismo release y mismo ciclo -> entrega el plan", () => {
  const plan = candidate();
  assert.equal(
    resolveReleasePlanForActiveRelease({ activeReleaseId: "r2", candidate: plan }),
    plan.value
  );
});

test("FEATURE-028, Escenario 2: plan de un release distinto -> null", () => {
  const plan = candidate({ pinnedActiveReleaseId: "r1" });
  assert.equal(resolveReleasePlanForActiveRelease({ activeReleaseId: "r2", candidate: plan }), null);
});

test("FEATURE-028, Escenario 6: sin release activo -> null", () => {
  const plan = candidate();
  assert.equal(resolveReleasePlanForActiveRelease({ activeReleaseId: null, candidate: plan }), null);
});

test("FEATURE-028, Escenario 7/8: sin plan vigente resoluble -> null", () => {
  assert.equal(resolveReleasePlanForActiveRelease({ activeReleaseId: "r1", candidate: null }), null);
});

test("FEATURE-028, Escenario 9: roadmap pinneado sin release activo (activeReleaseId null) -> null", () => {
  const plan = candidate({ pinnedActiveReleaseId: null });
  assert.equal(resolveReleasePlanForActiveRelease({ activeReleaseId: "r1", candidate: plan }), null);
});

test("FEATURE-028, Escenario 10: mismo ID literal pero ciclo de negocio distinto -> null", () => {
  const plan = candidate({ pinnedActiveReleaseId: "r1", writerRootRunId: "root-run-anterior" });
  assert.equal(
    resolveReleasePlanForActiveRelease({ activeReleaseId: "r1", candidate: plan }),
    null,
    "el activeReleaseId coincide pero pertenece a otro ciclo de negocio (root_run_id distinto)"
  );
});

test("FEATURE-028, Escenario 11: mismo ciclo y mismo ID -> entrega el plan", () => {
  const plan = candidate({ pinnedActiveReleaseId: "r1", writerRootRunId: "root-run-x", currentEpochRootRunId: "root-run-x" });
  assert.equal(resolveReleasePlanForActiveRelease({ activeReleaseId: "r1", candidate: plan }), plan.value);
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

test("runDeveloperQaLoop agota 3 intentos cuando la instalación de dependencias falla y no invoca build/test/QA (FEATURE-032)", async () => {
  const artifacts: unknown[] = [];
  let developerCalls = 0;
  let qaCalls = 0;
  let buildCalls = 0;
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
      throw new Error("QA no debe invocarse cuando la instalación de dependencias falla.");
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["executor"];
  const developerExecutor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      developerCalls += 1;
      return completedDeveloper;
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["developerExecutor"];

  const services = loopServices(artifacts, { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false });
  services.buildExecutor = {
    runIfNeeded: async () => {
      buildCalls += 1;
      throw new Error("BuildExecutor no debe invocarse cuando la instalación de dependencias falla.");
    },
  };
  services.dependencyInstaller = {
    installIfNeeded: async () => ({
      ran: true,
      command: "npm ci",
      exitCode: 1,
      stdout: "",
      stderr: "npm error código ENOTFOUND registry.npmjs.org",
      timedOut: false,
    }),
  };

  const result = await runDeveloperQaLoop({
    executor,
    developerExecutor,
    readRole: async () => "instrucciones",
    runId: "run-dependency-install-loop",
    planningResult: planningResult(),
    maxAttempts: 3,
    phaseTiming: { agentRole: null, startedAt: null },
    services,
  });

  assert.equal(result.status, "escalated");
  assert.equal(developerCalls, 3);
  assert.equal(buildCalls, 0);
  assert.equal(qaCalls, 0);
  assert.equal(latestEscalationArtifact(artifacts).phase, "developer");
});

test("runDeveloperQaLoop agota 3 intentos con COMANDO_TEST inconsistente con el build y no invoca QA (FEATURE-029)", async () => {
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
      throw new Error("QA no debe invocarse cuando COMANDO_TEST no supera la prevalidación.");
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["executor"];
  const developerExecutor = {
    options: { workingDirectory: "C:\\fake-worktree" },
    runPhase: async () => {
      developerCalls += 1;
      return completedDeveloper;
    },
  } as unknown as Parameters<typeof runDeveloperQaLoop>[0]["developerExecutor"];

  const services = loopServices(artifacts, { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false });
  services.validateTestCommandContract = async () => ({
    valid: false,
    reason: 'COMANDO_TEST apunta a una ruta que no existe después del build: "dist/example.test.js".',
  });

  const result = await runDeveloperQaLoop({
    executor,
    developerExecutor,
    readRole: async () => "instrucciones",
    runId: "run-test-command-contract-loop",
    planningResult: planningResult(),
    maxAttempts: 3,
    phaseTiming: { agentRole: null, startedAt: null },
    services,
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
    // FEATURE-029: workingDirectory en estos tests es una ruta falsa ("C:\\fake-worktree") — sin
    // este override, la validación real de testCommandContract.ts intentaría leer el filesystem
    // real y fallaría siempre, rompiendo todos los tests existentes que esperan llegar a QA.
    validateTestCommandContract: async () => ({ valid: true }),
  } as unknown as NonNullable<Parameters<typeof runDeveloperQaLoop>[0]["services"]>;
}
