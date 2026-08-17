import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FEATURE_TEMPLATE_ASSET = "07-FEATURE-TEMPLATE.md";
export const RUNBOOK_VERSION_ASSET = "VERSION";
/** FEATURE-037: Planning es dueño/consultor directo (04-TESTING-POLICY.md:6). */
export const TESTING_POLICY_ASSET = "04-TESTING-POLICY.md";
/** FEATURE-037: Developer es dueño/consultor directo (05-CODING-STANDARDS.md:6-8). */
export const CODING_STANDARDS_ASSET = "05-CODING-STANDARDS.md";
/**
 * FEATURE-033 (Rule 7/9 de FEATURE-023 Parte 2): Architect es dueño del Project Brief; el template
 * se incorpora al catálogo obligatorio y hereda la validación previa a persistencia documental que
 * ya usa Functional para Feature.
 */
export const PROJECT_BRIEF_TEMPLATE_ASSET = "01-PROJECT-BRIEF-TEMPLATE.md";
/**
 * FEATURE-034 (mismo patrón de FEATURE-033 Rule 7/9 de FEATURE-023 Parte 2): Architect es dueño
 * de Architecture; el template se incorpora al catálogo obligatorio y hereda la validación previa
 * a persistencia documental.
 */
export const ARCHITECTURE_TEMPLATE_ASSET = "02-ARCHITECTURE-TEMPLATE.md";
/**
 * FEATURE-035 (mismo patrón de FEATURE-033/034 Rule 7/9 de FEATURE-023 Parte 2): Planning es
 * dueño del Release Plan; el template se incorpora al catálogo obligatorio y hereda la validación
 * previa a persistencia documental.
 */
export const RELEASE_PLAN_TEMPLATE_ASSET = "09-RELEASE-PLAN-TEMPLATE.md";
export const REQUIRED_RUNBOOK_ASSETS = Object.freeze([
  RUNBOOK_VERSION_ASSET,
  FEATURE_TEMPLATE_ASSET,
  TESTING_POLICY_ASSET,
  CODING_STANDARDS_ASSET,
  PROJECT_BRIEF_TEMPLATE_ASSET,
  ARCHITECTURE_TEMPLATE_ASSET,
  RELEASE_PLAN_TEMPLATE_ASSET,
]);
export const SUPPORTED_RUNBOOK_VERSIONS = Object.freeze(["v1.0"]);

export type RunbookErrorCode =
  | "RUNBOOK_ROOT_INVALID"
  | "RUNBOOK_VERSION_NOT_FOUND"
  | "RUNBOOK_VERSION_UNSUPPORTED"
  | "RUNBOOK_ASSET_NOT_FOUND"
  | "RUNBOOK_ASSET_UNREADABLE"
  | "RUNBOOK_ASSET_PATH_INVALID";

export class RunbookProviderError extends Error {
  constructor(
    public readonly code: RunbookErrorCode,
    message: string,
    public readonly assetRelativePath: string | null = null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "RunbookProviderError";
  }
}

export interface RunbookTextAsset {
  runbookVersion: string;
  assetRelativePath: string;
  assetHash: string;
  content: string;
}

export interface RunbookProviderOptions {
  trustedRoot: string;
  supportedVersions?: readonly string[];
}

/**
 * FEATURE-023 Parte 2: acceso único a los assets internos del Runbook. `trustedRoot` se inyecta
 * desde la composición del producto; nunca se obtiene de agentes, proyectos, business cases,
 * requests ni del cwd.
 */
export class RunbookProvider {
  readonly #configuredRoot: string;
  readonly #supportedVersions: ReadonlySet<string>;

  constructor(options: RunbookProviderOptions) {
    if (!path.isAbsolute(options.trustedRoot)) {
      throw new RunbookProviderError(
        "RUNBOOK_ROOT_INVALID",
        "La raíz confiable del Runbook debe ser absoluta."
      );
    }
    this.#configuredRoot = path.resolve(options.trustedRoot);
    this.#supportedVersions = new Set(options.supportedVersions ?? SUPPORTED_RUNBOOK_VERSIONS);
  }

  async getRunbookVersion(): Promise<string> {
    let bytes: Buffer;
    try {
      bytes = await this.#readBytes(RUNBOOK_VERSION_ASSET);
    } catch (error) {
      if (error instanceof RunbookProviderError && error.code === "RUNBOOK_ASSET_NOT_FOUND") {
        throw new RunbookProviderError(
          "RUNBOOK_VERSION_NOT_FOUND",
          "No se encontró VERSION en los assets del Runbook.",
          RUNBOOK_VERSION_ASSET,
          { cause: error }
        );
      }
      throw error;
    }

    const version = bytes.toString("utf8").trim();
    if (!this.#supportedVersions.has(version)) {
      throw new RunbookProviderError(
        "RUNBOOK_VERSION_UNSUPPORTED",
        `Versión de Runbook no soportada: ${version || "(vacía)"}.`,
        RUNBOOK_VERSION_ASSET
      );
    }
    return version;
  }

