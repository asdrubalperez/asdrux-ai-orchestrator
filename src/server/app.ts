import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateWebRequest,
  clearLoginRateLimit,
  clientIpForRateLimit,
  createWebLoginSession,
  expiredSessionCookieHeader,
  isAllowedWebOrigin,
  loginRateLimitExceeded,
  recordFailedLogin,
  requireAllowedOrigin,
  revokeSessionFromRequest,
  sessionCookieHeader,
  WEB_SESSION_TTL_MS,
  type AuthenticatedRequest,
} from "../auth/webSession.js";
import {
  getCurrentProjectConfig,
  getReleasePlansByRelease,
  getChildRunId,
  getRunDetailForUser,
  getGlobalAgentConfig,
  setGlobalAgentConfig,
  listAgentConfigProfiles,
  countAgentConfigProfiles,
  getAgentConfigProfileById,
  createAgentConfigProfile,
  renameAgentConfigProfile,
  deleteAgentConfigProfile,
  listProfileAgentConfigOverrides,
  setProfileAgentConfigOverride,
  deleteProfileAgentConfigOverride,
  setProjectAgentConfigProfile,
  listProjectsForUser,
  MAX_AGENT_CONFIG_PROFILES_PER_USER,
  isConfigurableAgentRole,
  type AgentConfigProfileRow,
  type AuthMode,
  type EffectiveAgentConfig,
  type ExecutorProviderName,
} from "../db/repository.js";
import {
  AgentCredentialMissingError,
  listAiCredentialStatuses,
  removeAiCredential,
  setAiCredential,
} from "../auth/aiCredentialService.js";
import {
  activateAccount,
  changePassword,
  completeOnboardingDisplayName,
  InvalidDisplayNameError,
  InvalidOrExpiredTokenError,
  PasswordConfirmationMismatchError,
  registerAccount,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  verifyEmail,
  WeakPasswordError,
} from "../auth/accountService.js";
import {
  assertAdminOrAbove,
  CannotActOnSelfError,
  CannotActOnTargetError,
  createAccount,
  demoteToUser,
  DuplicateAccountError,
  InsufficientRoleError,
  listAccounts,
  promoteToAdmin,
  reactivateAccount,
  resendVerificationByAdmin,
  suspendAccount,
  TargetNotFoundError,
} from "../auth/accountAdminService.js";
import { rateLimitExceeded, recordRateLimitAttempt, RATE_LIMIT_BUCKETS } from "../auth/rateLimit.js";
import { AGENT_MODEL_CATALOG, isModelSupportedByProvider } from "../executor/agentModelCatalog.js";
import { LoginInProgressError } from "../auth/aiOAuthLoginRegistry.js";
import { ClaudeLoginError } from "../auth/claudeLoginAdapter.js";
import { CodexLoginError } from "../auth/codexLoginAdapter.js";
import {
  cancelOAuthLogin,
  disconnectOAuth,
  listOAuthConnectionStatuses,
  pollCodexOAuthLogin,
  startOAuthLogin,
  submitOAuthLoginCode,
} from "../auth/aiOAuthConnectionService.js";
import {
  completeGitHubOAuth,
  disconnectGitHub,
  getConnectionStatus,
  GitConnectionInvalidError,
  GitConnectionRequiredError,
  GitHubIdentityAlreadyLinkedError,
  listUserAccessibleRepositories,
  OAuthStateInvalidError,
  startGitHubOAuth,
} from "../auth/gitConnectionService.js";
import {
  EscalationRunNotFoundError,
  respondToEscalation,
  type EscalationResponseAction,
} from "../cli/respondService.js";
import {
  cancelRun,
  confirmIntake,
  confirmIntakeForProject,
  IntakeMappingAuthModeUnsupportedError,
  IntakeMappingProjectNotFoundError,
  IntakeMappingProviderUnsupportedError,
  IntakeProjectNotFoundError,
  listMyCases,
  mapIntakeText,
  startPendingRun,
  validateProjectCaseBranch,
} from "../cli/intakeService.js";
import {
  createProjectForUser,
  getProjectSummary,
  listProjectCaseTree,
  listProjects,
  selectProject,
  setProjectRepositoryForUser,
  updateProjectNameForUser,
} from "../cli/projectService.js";
import type { BusinessCaseValues } from "../intake/mapBusinessCase.js";
import { IntakeMappingError } from "../intake/intakeMappingErrors.js";
import { buildRunViewModel, toReleaseRoadmapView } from "./runView.js";
import { openRunEventsStream } from "./sse.js";
import { getFeatureDocumentForRun } from "../features/lifecycle.js";
import { getProjectBriefDocumentForRun } from "../features/projectBriefLifecycle.js";
import { getArchitectureDocumentForRun } from "../features/architectureLifecycle.js";
import { getReleasePlanDocumentForRun } from "../features/releasePlanLifecycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  allowedOrigin: string;
  cookieSecure: boolean;
  cookieDomain?: string;
}

