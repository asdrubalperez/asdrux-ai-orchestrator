import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { resolveRolePolicy } from "./isolated-tools/rolePolicy.js";
import { callRoleWorker, startRoleWorker } from "./isolated-tools/roleRuntime.js";
import { TOOL_SCHEMAS } from "./isolated-tools/contracts.js";
import type {
  Executor,
  ExecutorEvent,
  PhaseInvocation,
  PhaseResult,
  PhaseStatus,
  RunPhaseOptions,
} from "../contracts/executor.js";

// Adaptador real de Executor para Codex CLI, basado en FEATURE-007/008:
// - invocacion headless via `codex exec`;
// - autenticacion explicita via CODEX_API_KEY;
// - sandbox nativo de Codex (`read-only`) o Docker + `danger-full-access` para escritura;
// - salida estructurada con `--output-schema`.
const ALLOWED_ENV_PASSTHROUGH_KEYS = [
  "PATH",
  "HOME",
  "USER",
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

const PHASE_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["completed", "rejected", "failed", "interrupted", "escalated"],
    },
    outputArtifact: {
      type: ["string", "null"],
    },
    summary: {
      type: "string",
    },
    escalationReason: {
      type: ["string", "null"],
    },
  },
  required: ["status", "outputArtifact", "summary", "escalationReason"],
};

const DEFAULT_CODEX_DEVELOPER_CONTAINER_IMAGE = "ai-orchestrator-codex-developer:latest";
const DEFAULT_CODEX_QA_HOLDER_IMAGE = "feature015a-codex-pin-candidate:0.145.0";
const CONTAINER_SCHEMA_PATH = "/schema/phase-result.schema.json";

// FEATURE-016: ruta donde se monta, de solo lectura, el caché OAuth dedicado del Orquestador
// dentro del holder cuando authMode === "cli_session". CODEX_HOME apunta acá.
const OAUTH_CACHE_CONTAINER_PATH = "/isolated/codex-home";

type CodexAuth =
  | { authMode: "api_key"; apiKey: string }
  | { authMode: "cli_session"; oauthCacheDir: string };

export interface CodexExecutorOptions {
  /** Directorio de trabajo del run (el worktree). Todas las invocaciones de esta instancia corren ahi. */
  workingDirectory: string;
  /** Run real ligado por el Orquestador; nunca proviene de argumentos del agente. */
  requestingRunId: string;
  /** Modelo a pasar explicitamente con `--model`. */
  model?: string;
  /**
   * "container" corre `codex exec` completo dentro de Docker con `--sandbox danger-full-access`;
   * el contenedor impone el limite real para workspace-write. "host" preserva el camino validado
   * para read-only con el sandbox nativo de Codex.
   */
  sandbox?: "host" | "container";
  /** Imagen a usar cuando sandbox === "container". Default: ai-orchestrator-codex-developer:latest. */
  containerImage?: string;
  /**
   * FEATURE-016: "api_key" (default, sin cambios) inyecta CODEX_API_KEY y usa
   * `type:"apiKey"` en `account/login/start`. "cli_session" monta de solo lectura el caché OAuth
   * dedicado apuntado por CODEX_OAUTH_CACHE_DIR (vía CODEX_HOME) y usa `type:"chatgpt"`. Codex no
   * tiene un flag equivalente a `--bare`/`--safe-mode` que bloquee esto (ver
   * docs/features/FEATURE-016-auth-oauth-executors.md sección 7.3).
   */
  authMode?: "api_key" | "cli_session";
  /**
   * FEATURE-025-Parte-1, Regla 5.4.3: requerida cuando authMode === "api_key" -- la resuelve el
   * caller (`resolveExecutorAuthentication`, contra la credencial propia del usuario dueño del
   * run) antes de construir el Executor. Este Executor ya no lee CODEX_API_KEY del entorno del
   * proceso como fuente de ejecución -- sin fallback a una clave global del host.
   */
  apiKey?: string;
  /**
   * FEATURE-025-Parte-2, sección 5.9/7.9: requerido cuando authMode === "cli_session" -- directorio
   * temporal, exclusivo y ESCRIBIBLE materializado por el caller (`materializeOAuthSession`, contra
   * la conexión OAuth personal del usuario dueño del run). Reemplaza el caché global de solo
   * lectura de CODEX_OAUTH_CACHE_DIR -- este Executor ya no lee esa variable de entorno.
   */
  oauthDirectory?: string;
}

