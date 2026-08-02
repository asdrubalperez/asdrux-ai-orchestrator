import {
  createProjectBranch,
  fetchProjectRepositoryPermissions,
  GitConnectionInvalidError,
  GitConnectionRequiredError,
  projectBranchSha,
  RepositoryNotAccessibleError,
} from "./gitConnectionService.js";
import { GitHubOAuthError } from "./githubOAuthClient.js";

// FEATURE-042, sección D: Gate Git preventivo/autoritativo. Confirmado por la validación técnica
// previa a este diseño que nada de esto existía en FEATURE-026 -- es net-new en su totalidad.

export type BranchValidationStatus =
  | "existing"
  | "creatable"
  | "git_connection_required"
  | "git_connection_invalid"
  | "repository_not_accessible"
  | "repository_read_only"
  | "main_missing"
  | "branch_invalid"
  | "temporary_failure";

export type BranchValidationResult =
  | { status: "existing"; branchName: string }
  | { status: "creatable"; branchName: string; sourceBranch: "main"; warning: string }
  | { status: Exclude<BranchValidationStatus, "existing" | "creatable">; message: string };

export type EnsureBranchResult =
  | { status: "existing"; branchName: string }
  | { status: "created"; branchName: string }
  | { status: Exclude<BranchValidationStatus, "existing" | "creatable">; message: string };

export interface BranchValidationParams {
  userId: string;
  repositoryFullName: string;
  repositoryCloneUrl: string;
  branchName: string;
}

// Sección D.9: reglas mínimas de sintaxis, no de existencia. Se valida antes de tocar red.
export function isValidGitBranchName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  if (name.startsWith("-")) return false;
  if (name.includes("..") || name.includes(" ") || name.includes("~") || name.includes("^") || name.includes(":")) {
    return false;
  }
  if (name.includes("?") || name.includes("*") || name.includes("[") || name.includes("\\")) return false;
  if (name.endsWith(".lock") || name.endsWith(".")) return false;
  return true;
}

// Sección D.9: sugerencia de rama a partir del nombre del caso -- editable por el usuario, nunca
// aceptada sin pasar igual por isValidGitBranchName antes de confirmar.
export function suggestBranchName(caseName: string): string {
  const slug = caseName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `feature/${slug || "caso"}`;
}

interface BranchState {
  mainSha: string;
  branchSha: string | null;
  canPush: boolean;
}

type BranchValidationError = Extract<BranchValidationResult, { status: Exclude<BranchValidationStatus, "existing" | "creatable"> }>;

async function resolveBranchState(params: BranchValidationParams): Promise<BranchState | BranchValidationError> {
  try {
    const { permissions } = await fetchProjectRepositoryPermissions(params.userId, params.repositoryFullName);
    if (!permissions.read) {
      return {
        status: "repository_not_accessible",
        message: "El repositorio ya no es accesible con tu conexión GitHub.",
      };
    }

    const mainSha = await projectBranchSha(params.userId, params.repositoryFullName, "main");
    if (!mainSha) {
      return { status: "main_missing", message: `El repositorio "${params.repositoryFullName}" no tiene una rama "main".` };
    }

    const branchSha = await projectBranchSha(params.userId, params.repositoryFullName, params.branchName);
    return { mainSha, branchSha, canPush: permissions.push };
  } catch (err) {
    if (err instanceof GitConnectionRequiredError) return { status: "git_connection_required", message: err.message };
    if (err instanceof GitConnectionInvalidError) return { status: "git_connection_invalid", message: err.message };
    if (err instanceof RepositoryNotAccessibleError) return { status: "repository_not_accessible", message: err.message };
    if (err instanceof GitHubOAuthError) return { status: "temporary_failure", message: err.message };
    throw err;
  }
}

/**
 * Núcleo compartido de D.4 (preventiva) y D.6 (autoritativa) -- la autoritativa es literalmente
 * una segunda invocación de esta misma función, sin atajos ni resultado cacheado (D.6: "repite
 * todas las comprobaciones porque pudieron cambiar").
 */
async function validateBranch(params: BranchValidationParams): Promise<BranchValidationResult> {
  if (!isValidGitBranchName(params.branchName)) {
    return { status: "branch_invalid", message: `"${params.branchName}" no es un nombre de rama Git válido.` };
  }

  const state = await resolveBranchState(params);
  if ("status" in state) return state;

  if (state.branchSha) {
    return { status: "existing", branchName: params.branchName };
  }

  if (!state.canPush) {
    return {
      status: "repository_read_only",
      message: `No tenés permiso de escritura en "${params.repositoryFullName}" para crear la rama "${params.branchName}".`,
    };
  }

  return {
    status: "creatable",
    branchName: params.branchName,
    sourceBranch: "main",
    warning: `La rama "${params.branchName}" no existe. Se creará automáticamente a partir de "main" cuando inicies el caso de negocio.`,
  };
}

export async function validateForCaseConfirmation(params: BranchValidationParams): Promise<BranchValidationResult> {
  return validateBranch(params);
}

export async function validateForRunStart(params: BranchValidationParams): Promise<BranchValidationResult> {
  return validateBranch(params);
}

/**
 * Sección D.7/D.8: solo tiene sentido invocarla cuando la validación autoritativa (D.6,
 * inmediatamente antes) ya devolvió "creatable". Vuelve a resolver el estado en vez de confiar en
 * el resultado que el caller ya tiene -- si la rama apareció en el medio (carrera de
 * concurrencia), `createProjectBranch` devuelve `already_exists` y se trata como éxito (D.8: "se
 * usa la rama existente si es accesible", nunca se sobrescribe).
 */
export async function ensureBranchForRun(params: BranchValidationParams): Promise<EnsureBranchResult> {
  const state = await resolveBranchState(params);
  if ("status" in state) return state;

  if (state.branchSha) return { status: "existing", branchName: params.branchName };
  if (!state.canPush) {
    return {
      status: "repository_read_only",
      message: `No tenés permiso de escritura en "${params.repositoryFullName}" para crear la rama "${params.branchName}".`,
    };
  }

  try {
    const outcome = await createProjectBranch(params.userId, params.repositoryFullName, params.branchName, state.mainSha);
    return { status: outcome === "created" ? "created" : "existing", branchName: params.branchName };
  } catch (err) {
    if (err instanceof GitConnectionRequiredError) return { status: "git_connection_required", message: err.message };
    if (err instanceof GitConnectionInvalidError) return { status: "git_connection_invalid", message: err.message };
    if (err instanceof GitHubOAuthError) return { status: "temporary_failure", message: err.message };
    throw err;
  }
}
