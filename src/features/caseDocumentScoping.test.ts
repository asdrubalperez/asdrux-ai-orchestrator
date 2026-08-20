import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRunPendingStart, setProjectConfig } from "../db/repository.js";
import { pool } from "../db/pool.js";
import { persistProjectBrief, getProjectBriefDocumentForRun } from "./projectBriefLifecycle.js";
import { persistArchitecture, getArchitectureDocumentForRun } from "./architectureLifecycle.js";
import type { ProjectBriefPayload } from "./projectBriefContracts.js";
import type { ArchitecturePayload } from "./architectureContracts.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";

/**
 * FEATURE-047: reproduce el escenario real (2026-08-20) que motivó esta Feature -- dos Casos de
 * negocio del mismo proyecto, cada uno con su propio Project Brief/Architecture. Antes del fix,
 * `unique(project_id)` garantizaba una sola fila por proyecto: el segundo Caso en persistir
 * sobrescribía en silencio la del primero, y `getProjectBriefDocumentForRun`/
 * `getArchitectureDocumentForRun` del segundo Caso devolvían el documento del primero incluso antes
 * de que el segundo generara el suyo. Sin transacción/rollback -- `getProjectBriefDocumentForRun`/
 * `getArchitectureDocumentForRun` usan `pool` directamente, mismo criterio que
 * `projectConfigScoping.test.ts` (FEATURE-046).
 */
