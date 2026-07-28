import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateWebRequest,
  clearLoginRateLimit,
  clientIpForRateLimit,
  createWebLoginSession,
  expiredSessionCookieHeader,
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
  EscalationRunNotFoundError,
  respondToEscalation,
  type EscalationResponseAction,
} from "../cli/respondService.js";
import {
  cancelRun,
  confirmIntake,
  IntakeProjectNotFoundError,
  listMyCases,
  mapIntakeText,
  startPendingRun,
} from "../cli/intakeService.js";
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

      res.status(202).json({ run: result.run });
      void result.execute().catch((err) => {
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
    if (origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }

    if (req.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
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
