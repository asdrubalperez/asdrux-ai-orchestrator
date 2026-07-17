import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
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
//   - "read-only" se impone restringiendo el toolset (--tools sin Write/Edit/Bash), H1;
//   - "workspace-write" se impone acotando cwd al worktree del run, sin --add-dir fuera de
//     él — el propio CLI bloquea escrituras fuera de ese directorio, H5;
//   - autenticación exclusivamente vía ANTHROPIC_API_KEY + --bare, sin OAuth, H4.

export interface ClaudeCodeExecutorOptions {
  /** Directorio de trabajo del run (el worktree). Todas las invocaciones de esta instancia corren ahí. */
  workingDirectory: string;
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

  constructor(private readonly options: ClaudeCodeExecutorOptions) {}

  async runPhase(invocation: PhaseInvocation, options: RunPhaseOptions = {}): Promise<PhaseResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY no está definida en el entorno del proceso.");
    }

    const tools = this.resolveTools(invocation);
    const args = [
      "-p",
      "--bare",
      "--system-prompt",
      invocation.roleInstructions,
      "--tools",
      tools,
      "--output-format",
      "json",
      "--no-session-persistence",
      "--strict-mcp-config",
    ];

    if (invocation.permissions.filesystem === "workspace-write") {
      args.push("--permission-mode", "acceptEdits");
      this.assertWritableRootsMatchCwd(invocation);
    }

    const prompt = this.buildPrompt(invocation);

    const raw = await this.spawnClaude(args, prompt, apiKey, options);
    return this.mapToPhaseResult(raw);
  }

  private resolveTools(invocation: PhaseInvocation): string {
    if (invocation.permissions.filesystem === "read-only") {
      return "Read,Grep,Glob";
    }
    return "Read,Grep,Glob,Write,Edit,Bash";
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

  private spawnClaude(
    args: string[],
    prompt: string,
    apiKey: string,
    options: RunPhaseOptions
  ): Promise<RawCliResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.claudeBinary, [...args, prompt], {
        cwd: this.options.workingDirectory,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      });

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
          reject(new Error(`claude CLI terminó con código ${code} sin salida. stderr: ${stderr}`));
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

  private mapToPhaseResult(raw: RawCliResult): PhaseResult {
    if (raw.is_error) {
      return {
        status: "failed",
        outputArtifact: null,
        summary: raw.result,
        escalationReason: null,
        executorMetadata: { provider: "claude-code-cli" },
      };
    }

    const parsed = this.parseRoleConvention(raw.result);
    const model = this.dominantModel(raw.modelUsage);

    return {
      status: parsed.status,
      outputArtifact: parsed.artefacto,
      summary: parsed.resumen,
      escalationReason: parsed.razonEscalamiento,
      executorMetadata: { provider: "claude-code-cli", model },
    };
  }

  /**
   * Parsea la convención de texto ESTADO/RESUMEN/ARTEFACTO/RAZON_ESCALAMIENTO usada en
   * roleInstructions — el mismo mecanismo validado en FEATURE-001/002 (H2: la CLI no devuelve
   * PhaseResult estructurado nativamente; --json-schema queda pendiente de adoptar hasta
   * verificarlo contra documentación oficial, ver 02-ARCHITECTURE.md).
   */
  private parseRoleConvention(text: string): {
    status: PhaseStatus;
    resumen: string;
    artefacto: unknown;
    razonEscalamiento: string | null;
  } {
    const extract = (label: string): string | null => {
      const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`);
      const match = text.match(re);
      return match ? match[1].trim() : null;
    };

    const estado = extract("ESTADO");
    const resumen = extract("RESUMEN") ?? "";
    const artefactoRaw = extract("ARTEFACTO");
    const razon = extract("RAZON_ESCALAMIENTO");

    const status: PhaseStatus = estado === "escalated" ? "escalated" : "completed";

    return {
      status,
      resumen,
      artefacto: artefactoRaw && artefactoRaw !== "null" ? artefactoRaw : null,
      razonEscalamiento: razon && razon !== "null" ? razon : null,
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