export function createApp(config: ServerConfig): express.Express {
  const app = express();
  app.set("trust proxy", 1);

  app.use(corsMiddleware(config.allowedOrigin));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/auth/login", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const clientIp = clientIpForRateLimit(req);
      if (loginRateLimitExceeded(clientIp)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }

      const { handle, password } = loginBody(req.body);
      if (!handle || !password) {
        recordFailedLogin(clientIp);
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }

      const login = await createWebLoginSession(handle, password);
      if (login.kind === "invalid_credentials") {
        recordFailedLogin(clientIp);
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      if (login.kind === "not_verified") {
        res.status(403).json({ error: "account_not_verified", message: "Tu cuenta todavía no verificó el email." });
        return;
      }
      if (login.kind === "suspended") {
        res.status(403).json({ error: "account_suspended", message: "Tu cuenta está suspendida." });
        return;
      }

      clearLoginRateLimit(clientIp);
      res.setHeader(
        "Set-Cookie",
        sessionCookieHeader({
          value: login.cookieValue,
          maxAgeSeconds: Math.floor(WEB_SESSION_TTL_MS / 1000),
          secure: config.cookieSecure,
          domain: config.cookieDomain,
        })
      );
      res.status(200).json({ user: publicUser(login.user) });
    } catch (err) {
      next(err);
    }
  });

  app.post("/auth/logout", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      await revokeSessionFromRequest(req);
      res.setHeader(
        "Set-Cookie",
        expiredSessionCookieHeader({ secure: config.cookieSecure, domain: config.cookieDomain })
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/auth/me", requireSession, (req: AuthenticatedRequest, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // FEATURE-041: registro público + verificación + recuperación de contraseña. Regla 5.4: todas
  // devuelven una respuesta neutra (200 sin distinción) salvo violaciones de formato/política que
  // no revelan si la cuenta existe. Rate limiting por IP, mismo mecanismo que /auth/login.
  app.post("/auth/register", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("register", clientIp, RATE_LIMIT_BUCKETS.register)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("register", clientIp, RATE_LIMIT_BUCKETS.register);

      const body = registerBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_register_body" });
        return;
      }
      await registerAccount(body);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof WeakPasswordError) {
        res.status(400).json({ error: "weak_password", message: err.message, violations: err.violations });
        return;
      }
      if (err instanceof PasswordConfirmationMismatchError) {
        res.status(400).json({ error: "password_confirmation_mismatch", message: err.message });
        return;
      }
      next(err);
    }
  });

  app.post("/auth/verify-email", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation);

      const token = typeof req.body?.token === "string" ? req.body.token : "";
      if (!token) {
        res.status(400).json({ error: "invalid_verify_email_body" });
        return;
      }
      await verifyEmail(token);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof InvalidOrExpiredTokenError) {
        res.status(400).json({ error: "invalid_or_expired_token", message: err.message });
        return;
      }
      next(err);
    }
  });

  app.post("/auth/resend-verification", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("resendVerification", clientIp, RATE_LIMIT_BUCKETS.resendVerification)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("resendVerification", clientIp, RATE_LIMIT_BUCKETS.resendVerification);

      const email = typeof req.body?.email === "string" ? req.body.email : "";
      if (!email) {
        res.status(400).json({ error: "invalid_resend_verification_body" });
        return;
      }
      await resendVerificationEmail(email);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/auth/forgot-password", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("forgotPassword", clientIp, RATE_LIMIT_BUCKETS.forgotPassword)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("forgotPassword", clientIp, RATE_LIMIT_BUCKETS.forgotPassword);

      const email = typeof req.body?.email === "string" ? req.body.email : "";
      if (!email) {
        res.status(400).json({ error: "invalid_forgot_password_body" });
        return;
      }
      await requestPasswordReset(email);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post("/auth/reset-password", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation);

      const body = resetPasswordBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_reset_password_body" });
        return;
      }
      await resetPassword(body.token, body.password, body.passwordConfirmation);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof InvalidOrExpiredTokenError) {
        res.status(400).json({ error: "invalid_or_expired_token", message: err.message });
        return;
      }
      if (err instanceof WeakPasswordError) {
        res.status(400).json({ error: "weak_password", message: err.message, violations: err.violations });
        return;
      }
      if (err instanceof PasswordConfirmationMismatchError) {
        res.status(400).json({ error: "password_confirmation_mismatch", message: err.message });
        return;
      }
      next(err);
    }
  });

  app.post("/auth/activate-account", async (req, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const clientIp = clientIpForRateLimit(req);
      if (rateLimitExceeded("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation)) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      recordRateLimitAttempt("tokenValidation", clientIp, RATE_LIMIT_BUCKETS.tokenValidation);

      const body = resetPasswordBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_activate_account_body" });
        return;
      }
      await activateAccount(body.token, body.password, body.passwordConfirmation);
      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof InvalidOrExpiredTokenError) {
        res.status(400).json({ error: "invalid_or_expired_token", message: err.message });
        return;
      }
      if (err instanceof WeakPasswordError) {
        res.status(400).json({ error: "weak_password", message: err.message, violations: err.violations });
        return;
      }
      if (err instanceof PasswordConfirmationMismatchError) {
        res.status(400).json({ error: "password_confirmation_mismatch", message: err.message });
        return;
      }
      next(err);
    }
  });

  // FEATURE-041, Regla 5.2: exentas del gate de onboarding (prefijo /account/, ver
  // isOnboardingExemptPath) -- son exactamente las acciones necesarias para completarlo o para
  // cambiar la contraseña ya autenticado.
  app.patch("/account/display-name", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName : "";
      const user = await completeOnboardingDisplayName(req.user!.id, displayName);
      res.status(200).json({ user: publicUser(user) });
    } catch (err) {
      if (err instanceof InvalidDisplayNameError) {
        res.status(400).json({ error: "invalid_display_name", message: err.message });
        return;
      }
      next(err);
    }
  });

  app.post("/account/change-password", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const body = changePasswordBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_change_password_body" });
        return;
      }
      await changePassword(req.user!.id, body.currentPassword, body.newPassword, body.newPasswordConfirmation);
      res.setHeader(
        "Set-Cookie",
        expiredSessionCookieHeader({ secure: config.cookieSecure, domain: config.cookieDomain })
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof InvalidOrExpiredTokenError) {
        res.status(400).json({ error: "invalid_current_password", message: err.message });
        return;
      }
      if (err instanceof WeakPasswordError) {
        res.status(400).json({ error: "weak_password", message: err.message, violations: err.violations });
        return;
      }
      if (err instanceof PasswordConfirmationMismatchError) {
        res.status(400).json({ error: "password_confirmation_mismatch", message: err.message });
        return;
      }
      next(err);
    }
  });

  // FEATURE-041, Regla 5.8: jerarquía administrativa. Autorización real en accountAdminService.ts
  // (backend, nunca solo UI -- sección 6). `requireSession` ya bloquea sesión inválida/suspendida/
  // onboarding pendiente; acá solo falta mapear InsufficientRoleError/CannotActOnSelfError/
  // CannotActOnTargetError/TargetNotFoundError a sus status HTTP.
  function handleAdminServiceError(err: unknown, res: express.Response, next: express.NextFunction): void {
    if (err instanceof InsufficientRoleError) {
      res.status(403).json({ error: "insufficient_role", message: err.message });
      return;
    }
    if (err instanceof CannotActOnSelfError) {
      res.status(409).json({ error: "cannot_act_on_self", message: err.message });
      return;
    }
    if (err instanceof CannotActOnTargetError) {
      res.status(409).json({ error: "cannot_act_on_target", message: err.message });
      return;
    }
    if (err instanceof TargetNotFoundError) {
      res.status(404).json({ error: "target_not_found" });
      return;
    }
    if (err instanceof DuplicateAccountError) {
      res.status(409).json({ error: "duplicate_account", message: err.message });
      return;
    }
    next(err);
  }

  app.get("/admin/users", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const accounts = await listAccounts(req.user!);
      res.json({ accounts });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const email = typeof req.body?.email === "string" ? req.body.email : "";
      if (!email) {
        res.status(400).json({ error: "invalid_email" });
        return;
      }
      const user = await createAccount(req.user!, email);
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users/:id/suspend", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      const user = await suspendAccount(req.user!, targetId);
      res.json({ user: publicUser(user) });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users/:id/reactivate", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      const user = await reactivateAccount(req.user!, targetId);
      res.json({ user: publicUser(user) });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users/:id/promote", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      const user = await promoteToAdmin(req.user!, targetId);
      res.json({ user: publicUser(user) });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users/:id/demote", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      const user = await demoteToUser(req.user!, targetId);
      res.json({ user: publicUser(user) });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  app.post("/admin/users/:id/resend-verification", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      await resendVerificationByAdmin(req.user!, targetId);
      res.status(200).json({ ok: true });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  // FEATURE-041, Scope "Visibilidad administrativa": modo lectura, sin secretos ni acciones
  // operativas. Reutiliza listProjectsForUser (ya scoped por ownership, acá el "owner" es el
  // usuario administrado, no el actor) -- el actor nunca puede ejecutar/modificar, solo leer.
  app.get("/admin/users/:id/projects", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      assertAdminOrAbove(req.user!);
      const targetId = stringParam(req.params.id);
      if (!targetId) {
        res.status(400).json({ error: "invalid_target_id" });
        return;
      }
      const projects = await listProjectsForUser(targetId);
      res.json({
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          repositoryFullName: project.repository_full_name,
          agentConfigProfileId: project.agent_config_profile_id,
          createdAt: project.created_at,
        })),
      });
    } catch (err) {
      handleAdminServiceError(err, res, next);
    }
  });

  // FEATURE-026: navegación top-level (el usuario hace click y el browser sigue el redirect a
  // GitHub) -- no lleva `requireAllowedOrigin`, mismo criterio que el resto de los GET de este
  // archivo. La cookie de sesión sí viaja porque `sessionCookieHeader` usa `SameSite=None`.
  app.get("/auth/github/start", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const returnPath = typeof req.query.returnPath === "string" ? req.query.returnPath : null;
      // FEATURE-042: en una navegación top-level (window.location.href, no fetch) el browser no
      // manda header Origin -- se resuelve del Referer. Sin uno válido (ej. Referrer-Policy
      // restrictiva), cae a la producción -- nunca a un origen sin validar.
      const frontendOrigin = allowedOriginFromReferer(req, config.allowedOrigin);
      const { authorizeUrl } = await startGitHubOAuth({
        userId: req.user!.id,
        sessionId: req.sessionId!,
        returnPath,
        frontendOrigin,
      });
      res.redirect(authorizeUrl);
    } catch (err) {
      next(err);
    }
  });

  // Regla 11: el callback no confía en ningún userId recibido por query -- `req.user`/
  // `req.sessionId` vienen de `requireSession` (la cookie de sesión propia del Orquestador, no de
  // GitHub), y se validan contra lo persistido junto al `state` en `completeGitHubOAuth`.
  //
  // FEATURE-042: a diferencia de la versión anterior (devolvía el JSON crudo -- hallazgo real de
  // prueba manual en Vercel preview, el browser quedaba mostrando la respuesta de la API en vez
  // de volver a la app), esto es una navegación top-level disparada por GitHub -- tiene que
  // terminar en un `res.redirect`, nunca en JSON, o el usuario queda varado viendo la API.
  app.get("/auth/github/callback", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : null;
      if (!code || !state) {
        res.redirect(`${config.allowedOrigin}/projects?github=error&reason=invalid_oauth_callback`);
        return;
      }

      const result = await completeGitHubOAuth({
        userId: req.user!.id,
        sessionId: req.sessionId!,
        code,
        state,
      });
      res.redirect(`${result.frontendOrigin}${result.returnPath ?? "/projects"}?github=connected`);
    } catch (err) {
      if (err instanceof OAuthStateInvalidError) {
        res.redirect(`${config.allowedOrigin}/projects?github=error&reason=oauth_state_invalid`);
        return;
      }
      if (err instanceof GitHubIdentityAlreadyLinkedError) {
        res.redirect(`${config.allowedOrigin}/projects?github=error&reason=github_identity_already_linked`);
        return;
      }
      next(err);
    }
  });

  app.get("/auth/github/status", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const connection = await getConnectionStatus(req.user!.id);
      res.json({ connection });
    } catch (err) {
      next(err);
    }
  });

  app.post("/auth/github/disconnect", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      await disconnectGitHub(req.user!.id);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Sección 4.4: bajo demanda, sin sincronización permanente. FEATURE-042 (en pausa) consumirá
  // este endpoint para la selección de repositorio; por ahora es una capacidad standalone.
  app.get("/auth/github/repositories", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const repositories = await listUserAccessibleRepositories(req.user!.id);
      res.json({ repositories });
    } catch (err) {
      if (err instanceof GitConnectionRequiredError || err instanceof GitConnectionInvalidError) {
        res.status(409).json({ error: "git_connection_required" });
        return;
      }
      next(err);
    }
  });

  // FEATURE-025-Parte-1: configuración de asistente/modelo/authMode por agente (global y por rol)
  // y credenciales de IA propias por usuario -- self-service, reemplaza CLI/DB directa (secciones
  // 7.13/7.14 del diseño). Ninguna respuesta de credenciales devuelve el secreto (Regla 5.6.5/5.6.6).
  const ALL_AGENT_ROLES = ["architect", "functional", "planning", "developer", "qa", "intake"] as const;

  // FEATURE-041, Regla 5.10: "Global" es la fila sin perfil (comportamiento sin cambios). Los
  // overrides por rol ahora viven exclusivamente dentro de perfiles nombrados (hasta 3 por cuenta)
  // -- ya no existe el override "suelto" por rol sin perfil que existía antes de esta Feature.
  async function serializeAgentConfigProfile(userId: string, profile: AgentConfigProfileRow) {
    const roles = await listProfileAgentConfigOverrides(userId, profile.id);
    return { id: profile.id, name: profile.name, roles };
  }

  app.get("/agent-config", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const global = await getGlobalAgentConfig(userId);
      const profileRows = await listAgentConfigProfiles(userId);
      const profiles = await Promise.all(profileRows.map((profile) => serializeAgentConfigProfile(userId, profile)));
      res.json({ global, profiles, maxProfiles: MAX_AGENT_CONFIG_PROFILES_PER_USER, catalog: AGENT_MODEL_CATALOG });
    } catch (err) {
      next(err);
    }
  });

  app.put("/agent-config", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const body = agentConfigBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_agent_config_body" });
        return;
      }
      const saved = await setGlobalAgentConfig(req.user!.id, body);
      res.json({ config: saved });
    } catch (err) {
      next(err);
    }
  });

  app.post("/agent-config/profiles", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const userId = req.user!.id;
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (name.length === 0) {
        res.status(400).json({ error: "invalid_profile_name" });
        return;
      }
      const existing = await countAgentConfigProfiles(userId);
      if (existing >= MAX_AGENT_CONFIG_PROFILES_PER_USER) {
        res.status(409).json({ error: "profile_limit_reached" });
        return;
      }
      const profile = await createAgentConfigProfile(userId, name);
      res.status(201).json({ profile: await serializeAgentConfigProfile(userId, profile) });
    } catch (err) {
      next(err);
    }
  });

  app.patch("/agent-config/profiles/:profileId", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const userId = req.user!.id;
      const profileId = stringParam(req.params.profileId);
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!profileId || name.length === 0) {
        res.status(400).json({ error: "invalid_profile_name" });
        return;
      }
      const profile = await renameAgentConfigProfile(profileId, userId, name);
      if (!profile) {
        res.status(404).json({ error: "profile_not_found" });
        return;
      }
      res.json({ profile: await serializeAgentConfigProfile(userId, profile) });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/agent-config/profiles/:profileId", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const profileId = stringParam(req.params.profileId);
      if (!profileId) {
        res.status(400).json({ error: "invalid_profile_id" });
        return;
      }
      // ON DELETE CASCADE/SET NULL: los proyectos que tenían este perfil caen a Global
      // automáticamente (Regla 5.10, Escenario 21) -- ningún paso adicional acá.
      await deleteAgentConfigProfile(profileId, req.user!.id);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.put(
    "/agent-config/profiles/:profileId/:role",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const userId = req.user!.id;
        const profileId = stringParam(req.params.profileId);
        const role = stringParam(req.params.role);
        if (!profileId || !role || !isConfigurableAgentRole(role)) {
          res.status(400).json({ error: "invalid_role" });
          return;
        }
        const profile = await getAgentConfigProfileById(profileId, userId);
        if (!profile) {
          res.status(404).json({ error: "profile_not_found" });
          return;
        }
        const body = agentConfigBody(req.body);
        if (!body) {
          res.status(400).json({ error: "invalid_agent_config_body" });
          return;
        }
        const saved = await setProfileAgentConfigOverride(userId, profileId, role, body);
        res.json({ config: saved });
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete(
    "/agent-config/profiles/:profileId/:role",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const userId = req.user!.id;
        const profileId = stringParam(req.params.profileId);
        const role = stringParam(req.params.role);
        if (!profileId || !role || !isConfigurableAgentRole(role)) {
          res.status(400).json({ error: "invalid_role" });
          return;
        }
        await deleteProfileAgentConfigOverride(userId, profileId, role);
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  // FEATURE-041, Regla 5.7: `profileId` debe pertenecer al mismo owner del proyecto -- ownership
  // validado en el repositorio (setProjectAgentConfigProfile), nunca solo por confiar en el body.
  app.put(
    "/projects/:projectId/agent-config-profile",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const projectId = stringParam(req.params.projectId);
        const profileId =
          req.body?.profileId === null
            ? null
            : typeof req.body?.profileId === "string" && req.body.profileId.trim().length > 0
              ? req.body.profileId
              : undefined;
        if (!projectId || profileId === undefined) {
          res.status(400).json({ error: "invalid_agent_config_profile_body" });
          return;
        }
        const project = await setProjectAgentConfigProfile({ projectId, ownerId: req.user!.id, profileId });
        if (!project) {
          res.status(404).json({ error: "project_or_profile_not_found" });
          return;
        }
        res.json({ project });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get("/agent-credentials", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const credentials = await listAiCredentialStatuses(req.user!.id);
      res.json({ credentials });
    } catch (err) {
      next(err);
    }
  });

  app.put("/agent-credentials/:provider", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const provider = stringParam(req.params.provider);
      if (provider !== "claude" && provider !== "codex") {
        res.status(400).json({ error: "invalid_provider" });
        return;
      }
      const body = agentCredentialBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_credential_body" });
        return;
      }
      const credential = await setAiCredential(req.user!.id, provider, body.apiKey);
      res.json({ credential });
    } catch (err) {
      next(err);
    }
  });

  app.delete("/agent-credentials/:provider", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const provider = stringParam(req.params.provider);
      if (provider !== "claude" && provider !== "codex") {
        res.status(400).json({ error: "invalid_provider" });
        return;
      }
      await removeAiCredential(req.user!.id, provider);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // FEATURE-025-Parte-2: conexiones OAuth personales por proveedor -- reemplazan el caché global
  // compartido de cli_session. Ninguna respuesta expone tokens/blobs (Regla 7.14).

  app.get("/ai-oauth-connections", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const connections = await listOAuthConnectionStatuses(req.user!.id);
      res.json({ connections });
    } catch (err) {
      next(err);
    }
  });

  app.post("/ai-oauth-connections/:provider/login", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const provider = stringParam(req.params.provider);
      if (provider !== "claude" && provider !== "codex") {
        res.status(400).json({ error: "invalid_provider" });
        return;
      }
      const challenge = await startOAuthLogin(req.user!.id, provider);
      res.json(challenge);
    } catch (err) {
      if (err instanceof LoginInProgressError) {
        res.status(409).json({ error: "connection_in_progress", message: err.message });
        return;
      }
      next(err);
    }
  });

  app.post(
    "/ai-oauth-connections/claude/login/:attemptId/code",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const attemptId = stringParam(req.params.attemptId);
        const code = typeof req.body?.code === "string" ? req.body.code : null;
        if (!attemptId || !code) {
          res.status(400).json({ error: "invalid_login_code_body" });
          return;
        }
        const connection = await submitOAuthLoginCode(req.user!.id, attemptId, code);
        res.json({ connection });
      } catch (err) {
        if (err instanceof ClaudeLoginError) {
          res.status(409).json({ error: "login_failed", message: err.message });
          return;
        }
        next(err);
      }
    }
  );

  // Sección 5.7.3/4: Codex confirma en el navegador, sin que la UI envíe un código -- este
  // endpoint está pensado para polling corto desde el frontend (responde `pending` en <3s si el
  // usuario todavía no terminó, sin consumir el intento).
  app.post(
    "/ai-oauth-connections/codex/login/:attemptId/poll",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const attemptId = stringParam(req.params.attemptId);
        if (!attemptId) {
          res.status(400).json({ error: "invalid_attempt_id" });
          return;
        }
        const outcome = await pollCodexOAuthLogin(req.user!.id, attemptId);
        if (outcome.pending) {
          res.json({ pending: true });
          return;
        }
        res.json({ pending: false, connection: outcome.connection });
      } catch (err) {
        if (err instanceof CodexLoginError) {
          res.status(409).json({ error: "login_failed", message: err.message });
          return;
        }
        next(err);
      }
    }
  );

  app.delete(
    "/ai-oauth-connections/:provider/login/:attemptId",
    requireSession,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
        const provider = stringParam(req.params.provider);
        const attemptId = stringParam(req.params.attemptId);
        if ((provider !== "claude" && provider !== "codex") || !attemptId) {
          res.status(400).json({ error: "invalid_cancel_login_params" });
          return;
        }
        await cancelOAuthLogin(provider, attemptId);
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  app.delete("/ai-oauth-connections/:provider", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const provider = stringParam(req.params.provider);
      if (provider !== "claude" && provider !== "codex") {
        res.status(400).json({ error: "invalid_provider" });
        return;
      }
      const force = stringParam(req.query.force as string | string[] | undefined) === "true";
      const result = await disconnectOAuth(req.user!.id, provider, force);
      if (!result.disconnected) {
        res.status(409).json({ error: "active_runs_using_connection", activeRunIds: result.activeRunIds });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/runs/:id", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const runId = stringParam(req.params.id);
      if (!runId) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }
      const detail = await getRunDetailForUser(runId, req.user?.id ?? "");
      if (!detail) {
        res.status(404).json({ error: "run_not_found" });
        return;
      }
      const [releaseRoadmap, featureDocument, projectBriefDocument, architectureDocument, releasePlanDocument, childRunId] =
        await Promise.all([
          resolveReleaseRoadmap(detail.run.project_id),
          getFeatureDocumentForRun(runId),
          getProjectBriefDocumentForRun(runId),
          getArchitectureDocumentForRun(runId),
          getReleasePlanDocumentForRun(runId),
          getChildRunId(runId),
        ]);
      res.json(
        buildRunViewModel(
          detail,
          releaseRoadmap,
          featureDocument,
          projectBriefDocument,
          architectureDocument,
          releasePlanDocument,
          childRunId
        )
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/runs/:id/respond", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const runId = stringParam(req.params.id);
      if (!runId) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }

      const action = respondBody(req.body);
      if (!action) {
        res.status(400).json({ error: "invalid_response_body" });
        return;
      }

      const result = await respondToEscalation({
        parentRunId: runId,
        userId: req.user?.id ?? "",
        action,
      });

      if (result.kind === "conflict") {
        res.status(409).json({ error: "run_not_escalated" });
        return;
      }

      if (result.kind === "aborted") {
        res.status(202).json({ status: "aborted" });
        return;
      }

      if (result.kind === "project_closed") {
        res.status(202).json({ status: "project_closed" });
        return;
      }

      if (result.kind === "escalation_dead_end") {
        res.status(202).json({ status: "escalation_dead_end", reason: result.reason });
        return;
      }

      const { childRunId, execute } = result;
      res.status(202).json({ childRunId });
      void execute().catch((err: unknown) => {
        console.error(`[server] background escalation response failed for child run ${childRunId}`, err);
      });
    } catch (err) {
      if (err instanceof EscalationRunNotFoundError) {
        res.status(404).json({ error: "run_not_found" });
        return;
      }
      next(err);
    }
  });

  // FEATURE-017: mapeo de texto libre a los 12 campos del intake — llamada directa al proveedor,
  // sin tools (ver src/intake/mapBusinessCase.ts). requireSession por costo/abuso; requireAllowedOrigin
  // por ser un POST con efecto (llamada real al proveedor), mismo criterio que /runs/:id/respond.
  app.post("/intake/map", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const body = intakeMapBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_intake_map_body" });
        return;
      }

      const result = await mapIntakeText({ userId: req.user!.id, ...body });
      res.json(result);
    } catch (err) {
      // AgentOAuthNotConnectedError/AgentOAuthReauthRequiredError extienden
      // AgentCredentialMissingError -- este chequeo ya cubre las tres formas (Escenario 5/6/7 del
      // diseño de FEATURE-025-Parte-3): sin credencial, sin conexión OAuth, o reautenticación
      // requerida. El mensaje ya distingue el caso exacto; la UI dirige a Configuración.
      if (err instanceof AgentCredentialMissingError) {
        res.status(409).json({ error: "intake_credential_missing", message: err.message });
        return;
      }
      if (err instanceof IntakeMappingProviderUnsupportedError) {
        res.status(409).json({ error: "intake_provider_unsupported", message: err.message });
        return;
      }
      if (err instanceof IntakeMappingAuthModeUnsupportedError) {
        res.status(409).json({ error: "intake_auth_mode_unsupported", message: err.message });
        return;
      }
      if (err instanceof IntakeMappingError) {
        res.status(intakeMappingErrorStatus(err.code)).json({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof IntakeMappingProjectNotFoundError) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      next(err);
    }
  });

  // FEATURE-042, sección B: creación/selección/configuración de proyectos. Todas requieren
  // sesión; toda operación sobre un projectId puntual valida ownership dentro del service layer
  // (getProjectByIdForUser), nunca solo por confiar en el id de la ruta.

  app.get("/projects", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const result = await listProjects(req.user?.id ?? "");
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post("/projects", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const body = createProjectBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_create_project_body" });
        return;
      }
      const result = await createProjectForUser({
        ownerId: req.user?.id ?? "",
        name: body.name,
        repositoryExternalId: body.repositoryExternalId,
      });
      if (result.kind === "created") {
        res.status(201).json({ project: result.project });
        return;
      }
      respondProjectError(res, result);
    } catch (err) {
      next(err);
    }
  });

  app.get("/projects/:projectId", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const projectId = stringParam(req.params.projectId);
      if (!projectId) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      const project = await getProjectSummary(projectId, req.user?.id ?? "");
      if (!project) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      res.json({ project });
    } catch (err) {
      next(err);
    }
  });

  app.patch("/projects/:projectId", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const projectId = stringParam(req.params.projectId);
      const name = typeof req.body?.name === "string" ? req.body.name : null;
      if (!projectId || !name) {
        res.status(400).json({ error: "invalid_update_project_body" });
        return;
      }
      const result = await updateProjectNameForUser({ projectId, ownerId: req.user?.id ?? "", name });
      if (result.kind === "updated") {
        res.json({ project: result.project });
        return;
      }
      if (result.kind === "not_found") {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      respondProjectError(res, result);
    } catch (err) {
      next(err);
    }
  });

  app.put("/projects/:projectId/repository", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const projectId = stringParam(req.params.projectId);
      const repositoryExternalId = typeof req.body?.repositoryExternalId === "string" ? req.body.repositoryExternalId : null;
      if (!projectId || !repositoryExternalId) {
        res.status(400).json({ error: "invalid_set_repository_body" });
        return;
      }
      const result = await setProjectRepositoryForUser({ projectId, ownerId: req.user?.id ?? "", repositoryExternalId });
      if (result.kind === "updated") {
        res.json({ project: result.project });
        return;
      }
      if (result.kind === "not_found") {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      respondProjectError(res, result);
    } catch (err) {
      next(err);
    }
  });

  app.post("/projects/:projectId/select", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const projectId = stringParam(req.params.projectId);
      if (!projectId) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      const selected = await selectProject({ userId: req.user?.id ?? "", projectId });
      if (!selected) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      res.json({ selectedProjectId: projectId });
    } catch (err) {
      next(err);
    }
  });

  // Sección B.7: filtra por proyecto y owner simultáneamente -- nunca listRunsForUser(userId) sin
  // el filtro de proyecto.
  app.get("/projects/:projectId/cases", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const projectId = stringParam(req.params.projectId);
      if (!projectId) {
        res.status(400).json({ error: "invalid_project_id" });
        return;
      }
      const result = await listProjectCaseTree({ projectId, userId: req.user?.id ?? "" });
      if (!result.found) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      res.json({ cases: result.cases });
    } catch (err) {
      next(err);
    }
  });

  // Sección D.4/D.5: validación preventiva como paso propio, sin crear nada -- el frontend la usa
  // antes de confirmar, para poder mostrar "esta rama no existe, se creará desde main" con opción
  // real de volver a editar, no solo enterarse después de que el caso ya se creó.
  app.post("/projects/:projectId/cases/validate-branch", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const projectId = stringParam(req.params.projectId);
      const branchName = typeof req.body?.branchName === "string" ? req.body.branchName : null;
      if (!projectId || !branchName) {
        res.status(400).json({ error: "invalid_validate_branch_body" });
        return;
      }
      const outcome = await validateProjectCaseBranch({ userId: req.user?.id ?? "", projectId, branchName });
      if (outcome.kind === "not_found") {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      if (outcome.kind === "project_not_configured") {
        res.status(409).json({ error: "project_not_configured" });
        return;
      }
      res.json({ validation: outcome.result });
    } catch (err) {
      next(err);
    }
  });

  // Sección B.8/B.9/D.4: entrada de creación de casos del flujo de proyecto -- no acepta
  // business_case.repositorio, exige projectId de la ruta, corre el gate Git preventivo.
  app.post("/projects/:projectId/cases", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;
      const projectId = stringParam(req.params.projectId);
      const body = confirmIntakeBody(req.body);
      if (!projectId || !body) {
        res.status(400).json({ error: "invalid_confirm_body" });
        return;
      }
      const result = await confirmIntakeForProject({
        userId: req.user?.id ?? "",
        projectId,
        businessCase: body.businessCase,
      });
      if (result.kind === "confirmed") {
        res.status(201).json({ run: result.run, branchWarning: result.branchWarning });
        return;
      }
      if (result.kind === "not_found") {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      if (result.kind === "project_not_configured") {
        res.status(409).json({ error: "project_not_configured" });
        return;
      }
      // branch_validation_failed
      res.status(422).json({ error: "branch_validation_failed", status: result.status, message: result.message });
    } catch (err) {
      next(err);
    }
  });

  // FEATURE-017, Regla 6: confirmar el mapeo persiste el run en `sin_iniciar` — sin worktree, sin
  // branch, sin invocación al Architect todavía.
  app.post("/runs", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const body = confirmIntakeBody(req.body);
      if (!body) {
        res.status(400).json({ error: "invalid_confirm_body" });
        return;
      }

      const run = await confirmIntake({ userId: req.user?.id ?? "", businessCase: body.businessCase });
      res.status(201).json({ run });
    } catch (err) {
      if (err instanceof IntakeProjectNotFoundError) {
        res.status(409).json({ error: "no_project_available" });
        return;
      }
      next(err);
    }
  });

  // FEATURE-017, Regla 9: exclusivamente "mis casos" — filtrado por owner_id del usuario
  // autenticado, sin excepción.
  app.get("/runs", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const runs = await listMyCases(req.user?.id ?? "");
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  });

  // FEATURE-017, Regla 7: Iniciar transiciona sin_iniciar -> running y dispara el pipeline real.
  app.post("/runs/:id/start", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const runId = stringParam(req.params.id);
      if (!runId) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }

      const result = await startPendingRun({ runId, userId: req.user?.id ?? "" });
      if (result.kind === "not_found") {
        res.status(404).json({ error: "run_not_found" });
        return;
      }
      if (result.kind === "conflict") {
        res.status(409).json({ error: "run_not_pending_start" });
        return;
      }
      if (result.kind === "repo_clone_failed") {
        // FEATURE-017: corte técnico explícito — el run ya quedó en status="failed" con el
        // motivo persistido en run_events (repo_clone_failed), no se invocó al Architect.
        res.status(422).json({ error: "repo_clone_failed", message: result.message });
        return;
      }
      if (result.kind === "git_connection_required") {
        // FEATURE-042 (cableado con FEATURE-026): mismo criterio de corte técnico que
        // repo_clone_failed, pero distinguible -- el frontend debe ofrecer "Conectar GitHub",
        // no un mensaje genérico de fallo de clonado. Mismo status 409 que ya usa
        // GET /auth/github/repositories para este mismo tipo de error.
        res.status(409).json({ error: "git_connection_required", message: result.message });
        return;
      }
      if (result.kind === "branch_validation_failed") {
        // FEATURE-042, sección D.6: gate Git autoritativo -- corte técnico distinguible por
        // `status` (branch_invalid, main_missing, repository_not_accessible,
        // repository_read_only, temporary_failure, git_connection_required/invalid).
        res.status(422).json({ error: "branch_validation_failed", status: result.status, message: result.message });
        return;
      }

      res.status(202).json({ run: result.run });
      void result.execute().catch((err: unknown) => {
        console.error(`[server] background pipeline execution failed for run ${runId}`, err);
      });
    } catch (err) {
      next(err);
    }
  });

  // FEATURE-017, Regla 8: Cancelar reusa respondToEscalation({ abort: true }) tras forzar
  // running -> escalated. No interrumpe una invocación de Executor realmente en curso — se aplica
  // en el próximo punto de corte natural del pipeline (ver runStart.ts, haltIfCancelledExternally).
  app.post("/runs/:id/cancel", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!requireAllowedOrigin(req, res, config.allowedOrigin)) return;

      const runId = stringParam(req.params.id);
      if (!runId) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }

      const result = await cancelRun({ runId, userId: req.user?.id ?? "" });
      if (result.kind === "not_found") {
        res.status(404).json({ error: "run_not_found" });
        return;
      }
      if (result.kind === "conflict") {
        res.status(409).json({ error: "run_not_running" });
        return;
      }

      res.status(202).json({ status: "aborted" });
    } catch (err) {
      next(err);
    }
  });

  app.get("/runs/:id/stream", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const runId = stringParam(req.params.id);
      if (!runId) {
        res.status(400).json({ error: "invalid_run_id" });
        return;
      }
      await openRunEventsStream({
        runId,
        userId: req.user?.id ?? "",
        lastEventId: parseLastEventId(req.header("Last-Event-ID")),
        response: res,
      });
    } catch (err) {
      next(err);
    }
  });

  const frontendDist = path.resolve(__dirname, "..", "..", "web", "dist");
  app.use(express.static(frontendDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // Hallazgo de validación en vivo (FEATURE-025-Parte-2): este handler nunca logueaba nada -- un
    // 500 real quedaba completamente invisible en journalctl, sin ningún rastro para diagnosticar.
    console.error(`[server] error no manejado en ${req.method} ${req.path}:`, err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    res.status(500).json({ error: message });
  });

  return app;
}

