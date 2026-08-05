import { apiUrl } from "../lib/api";

export class AdminApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof (body as { message?: string })?.message === "string" ? (body as { message: string }).message : `HTTP ${status}`);
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
    throw new AdminApiError(response.status, body);
  }
  return (await response.json()) as T;
}

export type AccountRole = "user" | "admin" | "superadmin";
export type AccountStatus = "pending_verification" | "active" | "suspended";

export interface AdminAccountEntry {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AccountRole;
  status: AccountStatus;
  created_at: string;
  email_verified_at: string | null;
  last_login_at: string | null;
  is_protected_superadmin: boolean;
}

export interface AdminProjectEntry {
  id: string;
  name: string;
  repositoryFullName: string | null;
  agentConfigProfileId: string | null;
  createdAt: string;
}

export function listAccounts(): Promise<{ accounts: AdminAccountEntry[] }> {
  return request("/admin/users");
}

export function createAccount(email: string): Promise<{ user: unknown }> {
  return request("/admin/users", { method: "POST", body: JSON.stringify({ email }) });
}

export function suspendAccount(id: string): Promise<{ user: unknown }> {
  return request(`/admin/users/${encodeURIComponent(id)}/suspend`, { method: "POST" });
}

export function reactivateAccount(id: string): Promise<{ user: unknown }> {
  return request(`/admin/users/${encodeURIComponent(id)}/reactivate`, { method: "POST" });
}

export function promoteToAdmin(id: string): Promise<{ user: unknown }> {
  return request(`/admin/users/${encodeURIComponent(id)}/promote`, { method: "POST" });
}

export function demoteToUser(id: string): Promise<{ user: unknown }> {
  return request(`/admin/users/${encodeURIComponent(id)}/demote`, { method: "POST" });
}

export function resendVerificationByAdmin(id: string): Promise<{ ok: true }> {
  return request(`/admin/users/${encodeURIComponent(id)}/resend-verification`, { method: "POST" });
}

export function getAccountProjects(id: string): Promise<{ projects: AdminProjectEntry[] }> {
  return request(`/admin/users/${encodeURIComponent(id)}/projects`);
}
