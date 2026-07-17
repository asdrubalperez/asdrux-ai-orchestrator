import type { PhaseInvocation } from "../contracts/executor.js";

// Definiciones de pipeline como datos versionados (02-ARCHITECTURE.md §2: "definición de pipeline
// versionada, datos no código embebido"). El Orquestador itera este arreglo genéricamente — el
// orden de fases y la regla de transición ("solo continuar si status === completed") viven acá,
// no hardcodeados en la lógica de ejecución (FEATURE-004, Regla Funcional 2).

export interface PipelinePhaseSpec {
  agentRole: PhaseInvocation["agentRole"];
  permissions: PhaseInvocation["permissions"];
}

export interface PipelineSpec {
  name: string;
  version: number;
  definition: { phases: PipelinePhaseSpec[] };
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

export const PIPELINES: Record<string, PipelineSpec> = {
  [SINGLE_PHASE_ARCHITECT.name]: SINGLE_PHASE_ARCHITECT,
  [TWO_PHASE_ARCHITECT_FUNCTIONAL.name]: TWO_PHASE_ARCHITECT_FUNCTIONAL,
};