export function serverConfigFromEnv(): ServerConfig {
  const allowedOrigin = process.env.ORCHESTRATOR_WEB_ORIGIN;
  if (!allowedOrigin) throw new Error("ORCHESTRATOR_WEB_ORIGIN requerido para sesiones web.");

  return {
    allowedOrigin,
    cookieSecure: process.env.ORCHESTRATOR_COOKIE_SECURE !== "false",
    cookieDomain: process.env.ORCHESTRATOR_COOKIE_DOMAIN || undefined,
  };
}

// FEATURE-041, Regla 5.2/Riesgo 10: "cuenta activa sin nombre visible: solo accede al módulo de
// cuenta" -- allowlist de PREFIJOS (deny-by-default), no una lista de rutas bloqueadas: cualquier
// endpoint nuevo que se agregue después queda bloqueado durante el onboarding a menos que se sume
// acá a propósito, en vez de quedar expuesto por descuido si alguien olvida un middleware nuevo en
// cada ruta.
const ONBOARDING_EXEMPT_PATH_PREFIXES = ["/auth/", "/account/", "/agent-config", "/agent-credentials", "/ai-oauth-connections"];

function isOnboardingExemptPath(path: string): boolean {
  return ONBOARDING_EXEMPT_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

async function requireSession(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  try {
    const auth = await authenticateWebRequest(req);
    if (!auth) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // Defensa en profundidad: suspender ya revoca todas las sesiones (Regla 5.5), esto cubre el
    // resto de casos borde (ej. sesión ya validada en el instante exacto de la suspensión).
    if (auth.user.status === "suspended") {
      res.status(403).json({ error: "account_suspended", message: "Tu cuenta está suspendida." });
      return;
    }
    if (!auth.user.display_name && !isOnboardingExemptPath(req.path)) {
      res.status(403).json({ error: "onboarding_required", message: "Elegí un nombre visible para continuar." });
      return;
    }
    req.user = auth.user;
    req.sessionId = auth.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}

function corsMiddleware(allowedOrigin: string): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.header("Origin");
    const isAllowed = origin !== undefined && isAllowedWebOrigin(origin, allowedOrigin);
    if (isAllowed) {
      // CORS exige reflejar el origen real de la request, no un valor fijo -- un preview de
      // Vercel nunca coincide con `allowedOrigin` (la producción), así que enviar ese valor fijo
      // rompería el preflight para cualquier origen que matcheara solo por el patrón.
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      if (!isAllowed) {
        res.status(403).end();
        return;
      }
      // FEATURE-042 agregó PATCH (renombrar proyecto) y PUT (configurar repositorio) -- sin
      // esto en la lista, el preflight del browser bloquea el pedido antes de mandarlo
      // ("Failed to fetch", nunca llega a loguearse en el servidor). Hallazgo real de prueba
      // manual: PUT /projects/:id/repository. FEATURE-025-Parte-1 agregó DELETE
      // (/agent-config/:role, /agent-credentials/:provider) -- mismo hallazgo real: "Quitar
      // override"/"Eliminar credencial" no hacían nada, sin ningún error visible (el preflight
      // bloqueaba el DELETE antes de que llegara al servidor).
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Last-Event-ID");
      res.status(204).end();
      return;
    }

    next();
  };
}

