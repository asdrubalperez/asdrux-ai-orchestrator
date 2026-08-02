import type { Request, Response } from "express";
import { verifyPassword } from "./password.js";
import { generateRawSessionToken, hashSessionToken, SESSION_TTL_MS } from "./sessionCore.js";
import {
  createSessionRow,
  findUserByHandle,
  findUserById,
  getSessionById,
  revokeSession,
  type UserRow,
} from "../db/repository.js";

export const WEB_SESSION_COOKIE = "orchestrator_session";
export const WEB_SESSION_TTL_MS = SESSION_TTL_MS;
export { generateRawSessionToken, hashSessionToken } from "./sessionCore.js";

export interface AuthenticatedRequest extends Request {
  user?: UserRow;
  sessionId?: string;
}

export interface WebSessionCookie {
  sessionId: string;
  rawToken: string;
}

interface LoginRateLimitEntry {
  failedAttempts: number;
  windowStartedAt: number;
}

const loginRateLimits = new Map<string, LoginRateLimitEntry>();
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX_FAILURES = 5;

export function buildSessionCookieValue(sessionId: string, rawToken: string): string {
  return `${sessionId}.${rawToken}`;
}

export function parseSessionCookieValue(value: string | undefined): WebSessionCookie | null {
  if (!value) return null;
  const separatorIndex = value.indexOf(".");
  if (separatorIndex === -1) return null;
  const sessionId = value.slice(0, separatorIndex);
  const rawToken = value.slice(separatorIndex + 1);
  if (!sessionId || !rawToken) return null;
  return { sessionId, rawToken };
}

export function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

export function sessionCookieHeader(params: {
  value: string;
  maxAgeSeconds: number;
  secure: boolean;
  domain?: string;
}): string {
  return [
    `${WEB_SESSION_COOKIE}=${encodeURIComponent(params.value)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${params.maxAgeSeconds}`,
    "SameSite=None",
    params.secure ? "Secure" : null,
    params.domain ? `Domain=${params.domain}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join("; ");
}

export function expiredSessionCookieHeader(params: { secure: boolean; domain?: string }): string {
  return sessionCookieHeader({ value: "", maxAgeSeconds: 0, secure: params.secure, domain: params.domain });
}

// Previews de Vercel de este proyecto -- patrón acotado al nombre del proyecto, no "*.vercel.app"
// entero (eso aceptaría el origen de cualquier proyecto ajeno de cualquiera con cuenta Vercel).
// Cada rama/deploy nuevo genera un subdominio distinto, impredecible de antemano, así que no
// alcanza con una lista fija en una env var -- de ahí el patrón en vez de un valor exacto.
const VERCEL_PREVIEW_ORIGIN_PATTERN = /^https:\/\/asdrux-ai-orchestrator-[a-z0-9-]+\.vercel\.app$/;

export function isAllowedWebOrigin(origin: string, allowedOrigin: string): boolean {
  return origin === allowedOrigin || VERCEL_PREVIEW_ORIGIN_PATTERN.test(origin);
}

export function allowedOriginForRequest(req: Request, allowedOrigin: string): boolean {
  const origin = req.header("Origin");
  if (origin) return isAllowedWebOrigin(origin, allowedOrigin);

  const referer = req.header("Referer");
  if (!referer) return false;
  try {
    return isAllowedWebOrigin(new URL(referer).origin, allowedOrigin);
  } catch {
    return false;
  }
}

export function loginRateLimitExceeded(clientIp: string, now = Date.now()): boolean {
  const entry = loginRateLimits.get(clientIp);
  if (!entry) return false;
  if (now - entry.windowStartedAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginRateLimits.delete(clientIp);
    return false;
  }
  return entry.failedAttempts >= LOGIN_RATE_LIMIT_MAX_FAILURES;
}

export function recordFailedLogin(clientIp: string, now = Date.now()): void {
  const entry = loginRateLimits.get(clientIp);
  if (!entry || now - entry.windowStartedAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginRateLimits.set(clientIp, { failedAttempts: 1, windowStartedAt: now });
    return;
  }
  entry.failedAttempts += 1;
}

export function clearLoginRateLimit(clientIp: string): void {
  loginRateLimits.delete(clientIp);
}

export function resetLoginRateLimitsForTests(): void {
  loginRateLimits.clear();
}

export function clientIpForRateLimit(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export async function createWebLoginSession(handle: string, password: string) {
  const user = await findUserByHandle(handle);
  if (!user?.password_hash) return null;

  const validPassword = await verifyPassword(password, user.password_hash);
  if (!validPassword) return null;

  const rawToken = generateRawSessionToken();
  const expiresAt = new Date(Date.now() + WEB_SESSION_TTL_MS);
  const session = await createSessionRow({
    userId: user.id,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
  });

  return {
    user,
    session,
    cookieValue: buildSessionCookieValue(session.id, rawToken),
  };
}

export async function authenticateWebRequest(req: Request): Promise<{ user: UserRow; sessionId: string } | null> {
  const cookie = parseCookieHeader(req.header("Cookie")).get(WEB_SESSION_COOKIE);
  const parsedCookie = parseSessionCookieValue(cookie);
  if (!parsedCookie) return null;

  const session = await getSessionById(parsedCookie.sessionId);
  if (!session || session.revoked_at !== null || Date.parse(session.expires_at) <= Date.now()) return null;
  if (hashSessionToken(parsedCookie.rawToken) !== session.token_hash) return null;

  const user = await findUserById(session.user_id);
  if (!user) return null;

  return { user, sessionId: session.id };
}

export async function revokeSessionFromRequest(req: Request): Promise<void> {
  const cookie = parseCookieHeader(req.header("Cookie")).get(WEB_SESSION_COOKIE);
  const parsedCookie = parseSessionCookieValue(cookie);
  if (parsedCookie) await revokeSession(parsedCookie.sessionId);
}

export function requireAllowedOrigin(req: Request, res: Response, allowedOrigin: string): boolean {
  if (allowedOriginForRequest(req, allowedOrigin)) return true;
  res.status(403).json({ error: "invalid_origin" });
  return false;
}
