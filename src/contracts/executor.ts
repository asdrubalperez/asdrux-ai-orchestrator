// Contrato de Executor — copiado exactamente de docs/playbook/02-ARCHITECTURE.md, sección 6.
// No modificar esta forma sin actualizar primero la arquitectura aprobada (03-AI-CONSTITUTION.md, regla 2).

export type AgentRole = "architect" | "functional" | "planning" | "developer" | "qa";

export interface PhaseInvocation {
  agentRole: AgentRole;
  roleInstructions: string; // system prompt fijo del playbook, por rol
  context: unknown; // artefactos de fases anteriores que esa fase necesita
  permissions: {
    filesystem: "read-only" | "workspace-write";
    writableRoots?: string[];
    allowedCommands?: string[];
  };
}

export type PhaseStatus = "completed" | "rejected" | "failed" | "interrupted" | "escalated";

export interface PhaseResult {
  status: PhaseStatus;
  outputArtifact: unknown;
  summary: string; // narrativa curada, no el log crudo de herramienta
  escalationReason: string | null;
  executorMetadata?: {
    provider: string;
    model?: string;
    // FEATURE-017, hallazgo de la prueba end-to-end del owner (2026-07-25): sin esto no había
    // forma de auditar después si una invocación real corrió con api_key o cli_session (OAuth) —
    // ni logs ni metadata lo registraban.
    authMode?: "api_key" | "cli_session";
  };
}

export interface ExecutorEvent {
  type: string;
  data: unknown;
}

export interface RunPhaseOptions {
  signal?: AbortSignal;
  onEvent?: (e: ExecutorEvent) => void;
  timeoutMs?: number;
}

export interface Executor {
  runPhase(invocation: PhaseInvocation, options?: RunPhaseOptions): Promise<PhaseResult>;
}