function loginBody(body: unknown): { handle: string | null; password: string | null } {
  if (body === null || typeof body !== "object") return { handle: null, password: null };
  const record = body as Record<string, unknown>;
  return {
    handle: typeof record.handle === "string" ? record.handle : null,
    password: typeof record.password === "string" ? record.password : null,
  };
}

function registerBody(body: unknown): { email: string; password: string; passwordConfirmation: string } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.email !== "string" || record.email.trim().length === 0) return null;
  if (typeof record.password !== "string" || record.password.length === 0) return null;
  if (typeof record.passwordConfirmation !== "string") return null;
  return { email: record.email, password: record.password, passwordConfirmation: record.passwordConfirmation };
}

function resetPasswordBody(body: unknown): { token: string; password: string; passwordConfirmation: string } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.token !== "string" || record.token.length === 0) return null;
  if (typeof record.password !== "string" || record.password.length === 0) return null;
  if (typeof record.passwordConfirmation !== "string") return null;
  return { token: record.token, password: record.password, passwordConfirmation: record.passwordConfirmation };
}

function changePasswordBody(
  body: unknown
): { currentPassword: string; newPassword: string; newPasswordConfirmation: string } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.currentPassword !== "string" || record.currentPassword.length === 0) return null;
  if (typeof record.newPassword !== "string" || record.newPassword.length === 0) return null;
  if (typeof record.newPasswordConfirmation !== "string") return null;
  return {
    currentPassword: record.currentPassword,
    newPassword: record.newPassword,
    newPasswordConfirmation: record.newPasswordConfirmation,
  };
}

