export type ExecutorProviderName = "claude" | "codex";
export type AuthMode = "api_key" | "cli_session";
export type PipelineAgentRole = "architect" | "functional" | "planning" | "developer" | "qa";
// FEATURE-025-Parte-1 (ampliación): "intake" es el mapeo de texto libre a campos del caso de
// negocio -- no es una fase del pipeline, pero se configura con el mismo mecanismo.
export type AgentRole = PipelineAgentRole | "intake";

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

// FEATURE-025-Parte-2: conexiones OAuth personales por proveedor.
export type OAuthConnectionStatusValue = "not_connected" | "connected" | "reauth_required";

export interface OAuthConnectionStatus {
  provider: ExecutorProviderName;
  status: OAuthConnectionStatusValue;
  lastValidatedAt: string | null;
}

export interface ClaudeLoginChallenge {
  provider: "claude";
  attemptId: string;
  authorizeUrl: string;
}

export interface CodexLoginChallenge {
  provider: "codex";
  attemptId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string | null;
}

export type OAuthLoginChallenge = ClaudeLoginChallenge | CodexLoginChallenge;
