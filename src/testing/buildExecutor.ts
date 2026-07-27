import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// FEATURE-021: entre el turno de Developer y el de QA, el Orquestador garantiza un build fresco
// y determinístico del proyecto gestionado — sin depender de que ningún agente (Developer o QA)
// decida correrlo o recuerde hacerlo bien. Análogo estructural a TestExecutor (mismo perfil
// Docker), con un solo cambio deliberado: el worktree se monta `:rw` en vez de `:ro`, porque este
// es el único paso del pipeline que necesita escribir el resultado de la compilación (ej. dist/).

export interface BuildExecutionResult {
  ran: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const BUILD_RUNNER_IMAGE = "node:22-alpine"; // misma familia que docker/developer.Dockerfile

export class BuildExecutor {
  async runIfNeeded(workingDirectory: string, timeoutMs: number): Promise<BuildExecutionResult> {
    const buildScriptCheck = await this.checkBuildScript(workingDirectory);

    // "missing" (no hay package.json) y "no-script" (hay package.json, pero sin scripts.build)
    // son AMBOS no-op limpio — ninguno es responsabilidad de Developer, el proyecto simplemente
    // no tiene paso de build.
    if (buildScriptCheck === "missing" || buildScriptCheck === "no-script") {
      return { ran: false, exitCode: null, stdout: "", stderr: "", timedOut: false };
    }

    // "invalid" (package.json existe pero no es JSON parseable) NO es lo mismo que "missing" —
    // tratarlo como no-op dejaría a QA validando un dist/ viejo si Developer rompió el archivo
    // por accidente (tiene escritura sobre todo el worktree). Se modela como un build fallido más
    // (mismo camino que un exitCode !== 0), no como una categoría de escalamiento nueva — sigue
    // siendo responsabilidad de Developer.
    if (buildScriptCheck === "invalid") {
      return {
        ran: true,
        exitCode: null,
        stdout: "",
        stderr: `package.json en ${workingDirectory} no es JSON válido — no se pudo determinar si hay un paso de build.`,
        timedOut: false,
      };
    }

    const dockerArgs = [
      "run",
      "--rm",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "node",
      "--pids-limit",
      "128",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "-v",
      `${workingDirectory}:/workspace:rw`, // única diferencia real vs TestExecutor
      "--workdir",
      "/workspace",
      BUILD_RUNNER_IMAGE,
      "npm",
      "run",
      "build", // siempre literal, nunca el string del script tal como aparece en package.json
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("docker", dockerArgs, { shell: false });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ran: true, exitCode: code, stdout, stderr, timedOut });
      });
    });
  }

  /**
   * Distingue 3 casos, no 2:
   * - "missing": no existe `package.json` — específicamente `ENOENT`. No-op limpio.
   * - "invalid": existe pero `JSON.parse` falla — NO es "missing", ver `runIfNeeded`.
   * - "no-script": es JSON válido pero sin `scripts.build` (o vacío) — no-op limpio.
   * - "present": `scripts.build` es un string no vacío.
   *
   * Cualquier error de lectura que no sea `ENOENT` (permisos, I/O, path inaccesible) se relanza —
   * es un error real de infraestructura, no "no hay build". Llega al mismo manejo genérico de
   * infraestructura que ya usa el resto del pipeline (`executePipelineRun`, `run_error`).
   */
  private async checkBuildScript(workingDirectory: string): Promise<"missing" | "invalid" | "no-script" | "present"> {
    let raw: string;
    try {
      raw = await readFile(path.join(workingDirectory, "package.json"), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return "missing";
      }
      throw error;
    }

    let pkg: unknown;
    try {
      pkg = JSON.parse(raw);
    } catch {
      return "invalid";
    }

    const buildScript = (pkg as { scripts?: { build?: unknown } } | null)?.scripts?.build;
    return typeof buildScript === "string" && buildScript.trim().length > 0 ? "present" : "no-script";
  }
}
