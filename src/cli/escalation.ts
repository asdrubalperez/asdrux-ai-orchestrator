import type { AgentRole, PhaseInvocation } from "../contracts/executor.js";
import type { PipelineSpec } from "../pipelines/definitions.js";

export interface EscalationContext {
  escalationReason: string;
  rejectedArtifact: unknown;
  originAgentRole: AgentRole;
  humanSolution: string | null;
}

export function buildEscalationContext(params: {
  escalationReason: string | null;
  rejectedArtifact: unknown;
  originAgentRole: AgentRole;
  humanSolution: string | null;
}): EscalationContext {
  return {
    escalationReason: params.escalationReason ?? "Escalamiento sin razón explícita persistida.",
    rejectedArtifact: params.rejectedArtifact,
    originAgentRole: params.originAgentRole,
    humanSolution: params.humanSolution,
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }

  return value;
}

export function artifactsAreEquivalent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function parsePipelineDefinitionRow(row: {
  name: string;
  version: number;
  definition?: unknown;
}): PipelineSpec {
  const definition = row.definition;
  if (!isPipelineDefinition(definition)) {
    throw new Error(`Definición de pipeline inválida para ${row.name}@${row.version}.`);
  }

  return {
    name: row.name,
    version: row.version,
    definition,
  };
}

function isPipelineDefinition(value: unknown): value is PipelineSpec["definition"] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { phases?: unknown; loop?: unknown };
  if (!Array.isArray(candidate.phases) || candidate.phases.length === 0) return false;

  if (!candidate.phases.every(isPipelinePhase)) return false;
  if (candidate.loop !== undefined && !isLoopSpec(candidate.loop)) return false;
  return true;
}

function isPipelinePhase(value: unknown): value is PipelineSpec["definition"]["phases"][number] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { agentRole?: unknown; permissions?: unknown };
  return isAgentRole(candidate.agentRole) && isPermissions(candidate.permissions);
}

function isLoopSpec(value: unknown): value is NonNullable<PipelineSpec["definition"]["loop"]> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { developerRole?: unknown; qaRole?: unknown; maxAttempts?: unknown };
  return candidate.developerRole === "developer" && candidate.qaRole === "qa" && typeof candidate.maxAttempts === "number";
}

export function isAgentRole(value: unknown): value is AgentRole {
  return value === "architect" || value === "functional" || value === "planning" || value === "developer" || value === "qa";
}

function isPermissions(value: unknown): value is PhaseInvocation["permissions"] {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { filesystem?: unknown; writableRoots?: unknown; allowedCommands?: unknown };
  if (candidate.filesystem !== "read-only" && candidate.filesystem !== "workspace-write") return false;
  if (candidate.writableRoots !== undefined && !isStringArray(candidate.writableRoots)) return false;
  if (candidate.allowedCommands !== undefined && !isStringArray(candidate.allowedCommands)) return false;
  return true;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