// FEATURE-025-Parte-1, sección 5.3: el modelo no puede persistirse como string libre -- se valida
// acá, antes de llegar a repository.ts, contra el catálogo cerrado server-side.
function agentConfigBody(body: unknown): EffectiveAgentConfig | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const executorProvider = record.executorProvider;
  if (executorProvider !== "claude" && executorProvider !== "codex") return null;
  const authMode = record.authMode;
  if (authMode !== "api_key" && authMode !== "cli_session") return null;
  const model = typeof record.model === "string" && record.model.trim().length > 0 ? record.model : null;
  if (model !== null && !isModelSupportedByProvider(executorProvider, model)) return null;
  return { executorProvider, authMode: authMode as AuthMode, model };
}

function agentCredentialBody(body: unknown): { apiKey: string } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.apiKey !== "string" || record.apiKey.trim().length === 0) return null;
  return { apiKey: record.apiKey };
}

// FEATURE-025-Parte-3, sección 5.15: mapea la taxonomía funcional de errores de mapeo a un status
// HTTP distinguible -- el cuerpo de la respuesta ya viene sin secretos ni datos crudos del
// proveedor (los adaptadores nunca incluyen eso en err.message, ver intakeMappingErrors.ts).
function intakeMappingErrorStatus(code: string): number {
  switch (code) {
    case "intake_mapping_authentication_required":
      return 502;
    case "intake_mapping_model_unsupported":
      return 400;
    case "intake_mapping_rate_limited":
      return 429;
    case "intake_mapping_provider_unavailable":
      return 502;
    case "intake_mapping_timeout":
      return 504;
    case "intake_mapping_invalid_response":
      return 502;
    default:
      return 500;
  }
}

