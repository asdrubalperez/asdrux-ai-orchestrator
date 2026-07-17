import { spawn } from "node:child_process";

// FEATURE-006 (resuelve H14): el comando de test que Planning define ya NO lo ejecuta el agente
// QA vía Bash (esa vía nunca confinó realmente qué comando corría — ver
// docs/research/H14-command-confinement.md). Lo ejecuta este componente del propio Orquestador,
// como executable + args estructurados (nunca un string de shell), dentro de un contenedor Docker
// efímero sin red. QA solo recibe el resultado estructurado (stdout/stderr/exitCode) como contexto.

export interface TestExecutionRequest {
  executable: string;
  args: string[];
  workingDirectory: string;
  timeoutMs: number;
  /** Allowlist explícita — nunca se hereda el entorno del Orquestador (mismo criterio que H14 punto 1). */
  environment?: Record<string, string>;
}

export interface TestExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const TEST_RUNNER_IMAGE = "node:22-alpine";

export class TestExecutor {
  async run(request: TestExecutionRequest): Promise<TestExecutionResult> {
    const dockerArgs = [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp",
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
      `${request.workingDirectory}:/workspace:ro`,
      "--workdir",
      "/workspace",
    ];

    for (const [key, value] of Object.entries(request.environment ?? {})) {
      dockerArgs.push("-e", `${key}=${value}`);
    }

    dockerArgs.push(TEST_RUNNER_IMAGE, request.executable, ...request.args);

    return new Promise((resolve, reject) => {
      const child = spawn("docker", dockerArgs, { shell: false });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, request.timeoutMs);

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
        resolve({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}

/**
 * Planning declara el comando como un string ("node --test src/x.test.mjs"). Se parsea a
 * executable + args por espacios — suficiente para el único caso soportado hoy (el test runner
 * nativo de Node, sin argumentos citados/con espacios). Documentado como simplificación conocida,
 * no un parser de shell completo.
 */
export function parseTestCommand(comandoTest: string): { executable: string; args: string[] } {
  const parts = comandoTest.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`COMANDO_TEST vacío o no parseable: "${comandoTest}"`);
  }
  return { executable: parts[0], args: parts.slice(1) };
}
