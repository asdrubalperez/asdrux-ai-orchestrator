import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// FEATURE-029: entre el build (FEATURE-021) y la invocación de QA, verifica que COMANDO_TEST sea
// consistente con lo que el proyecto realmente produce — sin descubrir automáticamente el output
// de build, sin interpretar tsconfig/bundlers, sin ejecutar un shell. Reconoce únicamente las dos
// formas soportadas (script de package.json, o `node --test <rutas>`); cualquier otra forma
// conserva el comportamiento previo a esta Feature (no se bloquea).

export type TestCommandValidationResult = { valid: true } | { valid: false; reason: string };

export async function validateTestCommandContract(
  parsed: { executable: string; args: string[] },
  workingDirectory: string
): Promise<TestCommandValidationResult> {
  if (parsed.executable === "npm" && (parsed.args[0] === "test" || parsed.args[0] === "run")) {
    const scriptName = parsed.args[0] === "test" ? "test" : parsed.args[1];
    if (!scriptName) {
      return { valid: false, reason: `COMANDO_TEST "npm run" no declara qué script ejecutar.` };
    }
    return validateNpmScript(workingDirectory, scriptName);
  }

  if (parsed.executable === "node" && parsed.args[0] === "--test") {
    // FEATURE-029, Technical Considerations "Globs y flags": cualquier argumento que empiece con
    // "-" se trata como flag de `node --test`, no como ruta candidata — no se construye un parser
    // completo de Node, solo se distingue lo mínimo para no confundir flags con rutas.
    const pathArgs = parsed.args.slice(1).filter((arg) => !arg.startsWith("-"));
    return validateExplicitPaths(workingDirectory, pathArgs);
  }

  // Forma no reconocida (5.10 / Comportamiento): no se bloquea automáticamente en esta primera
  // versión — conserva el comportamiento previo a esta Feature.
  return { valid: true };
}

async function validateNpmScript(workingDirectory: string, scriptName: string): Promise<TestCommandValidationResult> {
  let raw: string;
  try {
    raw = await readFile(path.join(workingDirectory, "package.json"), "utf8");
  } catch {
    return {
      valid: false,
      reason: `No se pudo leer package.json en ${workingDirectory} para validar el script "${scriptName}".`,
    };
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { valid: false, reason: `package.json en ${workingDirectory} no es JSON válido.` };
  }

  const scripts = (pkg as { scripts?: Record<string, unknown> } | null)?.scripts;
  const script = scripts?.[scriptName];
  if (typeof script !== "string" || script.trim().length === 0) {
    return {
      valid: false,
      reason: `COMANDO_TEST declara el script "${scriptName}", pero package.json no lo define en "scripts".`,
    };
  }
  return { valid: true };
}

async function validateExplicitPaths(
  workingDirectory: string,
  candidatePaths: string[]
): Promise<TestCommandValidationResult> {
  const resolvedRoot = path.resolve(workingDirectory);

  for (const candidate of candidatePaths) {
    if (path.isAbsolute(candidate)) {
      return { valid: false, reason: `COMANDO_TEST no puede declarar una ruta absoluta: "${candidate}".` };
    }

    const resolved = path.resolve(resolvedRoot, candidate);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      return { valid: false, reason: `COMANDO_TEST apunta a una ruta fuera del worktree: "${candidate}".` };
    }

    let stats;
    try {
      stats = await stat(resolved);
    } catch {
      return {
        valid: false,
        reason:
          `COMANDO_TEST apunta a una ruta que no existe después del build: "${candidate}". ` +
          `Alinea el output generado por el build con el COMANDO_TEST ya declarado antes de volver a intentar.`,
      };
    }
    if (!stats.isFile()) {
      return { valid: false, reason: `COMANDO_TEST apunta a "${candidate}", que no es un archivo.` };
    }
  }

  return { valid: true };
}
