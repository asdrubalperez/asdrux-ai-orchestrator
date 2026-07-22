import { createHash, randomBytes } from "node:crypto";

export const SESSION_TTL_MS = 48 * 60 * 60 * 1000;

export function generateRawSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
