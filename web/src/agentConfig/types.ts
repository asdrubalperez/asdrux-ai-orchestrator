export type ExecutorProviderName = "claude" | "codex";
export type AuthMode = "api_key" | "cli_session";
export type AgentRole = "architect" | "functional" | "planning" | "developer" | "qa";

export interface EffectiveAgentConfig {
  executorProvider: ExecutorProviderName;
  authMode: AuthMode;
  model: string | null;
}

export interface AgentConfigResponse {
  global: EffectiveAgentConfig | null;
  roles: Partial<Record<AgentRole, EffectiveAgentConfig | null>>;
  catalog: Record<ExecutorProviderName, string[]>;
}

export interface AiCredentialStatus {
  provider: ExecutorProviderName;
  configured: boolean;
  updatedAt: string | null;
}