  async readText(relativeAssetPath: string): Promise<RunbookTextAsset> {
    const runbookVersion = await this.getRunbookVersion();
    const bytes = await this.#readBytes(relativeAssetPath);
    return {
      runbookVersion,
      assetRelativePath: normalizeAssetPath(relativeAssetPath),
      assetHash: createHash("sha256").update(bytes).digest("hex"),
      content: bytes.toString("utf8"),
    };
  }

  async assertAvailable(requiredAssetPaths: readonly string[]): Promise<void> {
    await this.#validatedRoot();
    await this.getRunbookVersion();
    for (const assetPath of requiredAssetPaths) {
      const bytes = await this.#readBytes(assetPath);
      createHash("sha256").update(bytes).digest();
    }
  }

  async #validatedRoot(): Promise<string> {
    try {
      const root = await realpath(this.#configuredRoot);
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        throw new RunbookProviderError(
          "RUNBOOK_ROOT_INVALID",
          "La raíz confiable del Runbook no es un directorio."
        );
      }
      return root;
    } catch (error) {
      if (error instanceof RunbookProviderError) throw error;
      throw new RunbookProviderError(
        "RUNBOOK_ROOT_INVALID",
        "La raíz confiable del Runbook no existe o no puede utilizarse.",
        null,
        { cause: error }
      );
    }
  }

  async #readBytes(relativeAssetPath: string): Promise<Buffer> {
    const normalized = normalizeAssetPath(relativeAssetPath);
    const root = await this.#validatedRoot();
    const candidate = path.resolve(root, ...normalized.split("/"));
    assertInsideRoot(root, candidate, normalized);

    let resolvedAsset: string;
    try {
      resolvedAsset = await realpath(candidate);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new RunbookProviderError(
          "RUNBOOK_ASSET_NOT_FOUND",
          `Asset del Runbook no encontrado: ${normalized}.`,
          normalized,
          { cause: error }
        );
      }
      throw new RunbookProviderError(
        "RUNBOOK_ASSET_UNREADABLE",
        `No se pudo resolver el asset del Runbook: ${normalized}.`,
        normalized,
        { cause: error }
      );
    }

    assertInsideRoot(root, resolvedAsset, normalized);
    try {
      const assetStat = await stat(resolvedAsset);
      if (!assetStat.isFile()) {
        throw new RunbookProviderError(
          "RUNBOOK_ASSET_UNREADABLE",
          `El asset del Runbook no es un archivo: ${normalized}.`,
          normalized
        );
      }
      return await readFile(resolvedAsset);
    } catch (error) {
      if (error instanceof RunbookProviderError) throw error;
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new RunbookProviderError(
          "RUNBOOK_ASSET_NOT_FOUND",
          `Asset del Runbook no encontrado: ${normalized}.`,
          normalized,
          { cause: error }
        );
      }
      throw new RunbookProviderError(
        "RUNBOOK_ASSET_UNREADABLE",
        `Asset del Runbook ilegible: ${normalized}.`,
        normalized,
        { cause: error }
      );
    }
  }
}

export function normalizeAssetPath(relativeAssetPath: string): string {
  if (!relativeAssetPath || relativeAssetPath.includes("\0")) {
    throw invalidPath(relativeAssetPath);
  }
  if (path.posix.isAbsolute(relativeAssetPath) || path.win32.isAbsolute(relativeAssetPath)) {
    throw invalidPath(relativeAssetPath);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(relativeAssetPath);
  } catch {
    throw invalidPath(relativeAssetPath);
  }
  if (decoded.includes("\0")) {
    throw invalidPath(relativeAssetPath);
  }

  const normalized = decoded.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw invalidPath(relativeAssetPath);
  }
  return segments.join("/");
}

function assertInsideRoot(root: string, candidate: string, assetRelativePath: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw invalidPath(assetRelativePath);
  }
}

function invalidPath(assetRelativePath: string): RunbookProviderError {
  return new RunbookProviderError(
    "RUNBOOK_ASSET_PATH_INVALID",
    `Path de asset inválido: ${assetRelativePath || "(vacío)"}.`,
    assetRelativePath || null
  );
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RUNBOOK_ROOT = path.resolve(moduleDirectory, "..", "..", "assets", "runbook");
export const defaultRunbookProvider = new RunbookProvider({ trustedRoot: DEFAULT_RUNBOOK_ROOT });

export async function assertRunbookAvailableAtStartup(
  provider: RunbookProvider = defaultRunbookProvider
): Promise<void> {
  await provider.assertAvailable(REQUIRED_RUNBOOK_ASSETS);
}