function intakeMapBody(
  body: unknown
): { projectId: string; inputText: string; previousValues?: BusinessCaseValues } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.projectId !== "string" || record.projectId.trim().length === 0) return null;
  if (typeof record.inputText !== "string" || record.inputText.trim().length === 0) return null;
  const previousValues = isBusinessCaseValues(record.previousValues) ? record.previousValues : undefined;
  return { projectId: record.projectId, inputText: record.inputText, previousValues };
}

function confirmIntakeBody(body: unknown): { businessCase: BusinessCaseValues } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!isBusinessCaseValues(record.businessCase)) return null;
  return { businessCase: record.businessCase };
}

function createProjectBody(body: unknown): { name: string; repositoryExternalId?: string } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.trim().length === 0) return null;
  const repositoryExternalId = typeof record.repositoryExternalId === "string" ? record.repositoryExternalId : undefined;
  return { name: record.name, repositoryExternalId };
}

// FEATURE-042, sección B: traduce los `kind` de error compartidos entre create/update/set-repository
// de proyectos a status HTTP -- mismos códigos que ya usa FEATURE-026 para los mismos motivos
// (409 git_connection_required, igual que GET /auth/github/repositories).
function respondProjectError(
  res: express.Response,
  result: { kind: string; message?: string }
): void {
  switch (result.kind) {
    case "invalid_project_name":
      res.status(400).json({ error: "invalid_project_name" });
      return;
    case "duplicate_project":
      res.status(409).json({ error: "duplicate_project" });
      return;
    case "git_connection_required":
      res.status(409).json({ error: "git_connection_required", message: result.message });
      return;
    case "git_connection_invalid":
      res.status(409).json({ error: "git_connection_invalid", message: result.message });
      return;
    case "repository_not_accessible":
      res.status(409).json({ error: "repository_not_accessible", message: result.message });
      return;
    case "repository_read_only":
      res.status(409).json({ error: "repository_read_only", message: result.message });
      return;
    default:
      res.status(500).json({ error: "unexpected_project_error" });
  }
}

