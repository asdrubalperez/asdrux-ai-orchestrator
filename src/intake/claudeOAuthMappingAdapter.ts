import { spawn } from "node:child_process";
import type { IntakeMappingAdapter, IntakeMappingRequest } from "./intakeMappingAdapters.js";
import {
  IntakeMappingFailedError,
  IntakeMappingInvalidResponseError,
  IntakeMappingTimeoutError,
} from "./intakeMappingErrors.js";
import {
  ALLOWED_ENV_PASSTHROUGH_KEYS,
  DEFAULT_DEVELOPER_CONTAINER_IMAGE,
  toCliSessionModelAlias,
} from "../executor/claudeCodeExecutor.js";

// FEATURE-025-Parte-3, sección 3.1/5.8: corre `claude -p` dentro del mismo holder Docker (misma
// imagen y flags de seguridad) que ClaudeCodeExecutor usa para los 5 roles reales -- nunca en el
// host, porque acá sí hay una sesión OAuth real materializada procesando texto libre no confiable
// del usuario. A diferencia de runRoleIsolated, NO arranca worker ni monta MCP: no hay tools que
// servir, así que esa mitad de la arquitectura holder/worker (FEATURE-015A) no hace falta.
const OAUTH_CONTAINER_PATH = "/isolated/claude-home";

interface ClaudeCliResult {
  is_error?: boolean;
  result?: string;
}

export function createClaudeOAuthMappingAdapter(oauthDirectory: string): IntakeMappingAdapter {
  return {
    map(request: IntakeMappingRequest): Promise<string> {
      return new Promise((resolve, reject) => {
        const dockerArgs = [
          "run",
          "--rm",
          "-i",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=64m",
          "--tmpfs",
          "/holder-empty:rw,noexec,nosuid,size=16m",
          "--workdir",
          "/holder-empty",
          "-e",
          `CLAUDE_CONFIG_DIR=${OAUTH_CONTAINER_PATH}`,
          "-v",
          `${oauthDirectory}:${OAUTH_CONTAINER_PATH}`,
          DEFAULT_DEVELOPER_CONTAINER_IMAGE,
          "claude",
          "-p",
          "--setting-sources",
          "",
          "--system-prompt",
          request.systemPrompt,
          "--output-format",
          "json",
          "--no-session-persistence",
          // Hallazgo de FEATURE-025-Parte-2: sin --effort explícito, el CLI elige por default un
          // nivel que algunas cuentas OAuth conectadas no tienen habilitado.
          "--effort",
          "medium",
        ];
        if (request.model) dockerArgs.push("--model", toCliSessionModelAlias(request.model));
        dockerArgs.push(request.userPrompt);

        const env: NodeJS.ProcessEnv = {};
        for (const key of ALLOWED_ENV_PASSTHROUGH_KEYS) {
          const value = process.env[key];
          if (value !== undefined) env[key] = value;
        }

        const child = spawn("docker", dockerArgs, { env });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new IntakeMappingTimeoutError("Timeout esperando la respuesta de Claude (OAuth)."));
        }, request.timeoutMs);

        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(new IntakeMappingFailedError(`No se pudo iniciar el contenedor de mapeo de Claude: ${err.message}`));
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          if (code !== 0 && !stdout.trim()) {
            console.error(`[intake-mapping] contenedor Claude OAuth terminó con código ${code}. stderr: ${stderr.slice(0, 2000)}`);
            reject(new IntakeMappingFailedError(`El mapeo con Claude (OAuth) terminó con código ${code}.`));
            return;
          }

          let parsed: ClaudeCliResult;
          try {
            parsed = JSON.parse(stdout);
          } catch (err) {
            reject(new IntakeMappingInvalidResponseError(`No se pudo parsear la salida de Claude (OAuth): ${(err as Error).message}`));
            return;
          }

          if (parsed.is_error || typeof parsed.result !== "string") {
            console.error(`[intake-mapping] Claude OAuth is_error/sin result: ${JSON.stringify(parsed).slice(0, 2000)}`);
            reject(new IntakeMappingInvalidResponseError("Claude (OAuth) no devolvió una respuesta válida."));
            return;
          }
          resolve(parsed.result);
        });
      });
    },
  };
}