interface RawCodexResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export function resolveCodexBinary(): string {
  if (process.platform !== "win32") {
    const home = process.env.HOME;
    const candidates = [
      process.env.CODEX_BINARY,
      home ? path.join(home, ".npm-global", "bin", "codex") : undefined,
      "codex",
    ].filter((candidate): candidate is string => Boolean(candidate));

    const absolute = candidates.find((candidate) => path.isAbsolute(candidate) && existsSync(candidate));
    return absolute ?? "codex";
  }

  const candidates = execFileSync("where", ["codex"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const directExe = candidates.find((c) => c.toLowerCase().endsWith(".exe"));
  if (directExe) return directExe;

  const cmdShim = candidates.find((c) => c.toLowerCase().endsWith(".cmd"));
  if (cmdShim) {
    const shimContent = readFileSync(cmdShim, "utf8");
    const match = shimContent.match(/"%dp0%\\(.*?codex\.exe)"/i);
    if (match) {
      return path.join(path.dirname(cmdShim), match[1]);
    }
  }

  throw new Error(`No se pudo resolver codex.exe a partir de: ${candidates.join(", ")}`);
}

export class CodexExecutor implements Executor {
  private readonly codexBinary = resolveCodexBinary();

  constructor(public readonly options: CodexExecutorOptions) {}

  async runPhase(invocation: PhaseInvocation, options: RunPhaseOptions = {}): Promise<PhaseResult> {
    const authMode = this.options.authMode ?? "api_key";

    if (authMode === "cli_session") {
      // FEATURE-025-Parte-2: ya no lee CODEX_OAUTH_CACHE_DIR del proceso -- el caller materializa
      // la conexión OAuth personal del usuario dueño del run y pasa el directorio resultante acá.
      const oauthCacheDir = this.options.oauthDirectory;
      if (!oauthCacheDir || !existsSync(oauthCacheDir)) {
        throw new Error(
          "oauthDirectory no fue provisto para authMode=cli_session (esperado de materializeOAuthSession)."
        );
      }
      return this.runRoleIsolated(invocation, { authMode, oauthCacheDir }, options);
    }

    // FEATURE-025-Parte-1: sin fallback a CODEX_API_KEY del proceso -- el caller resuelve la
    // credencial propia del usuario antes de construir este Executor (resolveExecutorAuthentication)
    // y la pasa acá. Este chequeo es defensivo (nunca debería dispararse en el camino real).
    const apiKey = this.options.apiKey;
    if (!apiKey) {
      throw new Error("apiKey no fue provista para authMode=api_key (esperada de resolveExecutorAuthentication).");
    }

    return this.runRoleIsolated(invocation, { authMode, apiKey }, options);
  }

  private async runRoleIsolated(
    invocation: PhaseInvocation,
    auth: CodexAuth,
    options: RunPhaseOptions
  ): Promise<PhaseResult> {
    const policy = resolveRolePolicy(invocation.agentRole);
    if (invocation.permissions.filesystem !== policy.filesystem) {
      throw new Error(`${invocation.agentRole} filesystem policy mismatch`);
    }
    if (policy.filesystem === "workspace-write") this.assertWritableRootsMatchCwd(invocation);
    const worker = await startRoleWorker(
      invocation.agentRole,
      this.options.workingDirectory,
      process.env.TAVILY_API_KEY,
      this.options.requestingRunId,
      options.signal,
      (event) => {
        if (event.type === "isolated_tool_call") {
          options.onEvent?.({ type: "isolated_tool_call", data: { ...event, provider: "codex" } });
        }
      },
    );
    options.onEvent?.({
      type: "isolated_inventory",
      data: { role: invocation.agentRole, provider: "codex", tools: [...worker.effectiveTools], nativeTools: [] },
    });
    // FEATURE-016: "api_key" inyecta CODEX_API_KEY (default, sin cambios). "cli_session" nunca
    // inyecta la key: monta el directorio OAuth materializado por el caller y apunta CODEX_HOME
    // ahí — confirmado que CODEX_HOME es la variable real que Codex usa para localizar auth.json
    // (ver docs/features/FEATURE-016-auth-oauth-executors.md sección 7.3). Codex no tiene un
    // equivalente a `--bare`/`--safe-mode` que bloquee esto. FEATURE-025-Parte-2: el montaje pasa
    // a ser escribible (sin `:ro`) -- temporal exclusivo por invocación, el caller lo recoge y
    // promueve después (collectAndPromoteOAuthSession). El contenedor sigue con `--read-only` a
    // nivel global; solo este volumen puntual es escribible.
    const authArgs =
      auth.authMode === "cli_session"
        ? ["-e", `CODEX_HOME=${OAUTH_CACHE_CONTAINER_PATH}`,
           "-v", `${auth.oauthCacheDir}:${OAUTH_CACHE_CONTAINER_PATH}`]
        : ["-e", "CODEX_API_KEY"];

    const dockerArgs = [
      "run", "--rm", "-i", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--tmpfs", "/holder-empty:rw,noexec,nosuid,size=16m",
      "--tmpfs", "/home/node/.codex:rw,nosuid,size=64m",
      "--workdir", "/holder-empty",
      ...authArgs,
      DEFAULT_CODEX_QA_HOLDER_IMAGE,
      "codex", "--config", "features.shell_tool=false",
      "app-server", "--listen", "stdio://",
    ];
    const env =
      auth.authMode === "api_key"
        ? { ...this.buildChildEnv(auth.apiKey), CODEX_API_KEY: auth.apiKey }
        : this.buildChildEnv(undefined);
    try {
      const output = await this.runRoleCodexAppServer(dockerArgs, env, auth, invocation, policy, worker, options);
      const parsed = validatePhaseResult(parseLastJsonObject(output));
      return {
        ...parsed,
        executorMetadata: { provider: "codex", model: this.options.model, authMode: auth.authMode },
      };
    } finally {
      await worker.close();
    }
  }

  private runRoleCodexAppServer(
    dockerArgs: string[],
    env: NodeJS.ProcessEnv,
    auth: CodexAuth,
    invocation: PhaseInvocation,
    policy: ReturnType<typeof resolveRolePolicy>,
    worker: Awaited<ReturnType<typeof startRoleWorker>>,
    options: RunPhaseOptions
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", dockerArgs, { env, stdio: ["pipe", "pipe", "pipe"] });
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      let requestId = 1;
      let threadId = "";
      let finalText = "";
      let settled = false;
      const send = (method: string, params: unknown) => {
        const id = requestId++;
        child.stdin.write(JSON.stringify({ method, id, params }) + "\n");
        return id;
      };
      const initializeId = send("initialize", {
        clientInfo: { name: "asdrux-isolated-holder", title: "Asdrux Isolated Holder", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      let loginRequestId = 0;
      let threadRequestId = 0;
      let turnRequestId = 0;
      let timeout: NodeJS.Timeout | undefined;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        child.kill();
        reject(error);
      };
      timeout = setTimeout(() => fail(new Error("Codex QA app-server timeout")), options.timeoutMs ?? 300_000);
      options.signal?.addEventListener("abort", () => fail(new Error("Codex QA app-server aborted")), { once: true });
      lines.on("line", async (line) => {
        let message: any;
        try { message = JSON.parse(line); }
        catch { fail(new Error("Codex QA app-server emitted invalid JSON")); return; }
        if (!message.method && message.id === initializeId) {
          if (message.error) { fail(new Error(JSON.stringify(message.error))); return; }
          child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
          // FEATURE-025-Parte-2, sección 5.15.4/5: "account/login/start" solo pertenece al
          // adaptador de conexión (codexLoginAdapter.ts) -- nunca se inicia un login nuevo en cada
          // run. Para cli_session, la sesión ya está materializada en CODEX_HOME (auth.json,
          // montado más abajo); se confirma con "account/read" en vez de reintentar login.
          loginRequestId =
            auth.authMode === "cli_session"
              ? send("account/read", {})
              : send("account/login/start", { type: "apiKey", apiKey: env.CODEX_API_KEY });
          return;
        }
        if (!message.method && message.id === loginRequestId) {
          if (message.error) { fail(new Error(JSON.stringify(message.error))); return; }
          threadRequestId = send("thread/start", {
            cwd: "/holder-empty", sandbox: "read-only", ephemeral: true, environments: [],
            model: this.options.model,
            dynamicTools: policy.tools.map((name) => ({
              type: "function", name, description: TOOL_SCHEMAS[name].description,
              inputSchema: TOOL_SCHEMAS[name].args,
            })),
          });
          return;
        }
        if (!message.method && message.id === threadRequestId) {
          if (message.error) { fail(new Error(JSON.stringify(message.error))); return; }
          threadId = message.result?.thread?.id ?? message.result?.threadId ?? "";
          if (!threadId) { fail(new Error("Codex thread/start returned no thread id")); return; }
          options.onEvent?.({
            type: "isolated_holder_thread_started",
            data: { role: invocation.agentRole, provider: "codex", tools: [...policy.tools], nativeTools: [] },
          });
          turnRequestId = send("turn/start", {
            threadId,
            input: [{ type: "text", text: this.buildPrompt(invocation) }],
            model: this.options.model,
            outputSchema: PHASE_RESULT_SCHEMA,
            cwd: "/holder-empty",
          });
          return;
        }
        if (!message.method && message.id === turnRequestId && message.error) {
          fail(new Error(JSON.stringify(message.error))); return;
        }
        if (message.method === "item/fileChange/requestApproval" ||
            message.method === "item/commandExecution/requestApproval") {
          options.onEvent?.({
            type: "isolated_native_tool_denied",
            data: { role: invocation.agentRole, provider: "codex", method: message.method },
          });
          child.stdin.write(JSON.stringify({ id: message.id, result: { decision: "decline" } }) + "\n");
          return;
        }
        if (message.method === "item/tool/call") {
          const params = message.params ?? {};
          if (!policy.tools.includes(params.tool)) {
            child.stdin.write(JSON.stringify({ id: message.id, result: {
              success: false, contentItems: [{ type: "inputText", text: "TOOL_NOT_FOUND" }],
            }}) + "\n");
            return;
          }
          try {
            const result = await callRoleWorker(
              worker,
              params.tool,
              params.arguments,
              AbortSignal.timeout(120_000),
            );
            child.stdin.write(JSON.stringify({ id: message.id, result: {
              success: true,
              contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
            }}) + "\n");
          } catch {
            child.stdin.write(JSON.stringify({ id: message.id, result: {
              success: false, contentItems: [{ type: "inputText", text: "WORKER_UNAVAILABLE" }],
            }}) + "\n");
          }
          return;
        }
        if (message.method === "item/agentMessage/delta" && typeof message.params?.delta === "string") {
          finalText += message.params.delta;
        }
        if (message.method === "turn/completed") {
          clearTimeout(timeout);
          if (settled) return;
          if (!finalText.trim()) {
            fail(new Error("Codex QA turn completed without assistant output: " +
              JSON.stringify(message.params?.turn?.status ?? message.params?.status ?? "unknown")));
            return;
          }
          settled = true;
          child.kill("SIGTERM");
          resolve(finalText.trim());
        }
        if (message.id !== undefined && message.method && message.method !== "item/tool/call") {
          fail(new Error(`Codex QA denied server request: ${message.method}`));
        }
      });
      child.stderr.on("data", (chunk) => options.onEvent?.({
        type: "isolated_holder_stderr",
        data: {
          role: invocation.agentRole,
          provider: "codex",
          text: String(chunk)
            .slice(0, 500)
            .replaceAll(env.CODEX_API_KEY ?? "", env.CODEX_API_KEY ? "[REDACTED]" : ""),
        },
      }));
      child.once("error", fail);
      child.once("exit", (code) => {
        if (!settled) fail(new Error(`Codex QA holder exited early: ${code}`));
      });
    });
  }

  private assertWritableRootsMatchCwd(invocation: PhaseInvocation): void {
    const roots = invocation.permissions.writableRoots ?? [];
    if (roots.length !== 1 || roots[0] !== this.options.workingDirectory) {
      throw new Error(
        `writableRoots debe ser exactamente [workingDirectory] (${this.options.workingDirectory}); recibido: ${JSON.stringify(
          roots
        )}`
      );
    }
  }

  private buildPrompt(invocation: PhaseInvocation): string {
    return [
      "INSTRUCCIONES DE ROL:",
      invocation.roleInstructions,
      "",
      "CAPACIDADES EFECTIVAS: usa exclusivamente las dynamic tools provistas por orchestrator.",
      "No intentes shell_tool, apply_patch, fileChange ni ninguna tool nativa.",
      "Para cambios usa fs_write/fs_edit; para comandos usa command_exec.",
      "",
      "Responde exclusivamente con un objeto JSON que respete el schema provisto por --output-schema.",
      "No agregues Markdown ni texto fuera del JSON final.",
      "",
      "CONTEXTO (artefacto de fase anterior):",
      JSON.stringify(invocation.context, null, 2),
    ].join("\n");
  }

  private buildChildEnv(apiKey?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ALLOWED_ENV_PASSTHROUGH_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (apiKey) env.CODEX_API_KEY = apiKey;
    return env;
  }

  private execAndCapture(
    command: string,
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv | undefined,
    options: RunPhaseOptions
  ): Promise<RawCodexResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = options.timeoutMs
        ? setTimeout(() => {
            if (!settled) {
              child.kill();
              settled = true;
              reject(new Error(`Executor timeout tras ${options.timeoutMs}ms`));
            }
          }, options.timeoutMs)
        : undefined;

      options.signal?.addEventListener("abort", () => {
        if (!settled) {
          child.kill();
          settled = true;
          reject(new Error("Executor abortado por AbortSignal"));
        }
      });

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);

        options.onEvent?.({ type: "process_exit", data: { code } } satisfies ExecutorEvent);
        resolve({ stdout, stderr, exitCode: code });
      });
    });
  }

  private mapToPhaseResult(raw: RawCodexResult): PhaseResult {
    if (raw.exitCode !== 0) {
      throw new Error(
        `codex exec termino con codigo ${raw.exitCode}. stdout: ${raw.stdout}\nstderr: ${raw.stderr}`
      );
    }

    const output = [raw.stdout, raw.stderr].filter(Boolean).join("\n");
    const parsed = parseCodexPhaseResultFromStdout(output);
    const model = extractCodexHeaderValue(output, "model");

    return {
      ...parsed,
      executorMetadata: { provider: "codex", model },
    };
  }
}

