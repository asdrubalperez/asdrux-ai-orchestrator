import { apiUrl } from "../lib/api";

export class AuthApiError extends Error {
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
    throw new AuthApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function registerAccount(email: string, password: string, passwordConfirmation: string): Promise<{ ok: true }> {
  return request("/auth/register", { method: "POST", body: JSON.stringify({ email, password, passwordConfirmation }) });
}

export function verifyEmail(token: string): Promise<{ ok: true }> {
  return request("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
}

export function resendVerification(email: string): Promise<{ ok: true }> {
  return request("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
}

export function forgotPassword(email: string): Promise<{ ok: true }> {
  return request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(token: string, password: string, passwordConfirmation: string): Promise<{ ok: true }> {
  return request("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password, passwordConfirmation }) });
}

export function activateAccount(token: string, password: string, passwordConfirmation: string): Promise<{ ok: true }> {
  return request("/auth/activate-account", { method: "POST", body: JSON.stringify({ token, password, passwordConfirmation }) });
}

export function setDisplayName(displayName: string): Promise<{ user: unknown }> {
  return request("/account/display-name", { method: "PATCH", body: JSON.stringify({ displayName }) });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  newPasswordConfirmation: string
): Promise<{ ok: true }> {
  return request("/account/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword, newPasswordConfirmation }),
  });
}
