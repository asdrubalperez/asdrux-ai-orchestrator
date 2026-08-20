import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createRun,
  createRunPendingStart,
  getCurrentProjectConfig,
  getCurrentProjectConfigs,
  recordRunConfigVersions,
  setProjectConfig,
} from "./repository.js";
import { pool } from "./pool.js";

/**
 * FEATURE-046: reproduce el escenario real que motivó esta Feature (2026-08-19) -- dos Casos de
 * negocio (`root_run_id` A y B) del mismo proyecto, ambos escribiendo `release_roadmap`. Antes del
 * fix, el segundo Caso en escribir pisaba la fila vigente del primero (`valid_to`), y cualquier
 * lectura de "vigente" devolvía la del último escritor sin importar a qué Caso perteneciera el
 * lector. `getCurrentProjectConfig`/`getCurrentProjectConfigs` usan siempre `pool` directamente
 * (no aceptan `client`), así que este test no usa transacción/rollback -- limpieza manual en el
 * `finally`, mismo criterio que el test de `resolveAgentConfig` en este mismo archivo.
 */
test("FEATURE-046: dos Casos del mismo proyecto no ven el release_roadmap del otro", async (t) => {
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
  const roadmapA = { releases: [{ id: "r1", nombre: "Release de A", alcanceResumen: "", estado: "Activo" }], activeReleaseId: "r1" };
  const roadmapB = { releases: [{ id: "r1", nombre: "Release de B", alcanceResumen: "", estado: "Activo" }], activeReleaseId: "r1" };
  const projectWideValue = { compartido: true };

  try {
    await pool.query(`insert into projects (id, name, repo_path, owner_id) values ($1, 'feature-046-scoping-test', '/tmp/feature-046', $2)`, [
      projectId,
      ownerId,
    ]);
    await createRunPendingStart({
      id: rootAId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      businessCase: { vision: "Caso A" },
    });
    await createRunPendingStart({
      id: rootBId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      businessCase: { vision: "Caso B" },
    });

    // Ambos Casos declaran el mismo release_key ("r1") -- exactamente el escenario que colisionaba.
    await setProjectConfig({ projectId, configKey: "release_roadmap", value: roadmapA, changedInRunId: rootAId });
    await setProjectConfig({ projectId, configKey: "release_roadmap", value: roadmapB, changedInRunId: rootBId });

    const seenByA = await getCurrentProjectConfig(projectId, "release_roadmap", rootAId);
    const seenByB = await getCurrentProjectConfig(projectId, "release_roadmap", rootBId);
    assert.deepEqual(seenByA?.value, roadmapA, "Caso A debe ver su propio roadmap, no el de B");
    assert.deepEqual(seenByB?.value, roadmapB, "Caso B debe ver su propio roadmap, no el de A");
    assert.notDeepEqual(seenByA?.value, seenByB?.value, "los dos Casos no deben compartir la misma fila vigente");

    // getCurrentProjectConfigs (bulk, usada por recordRunConfigVersions) -- A solo trae la suya.
    const bulkForA = await getCurrentProjectConfigs(projectId, rootAId);
    const roadmapEntriesForA = bulkForA.filter((row) => row.config_key === "release_roadmap");
    assert.equal(roadmapEntriesForA.length, 1, "el bulk de A no debe traer la fila de B");
    assert.deepEqual(roadmapEntriesForA[0].value, roadmapA);

    // recordRunConfigVersions sobre un run nuevo del Caso A -- pinnea únicamente la config de A.
    const childOfAId = randomUUID();
    await createRun({
      id: childOfAId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      firstPhase: "architect",
      branchName: "run/child-of-a",
      worktreePath: "/tmp/run-child-of-a",
      originatedFromRunId: rootAId,
    });
    await recordRunConfigVersions(childOfAId);
    const pinned = await pool.query<{ value: unknown }>(
      `select pcv.value from run_config_versions rcv
       join project_config_versions pcv on pcv.id = rcv.config_version_id
       where rcv.run_id = $1 and pcv.config_key = 'release_roadmap'`,
      [childOfAId]
    );
    assert.equal(pinned.rows.length, 1, "el hijo de A debe pinnear exactamente una versión de release_roadmap");
    assert.deepEqual(pinned.rows[0].value, roadmapA, "el hijo de A debe pinnear el roadmap de A, nunca el de B");

    // Config de alcance de proyecto (sin changedInRunId) -- sigue siendo compartida por ambos Casos.
    await setProjectConfig({ projectId, configKey: "testing_policy_config", value: projectWideValue });
    const projectWideForA = await getCurrentProjectConfig(projectId, "testing_policy_config", rootAId);
    const projectWideForB = await getCurrentProjectConfig(projectId, "testing_policy_config", rootBId);
    assert.deepEqual(projectWideForA?.value, projectWideValue);
    assert.deepEqual(projectWideForB?.value, projectWideValue);
  } finally {
    await pool.query("delete from run_config_versions where run_id in (select id from runs where project_id = $1)", [projectId]);
    await pool.query("update runs set active_feature_id = null, root_run_id = null, originated_from_run_id = null where project_id = $1", [projectId]);
    await pool.query("delete from project_config_versions where project_id = $1", [projectId]);
    await pool.query("delete from runs where project_id = $1", [projectId]);
    await pool.query("delete from projects where id = $1", [projectId]);
  }
});
