import { apiUrl } from "../lib/api";
import type { AgentConfigResponse, AgentRole, AiCredentialStatus, EffectiveAgentConfig } from "./types";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export function getAgentConfig(): Promise<AgentConfigResponse> {
  return request("/agent-config");
}

export function setGlobalAgentConfig(config: EffectiveAgentConfig): Promise<{ config: EffectiveAgentConfig }> {
  return request("/agent-config", { method: "PUT", body: JSON.stringify(config) });
}

export function setRoleAgentConfig(
  role: AgentRole,
  config: EffectiveAgentConfig
): Promise<{ config: EffectiveAgentConfig }> {
  return request(`/agent-config/${encodeURIComponent(role)}`, { method: "PUT", body: JSON.stringify(config) });
}

export function clearRoleAgentConfig(role: AgentRole): Promise<{ ok: true }> {
  return request(`/agent-config/${encodeURIComponent(role)}`, { method: "DELETE" });
}

export function getAiCredentialStatuses(): Promise<{ credentials: AiCredentialStatus[] }> {
  return request("/agent-credentials");
}

export function setAiCredential(
  provider: "claude" | "codex",
  apiKey: string
): Promise<{ credential: AiCredentialStatus }> {
  return request(`/agent-credentials/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function deleteAiCredential(provider: "claude" | "codex"): Promise<{ ok: true }> {
  return request(`/agent-credentials/${encodeURIComponent(provider)}`, { method: "DELETE" });
}