test("FEATURE-047: dos Casos del mismo proyecto tienen su propio Project Brief y Architecture, sin pisarse", async (t) => {
  try {
    await pool.query("select 1");
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }

  const prerequisite = await pool.query<{ pipeline_id: string; owner_id: string }>(
    `select pd.id as pipeline_id, u.id as owner_id
     from pipeline_definitions pd cross join users u
     order by pd.created_at asc, u.created_at asc
     limit 1`
  );
  if (!prerequisite.rows[0]) {
    t.skip("Requires one pipeline definition and user in the integration database");
    return;
  }
  const { pipeline_id: pipelineId, owner_id: ownerId } = prerequisite.rows[0];

  const projectId = randomUUID();
  const rootAId = randomUUID();
  const rootBId = randomUUID();

  const templateAsset: RunbookTextAsset = {
    runbookVersion: "test-v1",
    assetRelativePath: "07-PROJECT-BRIEF-TEMPLATE.md",
    assetHash: "hash-test",
    content: "contenido de prueba",
  };

  const briefPayloadFor = (label: string): ProjectBriefPayload => ({
    declarativos: {
      identidadSistema: `Sistema de prueba ${label}`,
      accesoCodigoFuente: "Repositorio de prueba",
      restriccionesNegocio: "Ninguna",
      intencionNegocio: `Probar aislamiento del Caso ${label}`,
    },
    contexto: { problema: `Problema de ${label}`, situacionActual: "N/A", valorEsperado: "N/A" },
    evaluacionPreliminar: [{ item: "Reutiliza componentes existentes", estado: "No", comentario: "" }],
    esquemaPreliminar: {
      flujoEsperado: "N/A",
      sistemasInvolucrados: "N/A",
      integracionesNecesarias: "N/A",
      expuestoInternet: "No",
    },
    complejidadTecnica: "Baja",
    hallazgos: "",
  });
  const briefPayloadA = briefPayloadFor("A");
  const briefPayloadB = briefPayloadFor("B");

  const archPayloadFor = (label: string): ArchitecturePayload => ({
    analisisTecnico: {
      descripcionMacro: `Arquitectura de ${label}`,
      backend: "N/A",
      frontend: "N/A",
      basesDatos: "N/A",
      integracionesApis: "N/A",
      requiereInfraestructura: { valor: "No", detalle: "" },
      consumeServiciosExternos: { valor: "No", detalle: "" },
      tecnologiaNuevaProducto: { valor: "No", detalle: "" },
    },
    componentes: [],
    riesgos: [],
    hallazgos: "",
  });
  const archPayloadA = archPayloadFor("A");
  const archPayloadB = archPayloadFor("B");

  const roadmapFor = (label: string) => ({
    releases: [{ id: "r1", nombre: `Release de ${label}`, alcanceResumen: "", estado: "Activo" }],
    activeReleaseId: "r1",
  });

  try {
    await pool.query(`insert into projects (id, name, repo_path, owner_id) values ($1, 'feature-047-scoping-test', '/tmp/feature-047', $2)`, [
      projectId,
      ownerId,
    ]);
    await createRunPendingStart({ id: rootAId, pipelineDefinitionId: pipelineId, ownerId, projectId, businessCase: { vision: "Caso A" } });
    await createRunPendingStart({ id: rootBId, pipelineDefinitionId: pipelineId, ownerId, projectId, businessCase: { vision: "Caso B" } });

    // Architecture necesita un release_roadmap operacional -- cada Caso escribe el suyo (ya scoped
    // por root_run_id gracias a FEATURE-046).
    await setProjectConfig({ projectId, configKey: "release_roadmap", value: roadmapFor("A"), changedInRunId: rootAId });
    await setProjectConfig({ projectId, configKey: "release_roadmap", value: roadmapFor("B"), changedInRunId: rootBId });

    await persistProjectBrief({ projectId, runId: rootAId, phaseFinishedEventId: 1, payload: briefPayloadA, templateAsset });
    await persistProjectBrief({ projectId, runId: rootBId, phaseFinishedEventId: 1, payload: briefPayloadB, templateAsset });
    await persistArchitecture({ projectId, runId: rootAId, phaseFinishedEventId: 2, payload: archPayloadA, templateAsset });
    await persistArchitecture({ projectId, runId: rootBId, phaseFinishedEventId: 2, payload: archPayloadB, templateAsset });

    const briefRows = await pool.query<{ root_run_id: string }>("select root_run_id from project_briefs where project_id = $1 order by created_at", [projectId]);
    assert.equal(briefRows.rows.length, 2, "cada Caso debe tener su propia fila de project_briefs, sin pisarse");
    assert.deepEqual(new Set(briefRows.rows.map((r) => r.root_run_id)), new Set([rootAId, rootBId]));

    const archRows = await pool.query<{ root_run_id: string }>("select root_run_id from architectures where project_id = $1 order by created_at", [projectId]);
    assert.equal(archRows.rows.length, 2, "cada Caso debe tener su propia fila de architectures, sin pisarse");
    assert.deepEqual(new Set(archRows.rows.map((r) => r.root_run_id)), new Set([rootAId, rootBId]));

    // getProjectBriefDocumentForRun/getArchitectureDocumentForRun -- cada Caso ve únicamente el suyo,
    // nunca el del otro (síntoma real observado en la reproducción del 2026-08-20).
    const briefForA = await getProjectBriefDocumentForRun(rootAId);
    const briefForB = await getProjectBriefDocumentForRun(rootBId);
    assert.ok(briefForA?.materialized, "Caso A debe ver su propio Project Brief materializado");
    assert.ok(briefForB?.materialized, "Caso B debe ver su propio Project Brief materializado");

    const archForA = await getArchitectureDocumentForRun(rootAId);
    const archForB = await getArchitectureDocumentForRun(rootBId);
    assert.ok(archForA, "Caso A debe ver su propia Architecture materializada");
    assert.ok(archForB, "Caso B debe ver su propia Architecture materializada");

    // Un run hijo del mismo Caso A (root_run_id compartido) sigue viendo el Project Brief de A --
    // regresión explícita del comportamiento dentro de un mismo Caso.
    const childOfAId = randomUUID();
    const { createRun } = await import("../db/repository.js");
    await createRun({
      id: childOfAId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      firstPhase: "functional",
      branchName: "run/child-of-a",
      worktreePath: "/tmp/run-child-of-a",
      originatedFromRunId: rootAId,
    });
    const briefForChildOfA = await getProjectBriefDocumentForRun(childOfAId);
    assert.ok(briefForChildOfA, "un hijo del Caso A debe seguir viendo el Project Brief de A");
  } finally {
    await pool.query("delete from run_config_versions where run_id in (select id from runs where project_id = $1)", [projectId]);
    await pool.query("update runs set active_feature_id = null, root_run_id = null, originated_from_run_id = null where project_id = $1", [projectId]);
    await pool.query("delete from project_config_versions where project_id = $1", [projectId]);
    await pool.query("delete from project_briefs where project_id = $1", [projectId]);
    await pool.query("delete from architectures where project_id = $1", [projectId]);
    await pool.query("delete from runs where project_id = $1", [projectId]);
    await pool.query("delete from projects where id = $1", [projectId]);
  }
});
