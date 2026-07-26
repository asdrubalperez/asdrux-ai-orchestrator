import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TOOL_SCHEMAS } from "./isolated-tools/contracts.js";
import { mcpToolNames, resolveRolePolicy } from "./isolated-tools/rolePolicy.js";
import { roleMcpBridgePath, startRoleWorker } from "./isolated-tools/roleRuntime.js";
import type {
  Executor,
  ExecutorEvent,
  PhaseInvocation,
  PhaseResult,
  PhaseStatus,
  RunPhaseOptions,
} from "../contracts/executor.js";

// Adaptador real de Executor para Claude Code — mecanismo confirmado empíricamente en
// FEATURE-001 (docs/features/FEATURE-001-spike-results.md) y FEATURE-002
// (docs/features/FEATURE-002-spike-results.md):
//   - invocación headless vía Claude Code CLI (`claude -p`), no Agent SDK;
//   - toda capacidad de filesystem, comando y red se media por el runtime aislado;
//   - autenticación exclusivamente vía ANTHROPIC_API_KEY + --bare, sin OAuth, H4.

// FEATURE-006 (resuelve H14): el proceso hijo NUNCA hereda el process.env completo del
// Orquestador — eso exponía DATABASE_URL_DEV (y cualquier otro secreto) a cada invocación, sin
// importar el rol. Solo se reenvían las variables de sistema estrictamente necesarias para que
// Node y el propio CLI funcionen (resolución de rutas, directorios temporales, localización);
// todo lo demás requiere pasarse explícitamente (ver buildChildEnv).
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

const DEFAULT_DEVELOPER_CONTAINER_IMAGE = "ai-orchestrator-developer:latest";

// FEATURE-016: ruta donde se monta, de solo lectura, el caché OAuth dedicado del Orquestador
// dentro del holder cuando authMode === "cli_session". Nunca el HOME personal del operador.
const OAUTH_CACHE_CONTAINER_PATH = "/isolated/claude-home";

type ClaudeAuth =
  | { authMode: "api_key"; apiKey: string }
  | { authMode: "cli_session"; oauthCacheDir: string };

export interface ClaudeCodeExecutorOptions {
  /** Directorio de trabajo del run (el worktree). Todas las invocaciones de esta instancia corren ahí. */
  workingDirectory: string;
  /**
   * Alias de modelo (--model, ej. "haiku") a usar en esta instancia. Pensado para pruebas de
   * spikes/Features: usar un modelo económico por default y solo justificar explícitamente uno
   * más potente cuando una tarea puntual lo amerite (decisión del owner, 2026-07-17). No aplica
   * necesariamente a la decisión de modelo del Executor real de producción.
   */
  model?: string;
  /**
   * FEATURE-006 (resuelve H14): "container" corre la invocación COMPLETA de Claude Code —incluida
   * su herramienta Bash interna— dentro de un contenedor Docker endurecido, en vez de en el host.
   * Necesario para fases con Bash real (developer), donde el confinamiento por restricción de
   * toolset (H1) no aplica. "host" (default) preserva el mecanismo ya validado para fases sin
   * Bash o donde el sandbox de rutas del propio CLI alcanza (architect, functional, planning, qa).
   */
  sandbox?: "host" | "container";
  /** Imagen a usar cuando sandbox === "container". Default: ai-orchestrator-developer:latest. */
  containerImage?: string;
  /**
   * FEATURE-016: "api_key" (default, sin cambios) inyecta ANTHROPIC_API_KEY como hoy y corre con
   * `--bare`. "cli_session" monta de solo lectura el caché OAuth dedicado apuntado por
   * CLAUDE_OAUTH_CACHE_DIR, corre sin `--bare` (deshabilita OAuth de raíz, ver
   * docs/features/FEATURE-016-auth-oauth-executors.md sección 7.4) y agrega
   * `--setting-sources ""` para suprimir hooks y auto-discovery de CLAUDE.md.
   */
  authMode?: "api_key" | "cli_session";
}

interface RawCliResult {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  modelUsage?: Record<string, { outputTokens?: number }>;
}