function isBusinessCaseValues(value: unknown): value is BusinessCaseValues {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => v === null || typeof v === "string");
}

function respondBody(body: unknown): EscalationResponseAction | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const abort = record.abort === true;
  const solution = typeof record.solution === "string" ? record.solution : null;
  if (abort && solution === null) return { abort: true };
  if (!abort && solution !== null && solution.trim().length > 0) return { solution };
  return null;
}

function publicUser(user: AuthenticatedRequest["user"]) {
  return user
    ? {
        id: user.id,
        handle: user.handle,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
      }
    : null;
}

function stringParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// FEATURE-042: resuelve a qué frontend volver tras el flujo OAuth (sección C.6) -- en una
// navegación top-level no hay header Origin, solo Referer. Sin uno válido y permitido
// (isAllowedWebOrigin), cae a la producción -- nunca se persiste ni se redirige a un origen sin
// validar.
function allowedOriginFromReferer(req: express.Request, allowedOrigin: string): string {
  const referer = req.header("Referer");
  if (!referer) return allowedOrigin;
  try {
    const origin = new URL(referer).origin;
    return isAllowedWebOrigin(origin, allowedOrigin) ? origin : allowedOrigin;
  } catch {
    return allowedOrigin;
  }
}

function parseLastEventId(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * FEATURE-018: resuelve el roadmap vigente del proyecto de un run para exponerlo al frontend
 * (ReleasePlanPanel). `projectId` null (runs legados sin proyecto vinculado) resuelve a null sin
 * consultar nada.
 */
async function resolveReleaseRoadmap(projectId: string | null) {
  if (!projectId) return null;
  const [config, releasePlans] = await Promise.all([
    getCurrentProjectConfig(projectId, "release_roadmap"),
    getReleasePlansByRelease(projectId),
  ]);
  return toReleaseRoadmapView(config?.value ?? null, releasePlans);
}
