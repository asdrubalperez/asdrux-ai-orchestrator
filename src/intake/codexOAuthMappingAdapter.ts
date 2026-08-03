import { spawn } from "node:child_process";
import readline from "node:readline";
import type { IntakeMappingAdapter, IntakeMappingRequest } from "./intakeMappingAdapters.js";
import {
  IntakeMappingFailedError,
  IntakeMappingInvalidResponseError,
  IntakeMappingTimeoutError,
} from "./intakeMappingErrors.js";
import { ALLOWED_ENV_PASSTHROUGH_KEYS, DEFAULT_CODEX_QA_HOLDER_IMAGE } from "../executor/codexExecutor.js";

// FEATURE-025-Parte-3, sección 3.1/5.9: corre `codex app-server` dentro del mismo holder Docker
// (misma imagen pineada y flags de seguridad) que CodexExecutor usa para los 5 roles reales --
// nunca en el host. A diferencia de runRoleCodexAppServer, NO arranca worker: `thread/start` se
// invoca con `dynamicTools: []`, así que el app-server nunca debería emitir `item/tool/call` -- si
// lo hiciera igual (protocolo real no confirmado sin cuenta real, ver codexLoginAdapter.ts), el
// adaptador falla en vez de intentar servir la tool, para no fabricar una respuesta falsa.
const OAUTH_CONTAINER_PATH = "/isolated/codex-home";

export function createCodexOAuthMappingAdapter(oauthDirectory: string): IntakeMappingAdapter {
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
          "--tmpfs",
          "/home/node/.codex:rw,nosuid,size=64m",
          "--workdir",
          "/holder-empty",
          "-e",
          `CODEX_HOME=${OAUTH_CONTAINER_PATH}`,
          "-v",
          `${oauthDirectory}:${OAUTH_CONTAINER_PATH}`,
          DEFAULT_CODEX_QA_HOLDER_IMAGE,
          "codex",
          "--config",
          "features.shell_tool=false",
          "app-server",
          "--listen",
          "stdio://",
        ];

        const env: NodeJS.ProcessEnv = {};
        for (const key of ALLOWED_ENV_PASSTHROUGH_KEYS) {
          const value = process.env[key];
          if (value !== undefined) env[key] = value;
        }

        const child = spawn("docker", dockerArgs, { env });
        const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

        let requestId = 1;
        let threadId = "";
        let finalText = "";
        let settled = false;
        let initializeId = 0;
        let loginRequestId = 0;
        let threadRequestId = 0;
        let turnRequestId = 0;

        const send = (method: string, params: unknown) => {
          const id = requestId++;
          child.stdin.write(JSON.stringify({ method, id, params }) + "\n");
          return id;
        };

        const timeout = setTimeout(() => {
          fail(new IntakeMappingTimeoutError("Timeout esperando la respuesta de Codex (OAuth)."));
        }, request.timeoutMs);

        function fail(err: Error) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          lines.close();
          child.kill();
          reject(err);
        }

        lines.on("line", (line) => {
          let message: any;
          try {
            message = JSON.parse(line);
          } catch {
            return;
          }

          if (!message.method && message.id === initializeId) {
            if (message.error) return fail(new IntakeMappingFailedError(`Codex (OAuth) initialize falló: ${JSON.stringify(message.error)}`));
            child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
            // Sección 5.9.5: nunca account/login/start acá -- eso pertenece exclusivamente a la
            // pantalla de conexiones (codexLoginAdapter.ts). La sesión ya está materializada.
            loginRequestId = send("account/read", {});
            return;
          }
          if (!message.method && message.id === loginRequestId) {
            if (message.error) return fail(new IntakeMappingFailedError(`Codex (OAuth) account/read falló: ${JSON.stringify(message.error)}`));
            threadRequestId = send("thread/start", {
              cwd: "/holder-empty",
              sandbox: "read-only",
              ephemeral: true,
              environments: [],
              model: request.model ?? undefined,
              // Sección 5.9.7: cero tools, no una lista filtrada.
              dynamicTools: [],
            });
            return;
          }
          if (!message.method && message.id === threadRequestId) {
            if (message.error) return fail(new IntakeMappingFailedError(`Codex (OAuth) thread/start falló: ${JSON.stringify(message.error)}`));
            threadId = message.result?.thread?.id ?? message.result?.threadId ?? "";
            if (!threadId) return fail(new IntakeMappingInvalidResponseError("Codex (OAuth) thread/start no devolvió un thread id."));
            turnRequestId = send("turn/start", {
              threadId,
              input: [{ type: "text", text: `${request.systemPrompt}\n\n${request.userPrompt}` }],
              model: request.model ?? undefined,
              cwd: "/holder-empty",
            });
            return;
          }
          if (!message.method && message.id === turnRequestId && message.error) {
            return fail(new IntakeMappingFailedError(`Codex (OAuth) turn/start falló: ${JSON.stringify(message.error)}`));
          }
          if (message.method === "item/agentMessage/delta" && typeof message.params?.delta === "string") {
            finalText += message.params.delta;
            return;
          }
          if (message.method === "turn/completed") {
            clearTimeout(timeout);
            if (settled) return;
            if (!finalText.trim()) {
              return fail(new IntakeMappingInvalidResponseError("Codex (OAuth) completó el turno sin texto de respuesta."));
            }
            settled = true;
            lines.close();
            child.kill("SIGTERM");
            resolve(finalText.trim());
            return;
          }
          // Sin dynamicTools declaradas, el app-server no debería pedir ninguna tool -- si lo
          // hiciera, o pide cualquier otro método inesperado, se falla en vez de improvisar una
          // respuesta.
          if (message.id !== undefined && message.method) {
            fail(new IntakeMappingFailedError(`Codex (OAuth) pidió un método inesperado: ${message.method}`));
          }
        });

        child.on("error", (err) => fail(new IntakeMappingFailedError(`No se pudo iniciar el contenedor de mapeo de Codex: ${err.message}`)));
        child.once("exit", (code) => {
          if (!settled) fail(new IntakeMappingFailedError(`El contenedor de mapeo de Codex terminó (código ${code}) antes de completar.`));
        });

        initializeId = send("initialize", {
          clientInfo: { name: "asdrux-intake-mapping-holder", title: "Asdrux Intake Mapping Holder", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        });
      });
    },
  };
}
