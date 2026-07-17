import type { PhaseInvocation } from "../contracts/executor.js";

// Definiciones de pipeline como datos versionados (02-ARCHITECTURE.md §2: "definición de pipeline
// versionada, datos no código embebido"). El Orquestador itera este arreglo genéricamente — el
// orden de fases y la regla de transición ("solo continuar si status === completed") viven acá,
// no hardcodeados en la lógica de ejecución (FEATURE-004, Regla Funcional 2).

export interface PipelinePhaseSpec {
  agentRole: PhaseInvocation["agentRole"];
  permissions: PhaseInvocation["permissions"];
}

export interface LoopSpec {
  developerRole: "developer";
  qaRole: "qa";
  maxAttempts: number;
}

export interface PipelineSpec {
  name: string;
  version: number;
  definition: {
    phases: PipelinePhaseSpec[];
    /**
     * Segmento de loop, opcional — corre después de que todas las `phases` lineales completen.
     * Deliberadamente NO generalizado a loops arbitrarios entre cualquier par de fases (FEATURE-005,
     * Technical Considerations): solo existe este único loop Developer↔QA en el diseño.
     */
    loop?: LoopSpec;
  };
}

export const SINGLE_PHASE_ARCHITECT: PipelineSpec = {
  name: "single-phase-architect",
  version: 1,
  definition: {
    phases: [{ agentRole: "architect", permissions: { filesystem: "read-only" } }],
  },
};

export const TWO_PHASE_ARCHITECT_FUNCTIONAL: PipelineSpec = {
  name: "two-phase-architect-functional",
  version: 1,
  definition: {
    phases: [
      { agentRole: "architect", permissions: { filesystem: "read-only" } },
      { agentRole: "functional", permissions: { filesystem: "read-only" } },
    ],
  },
};

export const FULL_PIPELINE: PipelineSpec = {
  name: "full-pipeline-architect-to-qa",
  version: 1,
  definition: {
    phases: [
      { agentRole: "architect", permissions: { filesystem: "read-only" } },
      { agentRole: "functional", permissions: { filesystem: "read-only" } },
      { agentRole: "planning", permissions: { filesystem: "read-only" } },
    ],
    loop: { developerRole: "developer", qaRole: "qa", maxAttempts: 3 },
  },
};

export const PIPELINES: Record<string, PipelineSpec> = {
  [SINGLE_PHASE_ARCHITECT.name]: SINGLE_PHASE_ARCHITECT,
  [TWO_PHASE_ARCHITECT_FUNCTIONAL.name]: TWO_PHASE_ARCHITECT_FUNCTIONAL,
  [FULL_PIPELINE.name]: FULL_PIPELINE,
};
