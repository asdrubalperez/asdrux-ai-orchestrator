import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveClaudeBinary } from "../executor/claudeCodeExecutor.js";
import { discardAttempt, reserveLoginAttempt, type LoginAttempt } from "./aiOAuthLoginRegistry.js";

// FEATURE-025-Parte-2, sección 7.6: adaptador de login oficial de Claude Code
// (`claude auth login --claudeai`). Requiere validación real contra el CLI en el VPS -- el spike
// técnico confirmó el comando y el flujo, pero este adaptador en sí no se pudo probar en este
// entorno de desarrollo (sin cuenta de Claude disponible acá).

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const URL_PATTERN = /https:\/\/\S+/;

// FEATURE-006, mismo criterio de allowlist que claudeCodeExecutor.ts -- nunca process.env completo.
const ALLOWED_ENV_PASSTHROUGH_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "SystemRoot",
  "windir",
  "APPDATA",
  "LOCALAPPDATA",
  "ComSpec",
  "PATHEXT",
  "LANG",
  "LC_ALL",
] as const;

function buildEnv(claudeConfigDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV_PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  return env;
}

export class ClaudeLoginError extends Error {}

export interface LoginChallenge {
  attemptId: string;
  authorizeUrl: string;
}

export interface LoginCompletion {
  /** Contenido crudo de `.credentials.json` -- el caller lo cifra y persiste (Regla 5.6.9). */
  sessionContent: string;
}

interface ActiveClaudeLogin {
  child: ChildProcessWithoutNullStreams;
  temporaryDirectory: string;
  exited: Promise<number | null>;
}

const activeLogins = new Map<string, ActiveClaudeLogin>();

export async function startClaudeLogin(userId: string): Promise<LoginChallenge> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-claude-login-"));
  await chmod(temporaryDirectory, 0o700);

  const binary = resolveClaudeBinary();
  const child = spawn(binary, ["auth", "login", "--claudeai"], {
    env: buildEnv(temporaryDirectory),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });

  let attempt: LoginAttempt;
  try {
    attempt = reserveLoginAttempt({
      userId,
      provider: "claude",
      temporaryDirectory,
      cancel: async () => {
        activeLogins.delete(attempt.attemptId);
        child.kill();
      },
    });
  } catch (err) {
    child.kill();
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  activeLogins.set(attempt.attemptId, { child, temporaryDirectory, exited });

  const authorizeUrl = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(URL_PATTERN);
      if (match) {
        child.stdout.off("data", onData);
        resolve(match[0].trim());
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", () => {
      child.stdout.off("data", onData);
      reject(new ClaudeLoginError("El proceso de login de Claude terminó antes de mostrar una URL."));
    });
    setTimeout(() => {
      child.stdout.off("data", onData);
      reject(new ClaudeLoginError("Timeout esperando la URL de autorización de Claude."));
    }, LOGIN_TIMEOUT_MS);
  });

  return { attemptId: attempt.attemptId, authorizeUrl };
}

export async function submitClaudeLoginCode(attemptId: string, code: string): Promise<LoginCompletion> {
  const active = activeLogins.get(attemptId);
  if (!active) {
    throw new ClaudeLoginError("El intento de login no existe o ya venció.");
  }

  // Regla 5.6.7: el código se escribe una sola vez en stdin.
  active.child.stdin.write(`${code}\n`);
  active.child.stdin.end();

  const exitCode = await active.exited;
  activeLogins.delete(attemptId);

  if (exitCode !== 0) {
    await discardAttempt(attemptId);
    throw new ClaudeLoginError(`El login de Claude terminó con código ${exitCode}.`);
  }

  const credentialsPath = path.join(active.temporaryDirectory, ".credentials.json");
  if (!existsSync(credentialsPath)) {
    await discardAttempt(attemptId);
    throw new ClaudeLoginError("El login de Claude terminó exitosamente pero no se encontró .credentials.json.");
  }
  const sessionContent = await readFile(credentialsPath, "utf8");

  // discardAttempt borra temporaryDirectory -- ya leímos lo que necesitábamos.
  await discardAttempt(attemptId);

  return { sessionContent };
}

export async function cancelClaudeLogin(attemptId: string): Promise<void> {
  activeLogins.delete(attemptId);
  await discardAttempt(attemptId);
}