export function parseCodexPhaseResultFromStdout(stdout: string): PhaseResult {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .at(-1);

  if (!jsonLine) {
    throw new Error(`No se encontro un objeto JSON final en la salida de Codex.\nstdout: ${stdout}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (err) {
    throw new Error(`No se pudo parsear el JSON final de Codex: ${(err as Error).message}\nlinea: ${jsonLine}`);
  }

  return validatePhaseResult(parsed);
}

export function extractCodexHeaderValue(stdout: string, key: string): string | undefined {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}

export function parseLastJsonObject(output: string): unknown {
  const starts: number[] = [];
  for (let index = 0; index < output.length; index++) {
    if (output[index] === "{") starts.push(index);
  }
  for (const index of starts.reverse()) {
    try { return JSON.parse(output.slice(index)); }
    catch { /* try the previous object boundary */ }
  }
  throw new Error("Codex app-server returned no valid JSON object");
}

function validatePhaseResult(value: unknown): PhaseResult {
  if (!value || typeof value !== "object") {
    throw new Error("La salida JSON de Codex no es un objeto.");
  }

  const candidate = value as Record<string, unknown>;
  const statuses: PhaseStatus[] = ["completed", "rejected", "failed", "interrupted", "escalated"];

  if (!statuses.includes(candidate.status as PhaseStatus)) {
    throw new Error(`status invalido en salida Codex: ${String(candidate.status)}`);
  }
  if (typeof candidate.summary !== "string") {
    throw new Error("summary invalido en salida Codex: debe ser string.");
  }
  if (!("outputArtifact" in candidate)) {
    throw new Error("outputArtifact ausente en salida Codex.");
  }
  if (candidate.escalationReason !== null && typeof candidate.escalationReason !== "string") {
    throw new Error("escalationReason invalido en salida Codex: debe ser string o null.");
  }

  return {
    status: candidate.status as PhaseStatus,
    outputArtifact: candidate.outputArtifact ?? null,
    summary: candidate.summary,
    escalationReason: candidate.escalationReason,
  };
}
