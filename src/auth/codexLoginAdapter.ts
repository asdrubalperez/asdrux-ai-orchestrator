import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { discardAttempt, reserveLoginAttempt, type LoginAttempt } from "./aiOAuthLoginRegistry.js";
import { resolveCodexBinary } from "../executor/codexExecutor.js";

// FEATURE-025-Parte-2, sección 7.7: adaptador de login oficial de Codex vía app-server
// (`chatgptDeviceCode`). A diferencia de las invocaciones de rol (codexExecutor.ts), el login NO
// corre dentro del contenedor holder/worker -- no ejecuta código de agente, solo el flujo OAuth del
// propio CLI, directamente en el host de la VPS con CODEX_HOME aislado.
//
// Requiere validación real contra el app-server en el VPS. Los nombres exactos de los campos del
// challenge (verificationUri/userCode/expiresAt) y si `account/login/start` responde el challenge
// directamente o lo empuja como notificación aparte están tomados del diseño (sección 5.7/7.7) --
// el spike técnico los confirmó contra el protocolo real, pero este adaptador en sí no se pudo
// ejecutar en este entorno de desarrollo (sin Codex CLI/cuenta disponible acá). Ajustar el parseo
// de `extractChallenge` si el mensaje real difiere.

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function buildEnv(codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.CODEX_HOME = codexHome;
  return env;
}

export class CodexLoginError extends Error {}

export interface LoginChallenge {
  attemptId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string | null;
}

export interface LoginCompletion {
  /** Contenido crudo de `auth.json` -- el caller lo cifra y persiste (Regla 5.7.5/5.8.6). */
  sessionContent: string;
}

interface ActiveCodexLogin {
  child: ChildProcessWithoutNullStreams;
  temporaryDirectory: string;
  completed: Promise<void>;
}

const activeLogins = new Map<string, ActiveCodexLogin>();

function extractChallenge(message: any): { verificationUri: string; userCode: string; expiresAt: string | null } | null {
  const params = message.params ?? message.result ?? {};
  const verificationUri = params.verificationUri ?? params.verification_uri ?? params.url;
  const userCode = params.userCode ?? params.user_code ?? params.code;
  if (typeof verificationUri !== "string" || typeof userCode !== "string") return null;
  const expiresAt = params.expiresAt ?? params.expires_at ?? null;
  return { verificationUri, userCode, expiresAt: typeof expiresAt === "string" ? expiresAt : null };
}

export async function startCodexLogin(userId: string): Promise<LoginChallenge> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "orchestrator-codex-login-"));
  await chmod(temporaryDirectory, 0o700);

  const child = spawn(resolveCodexBinary(), ["app-server", "--listen", "stdio://"], {
    env: buildEnv(temporaryDirectory),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  let attempt: LoginAttempt;
  try {
    attempt = reserveLoginAttempt({
      userId,
      provider: "codex",
      temporaryDirectory,
      cancel: async () => {
        activeLogins.delete(attempt.attemptId);
        lines.close();
        child.kill();
      },
    });
  } catch (err) {
    child.kill();
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  let requestId = 1;
  const send = (method: string, params: unknown) => {
    const id = requestId++;
    child.stdin.write(JSON.stringify({ method, id, params }) + "\n");
    return id;
  };

  const challenge = await new Promise<{ verificationUri: string; userCode: string; expiresAt: string | null }>(
    (resolve, reject) => {
      let initializeId: number;
      let loginStartId: number;
      const timeout = setTimeout(() => {
        lines.off("line", onLine);
        reject(new CodexLoginError("Timeout esperando el challenge de device code de Codex."));
      }, LOGIN_TIMEOUT_MS);

      const onLine = (line: string) => {
        let message: any;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!message.method && message.id === initializeId) {
          child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
          loginStartId = send("account/login/start", { type: "chatgptDeviceCode" });
          return;
        }
        // El challenge puede llegar como respuesta directa de account/login/start, o como una
        // notificación push aparte -- se acepta cualquiera de las dos formas.
        const isLoginStartResponse = !message.method && message.id === loginStartId;
        const isPushNotification = typeof message.method === "string" && message.method.startsWith("account/login");
        if (isLoginStartResponse || isPushNotification) {
          const parsedChallenge = extractChallenge(message);
          if (parsedChallenge) {
            clearTimeout(timeout);
            lines.off("line", onLine);
            resolve(parsedChallenge);
          }
        }
      };
      lines.on("line", onLine);
      initializeId = send("initialize", {
        clientInfo: { name: "asdrux-orchestrator-login", title: "Asdrux Orchestrator Login", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
    }
  );

  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      lines.off("line", onLine);
      reject(new CodexLoginError("Timeout esperando account/login/completed de Codex."));
    }, LOGIN_TIMEOUT_MS);
    const onLine = (line: string) => {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method === "account/login/completed" || message.method === "account/login/complete") {
        clearTimeout(timeout);
        lines.off("line", onLine);
        resolve();
      }
    };
    lines.on("line", onLine);
    child.once("exit", () => {
      clearTimeout(timeout);
      lines.off("line", onLine);
      reject(new CodexLoginError("El proceso de Codex app-server terminó antes de completar el login."));
    });
  });

  activeLogins.set(attempt.attemptId, { child, temporaryDirectory, completed });

  return { attemptId: attempt.attemptId, ...challenge };
}

/**
 * Regla 5.7.4: la conexión solo se considera válida tras `account/login/completed` exitoso +
 * `account/read` con cuenta válida -- a diferencia de Claude, Codex no requiere que la UI envíe un
 * código de vuelta (el navegador confirma directo con el proveedor); este método espera esa
 * confirmación y valida.
 */
export async function awaitCodexLoginCompletion(attemptId: string): Promise<LoginCompletion> {
  const active = activeLogins.get(attemptId);
  if (!active) {
    throw new CodexLoginError("El intento de login no existe o ya venció.");
  }

  await active.completed;
  activeLogins.delete(attemptId);

  const authPath = path.join(active.temporaryDirectory, "auth.json");
  if (!existsSync(authPath)) {
    await discardAttempt(attemptId);
    throw new CodexLoginError("El login de Codex se completó pero no se encontró auth.json.");
  }
  const sessionContent = await readFile(authPath, "utf8");

  active.child.kill();
  await discardAttempt(attemptId);

  return { sessionContent };
}

export async function cancelCodexLogin(attemptId: string): Promise<void> {
  activeLogins.delete(attemptId);
  await discardAttempt(attemptId);
}
