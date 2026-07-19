import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SESSION_TTL_DAYS = 30;
const SESSION_DIR = ".orquestador";
const SESSION_FILE = "session.json";

export interface SessionData {
  userId: string;
  token: string;
  createdAt: string;
  expiresAt: string;
}

export function getSessionPath(): string {
  return path.join(os.homedir(), SESSION_DIR, SESSION_FILE);
}

export async function createSession(userId: string): Promise<SessionData> {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + SESSION_TTL_DAYS);

  const session: SessionData = {
    userId,
    token: randomBytes(32).toString("hex"),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const sessionPath = getSessionPath();
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(sessionPath, 0o600);
  }

  return session;
}

export async function readValidSession(): Promise<SessionData> {
  let raw: string;
  try {
    raw = await readFile(getSessionPath(), "utf8");
  } catch {
    throw new Error("Sesión expirada o inexistente. Corré 'npm run cli -- login'.");
  }

  const session = JSON.parse(raw) as SessionData;
  if (!session.userId || !session.token || !session.expiresAt) {
    throw new Error("Sesión expirada o inexistente. Corré 'npm run cli -- login'.");
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error("Sesión expirada o inexistente. Corré 'npm run cli -- login'.");
  }

  return session;
}

export async function clearSession(): Promise<boolean> {
  try {
    await rm(getSessionPath());
    return true;
  } catch {
    return false;
  }
}
