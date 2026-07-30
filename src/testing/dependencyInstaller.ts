import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// FEATURE-032: entre el turno de Developer y BuildExecutor, el Orquestador garantiza que las
// dependencias npm declaradas por el proyecto estén preparadas en el worktree — sin depender de
// que Developer recuerde instalarlas. Análogo estructural a BuildExecutor (mismo perfil Docker),
// con dos diferencias deliberadas: necesita red (acceso al registry npm) y una caché npm
// explícitamente escribible (el contenedor de Developer es --read-only sin NPM_CONFIG_CACHE
// configurado — causa real confirmada del "tsc: not found" que motivó esta Feature).

export interface DependencyInstallResult {
  ran: boolean;
  command: "npm ci" | "npm install" | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEPENDENCY_INSTALL_IMAGE = "node:22-alpine"; // misma familia que BuildExecutor/TestExecutor

export class DependencyInstaller {
  async installIfNeeded(workingDirectory: string, timeoutMs: number): Promise<DependencyInstallResult> {
    const decision = await this.decide(workingDirectory);

    // "missing" (no hay package.json) y "no-deps" (package.json válido sin dependencias
    // instalables) son AMBOS no-op limpio — mismo criterio que BuildExecutor con "missing"/
    // "no-script" (Regla 6/8 de la Feature).
    if (decision === "missing" || decision === "no-deps") {
      return { ran: false, command: null, exitCode: null, stdout: "", stderr: "", timedOut: false };
    }

    // "invalid" (package.json existe pero no es JSON parseable) es un fallo atribuible al
    // proyecto, no un no-op — mismo tratamiento que BuildExecutor le da a un package.json corrupto
    // (Regla 7 de la Feature).
    if (decision === "invalid") {
      return {
        ran: true,
        command: null,
        exitCode: null,
        stdout: "",
        stderr: `package.json en ${workingDirectory} no es JSON válido — no se pudo determinar qué instalar.`,
        timedOut: false,
      };
    }

    const command = decision; // "npm-ci" | "npm-install"
    const npmSubcommand = command === "npm-ci" ? "ci" : "install";

    const dockerArgs = [
      "run",
      "--rm",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      // Regla 14: caché npm escribible explícita, independiente de $HOME — el contenedor de
      // Developer es --read-only sin NPM_CONFIG_CACHE configurado (causa real del "tsc: not
      // found"). /tmp como tmpfs propio de este paso, nunca compartido con Developer/build/test.
      "--tmpfs",
      "/tmp:rw,nosuid,size=512m",
      "--user",
      "node",
      "--pids-limit",
      "256",
      "--memory",
      "512m",
      "--cpus",
      "2",
      "-e",
      "NPM_CONFIG_CACHE=/tmp/npm-cache",
      "-v",
      `${workingDirectory}:/workspace:rw`, // Regla 11: mismo worktree que build y tests
      "--workdir",
      "/workspace",
      DEPENDENCY_INSTALL_IMAGE,
      "npm",
      npmSubcommand, // Regla 15/16: comando literal fijo, nunca interpretado desde afuera, shell: false
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
        resolve({
          ran: true,
          command: command === "npm-ci" ? "npm ci" : "npm install",
          exitCode: code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  /**
   * Estrategia Algorítmica 6.3/6.4 de la Feature: 4 casos, en este orden de prioridad.
   * - "missing": no existe package.json (ENOENT) -> no-op.
   * - "invalid": existe pero JSON.parse falla -> fallo atribuible al proyecto.
   * - "no-deps": JSON válido sin dependencies/devDependencies/optionalDependencies -> no-op.
   *   peerDependencies por sí solas no cuentan (Regla 8).
   * - "npm-ci" | "npm-install": según exista o no package-lock.json (Regla 9/10).
   */
  private async decide(workingDirectory: string): Promise<"missing" | "invalid" | "no-deps" | "npm-ci" | "npm-install"> {
    let raw: string;
    try {
      raw = await readFile(path.join(workingDirectory, "package.json"), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return "missing";
      }
      throw error; // permisos, I/O, etc. — error real de infraestructura, no "sin dependencias"
    }

    let pkg: unknown;
    try {
      pkg = JSON.parse(raw);
    } catch {
      return "invalid";
    }

    if (!hasInstallableDependencies(pkg)) {
      return "no-deps";
    }

    const hasLockfile = await fileExists(path.join(workingDirectory, "package-lock.json"));
    return hasLockfile ? "npm-ci" : "npm-install";
  }
}

function hasInstallableDependencies(pkg: unknown): boolean {
  if (pkg === null || typeof pkg !== "object") return false;
  const record = pkg as Record<string, unknown>;
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const value = record[key];
    if (value !== null && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0) {
      return true;
    }
  }
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
