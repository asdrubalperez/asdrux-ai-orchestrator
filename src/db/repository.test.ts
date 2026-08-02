import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRun, createRunPendingStart, getRootRunExecutionContext } from "./repository.js";
import { pool } from "./pool.js";

// FEATURE-043, sección 5.5/7.6: valida el mecanismo central que el diseño identificó como
// críticamente riesgoso (Riesgo 1/9) -- `base_branch_name` se persiste separado de `business_case`,
// y `getRootRunExecutionContext` resuelve ambos desde el run RAÍZ de la cadena, no desde el run que
// se le pasa como argumento cuando ese run es un hijo.
test("createRunPendingStart persiste base_branch_name separado de business_case; getRootRunExecutionContext lo resuelve vía el run raíz", async (t) => {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }
  await client.query("begin");
  try {
    const prerequisite = await client.query<{ pipeline_id: string; owner_id: string }>(
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
    await client.query(`insert into projects (id, name, repo_path, owner_id) values ($1, 'feature-043', '/tmp/feature-043', $2)`, [
      projectId,
      ownerId,
    ]);

    // Run raíz pendiente de iniciar, creado con `baseBranchName` -- el camino real del flujo web
    // (`confirmIntakeForProject`).
    const rootRunId = randomUUID();
    const rootRun = await createRunPendingStart(
      {
        id: rootRunId,
        pipelineDefinitionId: pipelineId,
        ownerId,
        projectId,
        businessCase: { vision: "Caso descriptivo, sin rama adentro" },
        baseBranchName: "feature/043-separar-configuracion",
        client,
      }
    );
    assert.equal(rootRun.base_branch_name, "feature/043-separar-configuracion");
    assert.deepEqual(rootRun.business_case, { vision: "Caso descriptivo, sin rama adentro" });

    // Run raíz sin baseBranchName (omitido) -- columna debe quedar null, no un string vacío.
    const rootRunNoBranchId = randomUUID();
    const rootRunNoBranch = await createRunPendingStart({
      id: rootRunNoBranchId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      businessCase: { vision: "Otro caso" },
      client,
    });
    assert.equal(rootRunNoBranch.base_branch_name, null);

    // getRootRunExecutionContext sobre el run raíz mismo.
    const rootContext = await getRootRunExecutionContext(rootRunId, client);
    assert.equal(rootContext.baseBranchName, "feature/043-separar-configuracion");
    assert.deepEqual(rootContext.businessCase, { vision: "Caso descriptivo, sin rama adentro" });

    // Run hijo (originated_from_run_id) -- `createRun` nunca persiste business_case ni
    // base_branch_name para el hijo; getRootRunExecutionContext(childRunId) debe devolver, aun así,
    // los valores del run RAÍZ (rootRunId), no null.
    const childRunId = randomUUID();
    await createRun({
      id: childRunId,
      pipelineDefinitionId: pipelineId,
      ownerId,
      projectId,
      firstPhase: "architect",
      branchName: "run/child",
      worktreePath: "/tmp/run-child",
      originatedFromRunId: rootRunId,
      client,
    });
    const childContext = await getRootRunExecutionContext(childRunId, client);
    assert.equal(childContext.baseBranchName, "feature/043-separar-configuracion");
    assert.deepEqual(childContext.businessCase, { vision: "Caso descriptivo, sin rama adentro" });
  } finally {
    await client.query("rollback");
    client.release();
  }
});
