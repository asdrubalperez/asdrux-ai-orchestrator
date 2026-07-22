import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSessionRow,
  getSessionById,
  revokeSession,
  type SessionRow,
} from "../db/repository.js";
import { generateRawSessionToken, hashSessionToken, SESSION_TTL_MS } from "./sessionCore.js";

const SESSION_DIR = ".orquestador";
const SESSION_FILE = "session.json";
const INVALID_SESSION_MESSAGE = "Sesión expirada o inexistente. Corré 'npm run cli -- login'.";

export interface SessionData {
  sessionId: string;
  rawToken: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface SessionRepositoryDependencies {
  createSessionRow: typeof createSessionRow;
  getSessionById: typeof getSessionById;
  revokeSession: typeof revokeSession;
}

interface SessionFileDependencies {
  readLocalSession: () => Promise<SessionData | null>;
  writeLocalSession: (session: SessionData) => Promise<void>;
  removeLocalSession: () => Promise<void>;
}

export interface SessionDependencies extends SessionRepositoryDependencies, SessionFileDependencies {
  now: () => number;
  generateRawToken: () => string;
  warn: (message: string) => void;
}

export type CloseSessionResult = "closed" | "no_local_session";

export function getSessionPath(): string {
  return path.join(os.homedir(), SESSION_DIR, SESSION_FILE);
}

export function parseSessionData(raw: string): SessionData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(INVALID_SESSION_MESSAGE);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(INVALID_SESSION_MESSAGE);
  }

  const record = parsed as Record<string, unknown>;
  const required = ["sessionId", "rawToken", "userId", "createdAt", "expiresAt"] as const;
  for (const key of required) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new Error(INVALID_SESSION_MESSAGE);
    }
  }

  const session = record as unknown as SessionData;
  if (Number.isNaN(Date.parse(session.createdAt)) || Number.isNaN(Date.parse(session.expiresAt))) {
    throw new Error(INVALID_SESSION_MESSAGE);
  }
  return session;
}

export async function readLocalSession(): Promise<SessionData | null> {
  try {
    return parseSessionData(await readFile(getSessionPath(), "utf8"));
  } catch {
    return null;
  }
}

export async function writeLocalSessionAtomic(session: SessionData): Promise<void> {
  const sessionPath = getSessionPath();
  const sessionDirectory = path.dirname(sessionPath);
  const temporaryPath = `${sessionPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

  await mkdir(sessionDirectory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (process.platform !== "win32") await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, sessionPath);
  } catch (err) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function removeLocalSession(): Promise<void> {
  await rm(getSessionPath());
}

export function validatedSessionData(
  localSession: SessionData,
  sessionRow: SessionRow | null,
  now = Date.now()
): SessionData | null {
  if (!sessionRow || sessionRow.revoked_at !== null) return null;
  if (Date.parse(sessionRow.expires_at) <= now) return null;
  if (hashSessionToken(localSession.rawToken) !== sessionRow.token_hash) return null;
  return { ...localSession, userId: sessionRow.user_id };
}

export async function createSession(
  userId: string,
  dependencies: SessionDependencies = defaultDependencies
): Promise<SessionData> {
  const previousSession = await dependencies.readLocalSession();
  const rawToken = dependencies.generateRawToken();
  const expiresAt = new Date(dependencies.now() + SESSION_TTL_MS);
  const row = await dependencies.createSessionRow({
    userId,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
  });
  const session: SessionData = {
    sessionId: row.id,
    rawToken,
    userId: row.user_id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };

  try {
    await dependencies.writeLocalSession(session);
  } catch (writeError) {
    try {
      await dependencies.revokeSession(row.id);
    } catch (revokeError) {
      throw new Error(
        `No se pudo guardar la sesión local (${errorMessage(writeError)}) ni revocar la fila nueva (${errorMessage(
          revokeError
        )}).`
      );
    }
    throw writeError;
  }

  if (previousSession) {
    try {
      await dependencies.revokeSession(previousSession.sessionId);
    } catch (err) {
      dependencies.warn(
        `Advertencia: el nuevo login se completó, pero no se pudo revocar la sesión anterior: ${errorMessage(err)}`
      );
    }
  }

  return session;
}

export async function readValidSession(
  dependencies: Pick<SessionDependencies, "readLocalSession" | "getSessionById" | "now"> = defaultDependencies
): Promise<SessionData> {
  const localSession = await dependencies.readLocalSession();
  if (!localSession || Date.parse(localSession.expiresAt) <= dependencies.now()) {
    throw new Error(INVALID_SESSION_MESSAGE);
  }

  let row: SessionRow | null;
  try {
    row = await dependencies.getSessionById(localSession.sessionId);
  } catch (err) {
    throw new Error(`No se pudo validar la sesión en el servidor: ${errorMessage(err)}`);
  }

  const validated = validatedSessionData(localSession, row, dependencies.now());
  if (!validated) throw new Error(INVALID_SESSION_MESSAGE);
  return validated;
}

export async function closeSession(
  dependencies: Pick<SessionDependencies, "readLocalSession" | "revokeSession" | "removeLocalSession"> =
    defaultDependencies
): Promise<CloseSessionResult> {
  const localSession = await dependencies.readLocalSession();
  if (!localSession) return "no_local_session";

  try {
    await dependencies.revokeSession(localSession.sessionId);
  } catch (err) {
    throw new Error(
      `No se pudo revocar la sesión en el servidor: ${errorMessage(err)}. El archivo local no fue eliminado.`
    );
  }

  try {
    await dependencies.removeLocalSession();
  } catch (err) {
    throw new Error(
      `La sesión fue revocada en el servidor, pero no se pudo eliminar el archivo local: ${errorMessage(err)}`
    );
  }
  return "closed";
}

const defaultDependencies: SessionDependencies = {
  createSessionRow,
  getSessionById,
  revokeSession,
  readLocalSession,
  writeLocalSession: writeLocalSessionAtomic,
  removeLocalSession,
  now: Date.now,
  generateRawToken: generateRawSessionToken,
  warn: console.warn,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