// En Windows, `claude` suele resolverse a un shim .cmd que envuelve el .exe real. Invocar el
// .cmd requiere shell:true, y cmd.exe no puede transportar argumentos multilínea (roleInstructions
// y el prompt con contexto JSON los tienen) — los trunca/rompe. Se resuelve y se invoca el .exe
// real directamente para evitar el shell por completo.
function resolveClaudeBinary(): string {
  if (process.platform !== "win32") return "claude";

  const candidates = execFileSync("where", ["claude"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const directExe = candidates.find((c) => c.toLowerCase().endsWith(".exe"));
  if (directExe) return directExe;

  // npm global instala un shim .cmd que apunta al .exe real dentro de node_modules — se parsea
  // ese shim en vez de asumir la ruta, para no hardcodear la estructura interna del paquete.
  const cmdShim = candidates.find((c) => c.toLowerCase().endsWith(".cmd"));
  if (cmdShim) {
    const shimContent = readFileSync(cmdShim, "utf8");
    const match = shimContent.match(/"%dp0%\\(.*?claude\.exe)"/i);
    if (match) {
      return path.join(path.dirname(cmdShim), match[1]);
    }
  }

  throw new Error(`No se pudo resolver claude.exe a partir de: ${candidates.join(", ")}`);
}

export class ClaudeCodeExecutor implements Executor {
  private readonly claudeBinary = resolveClaudeBinary();

  constructor(public readonly options: ClaudeCodeExecutorOptions) {}

  async runPhase(invocation: PhaseInvocation, options: RunPhaseOptions = {}): Promise<PhaseResult> {
    const authMode = this.options.authMode ?? "api_key";

    if (authMode === "cli_session") {
      const oauthCacheDir = process.env.CLAUDE_OAUTH_CACHE_DIR;
      if (!oauthCacheDir || !existsSync(oauthCacheDir)) {
        throw new Error(
          "authMode=cli_session requiere sesión OAuth válida; no encontrada o vencida " +
          "(CLAUDE_OAUTH_CACHE_DIR ausente o el directorio no existe)."
        );
      }
      return this.runRoleIsolated(invocation, { authMode, oauthCacheDir }, options);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no está definida en el entorno del proceso.");
    }

    return this.runRoleIsolated(invocation, { authMode, apiKey }, options);
  }

  private async runRoleIsolated(
    invocation: PhaseInvocation,
    auth: ClaudeAuth,
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
      options.signal,
      (event) => {
        if (event.type === "isolated_tool_call") {
          options.onEvent?.({ type: "isolated_tool_call", data: { ...event, provider: "claude" } });
        }
      },
    );
    const isolatedMcpTools = mcpToolNames(policy);
    const temporary = await mkdtemp(path.join(os.tmpdir(), `${invocation.agentRole}-claude-holder-`));
    const configPath = path.join(temporary, "mcp.json");
    try {
      await writeFile(configPath, JSON.stringify({
        mcpServers: {
          orchestrator_worker: {
            type: "stdio",
            command: "node",
            args: ["/isolated/roleMcpBridge.mjs"],
            env: {
              ISOLATED_WORKER_SOCKET: "/channel/worker.sock",
              ISOLATED_CHANNEL_TOKEN: worker.channelToken,
              ISOLATED_TOOL_SCHEMAS: JSON.stringify(Object.fromEntries(
                policy.tools.map((name) => [name, TOOL_SCHEMAS[name].args]),
              )),
            },
            alwaysLoad: true,
          },
        },
      }), "utf8");
      options.onEvent?.({
        type: "isolated_inventory",
        data: { role: invocation.agentRole, provider: "claude", tools: [...worker.effectiveTools], nativeTools: [] },
      });
      // FEATURE-016: "api_key" inyecta ANTHROPIC_API_KEY y corre con `--bare` (default, sin
      // cambios). "cli_session" nunca inyecta la key: monta de solo lectura el caché OAuth
      // dedicado y corre SIN `--bare` porque --bare deshabilita OAuth de raíz (confirmado, ver
      // docs/features/FEATURE-016-auth-oauth-executors.md sección 7.4) — se agrega
      // `--setting-sources ""` como mitigación parcial (suprime hooks y auto-discovery de
      // CLAUDE.md; LSP/plugin-sync/prefetch de red quedan activos, riesgo aceptado explícitamente
      // por el owner, ver sección 9 de esa Feature).
      const authArgs =
        auth.authMode === "cli_session"
          ? ["-e", `CLAUDE_CONFIG_DIR=${OAUTH_CACHE_CONTAINER_PATH}`,
             "-v", `${auth.oauthCacheDir}:${OAUTH_CACHE_CONTAINER_PATH}:ro`]
          : ["-e", "ANTHROPIC_API_KEY"];
      const cliModeArgs = auth.authMode === "cli_session" ? ["--setting-sources", ""] : ["--bare"];

      const args = [
        "run", "--rm", "-i", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
        "--tmpfs", "/holder-empty:rw,noexec,nosuid,size=16m",
        "--workdir", "/holder-empty",
        ...authArgs,
        "-v", `${worker.socketDirectory}:/channel:rw`,
        "-v", `${roleMcpBridgePath()}:/isolated/roleMcpBridge.mjs:ro`,
        "-v", `${configPath}:/isolated/mcp.json:ro`,
        this.options.containerImage ?? DEFAULT_DEVELOPER_CONTAINER_IMAGE,
        "claude", "-p", ...cliModeArgs,
        "--system-prompt", invocation.roleInstructions,
        "--tools", isolatedMcpTools.join(","),
        ...isolatedMcpTools.flatMap((tool) => ["--allowedTools", tool]),
        "--mcp-config", "/isolated/mcp.json",
        "--strict-mcp-config",
        "--settings", JSON.stringify({ enabledMcpjsonServers: ["orchestrator_worker"] }),
        "--output-format", "json",
        "--no-session-persistence",
      ];
      if (this.options.model) args.push("--model", this.options.model);
      args.push(this.buildPrompt(invocation));
      const raw = await this.execAndCapture("docker", args, undefined, {
        ...this.buildChildEnv(auth.authMode === "api_key" ? auth.apiKey : undefined),
        ...(auth.authMode === "api_key" ? { ANTHROPIC_API_KEY: auth.apiKey } : {}),
      }, options);
      return this.mapToPhaseResult(raw, auth.authMode);
    } finally {
      await worker.close();
      await rm(temporary, { recursive: true, force: true });
    }
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
      "CONTEXTO (artefacto de fase anterior):",
      "",
      JSON.stringify(invocation.context, null, 2),
    ].join("\n");
  }

  /** FEATURE-006: allowlist explícita — nunca `{ ...process.env }`. Ver H14. */
  private buildChildEnv(apiKey?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ALLOWED_ENV_PASSTHROUGH_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    return env;
  }

  private execAndCapture(
    command: string,
    args: string[],
    cwd: string | undefined,
    env: NodeJS.ProcessEnv | undefined,
    options: RunPhaseOptions
  ): Promise<RawCliResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env });

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

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`"${command}" terminó con código ${code} sin salida. stderr: ${stderr}`));
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          reject(new Error(`No se pudo parsear la salida JSON del CLI: ${(err as Error).message}\nstdout: ${stdout}`));
        }
      });
    });
  }

  private mapToPhaseResult(raw: RawCliResult, authMode: "api_key" | "cli_session"): PhaseResult {
    if (raw.is_error) {
      return {
        status: "failed",
        outputArtifact: null,
        summary: raw.result,
        escalationReason: null,
        executorMetadata: { provider: "claude-code-cli", authMode },
      };
    }

    const parsed = this.parseRoleConvention(raw.result);
    const model = this.dominantModel(raw.modelUsage);

    // COMANDO_TEST (rol Planning, FEATURE-005), ROADMAP (rol Architect, FEATURE-018), FEATURES
    // (rol Functional, FEATURE-019), RELEASE_PLAN y RELEASE_COMPLETO (rol Planning, FEATURE-019)
    // son campos propios de un rol puntual, ajenos al contrato genérico de PhaseResult. Cuando
    // alguno está presente, se adjunta junto al texto de ARTEFACTO en vez de agregar un campo nuevo
    // al contrato — los demás roles/casos siguen recibiendo outputArtifact como string plano, sin
    // cambios (backward-compatible con FEATURE-001/002/003/004).
    const extras: Record<string, string> = {};
    if (parsed.comandoTest) extras.comandoTest = parsed.comandoTest;
    if (parsed.roadmap) extras.roadmap = parsed.roadmap;
    if (parsed.features) extras.features = parsed.features;
    if (parsed.releasePlan) extras.releasePlan = parsed.releasePlan;
    if (parsed.releaseCompleto) extras.releaseCompleto = parsed.releaseCompleto;
    const outputArtifact =
      Object.keys(extras).length > 0 ? { text: parsed.artefacto, ...extras } : parsed.artefacto;

    return {
      status: parsed.status,
      outputArtifact,
      summary: parsed.resumen,
      escalationReason: parsed.razonEscalamiento,
      executorMetadata: { provider: "claude-code-cli", model, authMode },
    };
  }

  /**
   * Parsea la convención de texto ESTADO/RESUMEN/ARTEFACTO/RAZON_ESCALAMIENTO (+ COMANDO_TEST
   * opcional, usado solo por el rol Planning; + ROADMAP opcional, usado solo por el rol Architect,
   * FEATURE-018; + FEATURES opcional, usado solo por el rol Functional, y RELEASE_COMPLETO
   * opcional, usado solo por el rol Planning, ambos FEATURE-019) usada en roleInstructions — el
   * mismo mecanismo validado en FEATURE-001/002 (H2: la CLI no devuelve PhaseResult estructurado
   * nativamente; --json-schema queda pendiente de adoptar hasta verificarlo contra documentación
   * oficial, ver 02-ARCHITECTURE.md). El regex de extracción por etiqueta es genérico — agregar una
   * etiqueta nueva no afecta el parseo de las existentes, sin importar su posición en el texto.
   */
  private parseRoleConvention(text: string): {
    status: PhaseStatus;
    resumen: string;
    artefacto: unknown;
    razonEscalamiento: string | null;
    comandoTest: string | null;
    roadmap: string | null;
    features: string | null;
    releasePlan: string | null;
    releaseCompleto: string | null;
  } {
    // Defensa adicional (FEATURE-005, H12): modelos más económicos (ej. haiku) no siempre
    // respetan "texto plano sin Markdown" al pie de la letra — envuelven las etiquetas en
    // **negrita** o usan encabezados "#", rompiendo el parseo estricto. Se despoja Markdown
    // antes de extraer, en vez de asumir que el modelo lo va a respetar siempre.
    const cleaned = text.replace(/\*\*/g, "").replace(/^#+\s*/gm, "");

    const extract = (label: string): string | null => {
      const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`);
      const match = cleaned.match(re);
      return match ? match[1].trim() : null;
    };

    const estado = extract("ESTADO");
    const resumen = extract("RESUMEN") ?? "";
    const artefactoRaw = extract("ARTEFACTO");
    const razon = extract("RAZON_ESCALAMIENTO");
    const comandoTest = extract("COMANDO_TEST");
    const roadmap = extract("ROADMAP");
    const features = extract("FEATURES");
    const releasePlan = extract("RELEASE_PLAN");
    const releaseCompleto = extract("RELEASE_COMPLETO");

    const status: PhaseStatus =
      estado === "escalated" ? "escalated" : estado === "rejected" ? "rejected" : "completed";

    return {
      status,
      resumen,
      artefacto: artefactoRaw && artefactoRaw !== "null" ? artefactoRaw : null,
      razonEscalamiento: razon && razon !== "null" ? razon : null,
      features: features && features !== "null" ? features : null,
      releasePlan: releasePlan && releasePlan !== "null" ? releasePlan : null,
      releaseCompleto: releaseCompleto && releaseCompleto !== "null" ? releaseCompleto : null,
      comandoTest: comandoTest && comandoTest !== "null" ? comandoTest : null,
      roadmap: roadmap && roadmap !== "null" ? roadmap : null,
    };
  }

  private dominantModel(modelUsage?: Record<string, { outputTokens?: number }>): string | undefined {
    if (!modelUsage) return undefined;
    const entries = Object.entries(modelUsage);
    if (entries.length === 0) return undefined;
    entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
    return entries[0][0];
  }
}
