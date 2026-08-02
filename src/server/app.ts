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
import { getCurrentProjectConfig, getReleasePlansByRelease, getRunDetailForUser } from "../db/repository.js";
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
  IntakeProjectNotFoundError,
  listMyCases,
  mapIntakeText,
  startPendingRun,
} from "../cli/intakeService.js";
import {
  createProjectForUser,
  getProjectSummary,
  listProjectCases,
  listProjects,
  selectProject,
  setProjectRepositoryForUser,
  updateProjectNameForUser,
} from "../cli/projectService.js";
import type { BusinessCaseValues } from "../intake/mapBusinessCase.js";
import { buildRunViewModel, toReleaseRoadmapView } from "./runView.js";
import { openRunEventsStream } from "./sse.js";
import { getFeatureDocumentForRun } from "../features/lifecycle.js";

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
      if (!login) {
        recordFailedLogin(clientIp);
        res.status(401).json({ error: "invalid_credentials" });
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

  // FEATURE-026: navegación top-level (el usuario hace click y el browser sigue el redirect a
  // GitHub) -- no lleva `requireAllowedOrigin`, mismo criterio que el resto de los GET de este
  // archivo. La cookie de sesión sí viaja porque `sessionCookieHeader` usa `SameSite=None`.
  app.get("/auth/github/start", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const returnPath = typeof req.query.returnPath === "string" ? req.query.returnPath : null;
      const { authorizeUrl } = await startGitHubOAuth({
        userId: req.user!.id,
        sessionId: req.sessionId!,
        returnPath,
      });
      res.redirect(authorizeUrl);
    } catch (err) {
      next(err);
    }
  });

  // Regla 11: el callback no confía en ningún userId recibido por query -- `req.user`/
  // `req.sessionId` vienen de `requireSession` (la cookie de sesión propia del Orquestador, no de
  // GitHub), y se validan contra lo persistido junto al `state` en `completeGitHubOAuth`.
  app.get("/auth/github/callback", requireSession, async (req: AuthenticatedRequest, res, next) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : null;
      if (!code || !state) {
        res.status(400).json({ error: "invalid_oauth_callback" });
        return;
      }

      const connection = await completeGitHubOAuth({
        userId: req.user!.id,
        sessionId: req.sessionId!,
        code,
        state,
      });
      res.status(200).json({ connection });
    } catch (err) {
      if (err instanceof OAuthStateInvalidError) {
        res.status(409).json({ error: "oauth_state_invalid" });
        return;
      }
      if (err instanceof GitHubIdentityAlreadyLinkedError) {
        res.status(409).json({ error: "github_identity_already_linked" });
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
      const [releaseRoadmap, featureDocument] = await Promise.all([
        resolveReleaseRoadmap(detail.run.project_id),
        getFeatureDocumentForRun(runId),
      ]);
      res.json(buildRunViewModel(detail, releaseRoadmap, featureDocument));
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

      const result = await mapIntakeText(body);
      res.json(result);
    } catch (err) {
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
      const result = await listProjectCases({ projectId, userId: req.user?.id ?? "" });
      if (!result.found) {
        res.status(404).json({ error: "project_not_found" });
        return;
      }
      res.json({ runs: result.runs });
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

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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

async function requireSession(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  try {
    const auth = await authenticateWebRequest(req);
    if (!auth) {
      res.status(401).json({ error: "unauthorized" });
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
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

function intakeMapBody(body: unknown): { inputText: string; previousValues?: BusinessCaseValues } | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.inputText !== "string" || record.inputText.trim().length === 0) return null;
  const previousValues = isBusinessCaseValues(record.previousValues) ? record.previousValues : undefined;
  return { inputText: record.inputText, previousValues };
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
  return user ? { id: user.id, handle: user.handle } : null;
}

function stringParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
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
