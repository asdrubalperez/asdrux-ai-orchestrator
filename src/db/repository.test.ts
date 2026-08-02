import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createRun,
  createRunPendingStart,
  deleteRoleAgentConfigOverride,
  getGlobalAgentConfig,
  getRoleAgentConfigOverride,
  getRootRunExecutionContext,
  resolveAgentConfig,
  setGlobalAgentConfig,
  setRoleAgentConfigOverride,
} from "./repository.js";
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

// FEATURE-025-Parte-1, sección 5.1/5.7: precedencia rol -> global -> default, y el modelo viaja
// junto con provider/authMode en la misma fila (sección 7.1). Sin transacción/rollback -- estas
// funciones usan `pool` directamente (mismo criterio que gitConnectionService.ts, sin client
// inyectado); limpieza manual en el finally.
test("resolveAgentConfig: precedencia rol > global > default, incluido el modelo", async (t) => {
  try {
    await pool.query("select 1");
  } catch (error) {
    if (error instanceof AggregateError || (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
      t.skip("PostgreSQL integration database unavailable; covered on VPS");
      return;
    }
    throw error;
  }
  const prerequisite = await pool.query<{ owner_id: string }>(
    "select id as owner_id from users order by created_at asc limit 1"
  );
  if (!prerequisite.rows[0]) {
    t.skip("Requires at least one user in the integration database");
    return;
  }
  const userId = prerequisite.rows[0].owner_id;

  try {
    // Sin ninguna fila -> default (claude/api_key, sin modelo).
    const withoutConfig = await resolveAgentConfig(userId, "architect");
    assert.deepEqual(withoutConfig, { executorProvider: "claude", authMode: "api_key", model: null });

    // Configuración global -> todos los roles sin override la heredan.
    const global = await setGlobalAgentConfig(userId, {
      executorProvider: "codex",
      authMode: "api_key",
      model: "gpt-5.6-luna",
    });
    assert.deepEqual(global, { executorProvider: "codex", authMode: "api_key", model: "gpt-5.6-luna" });
    assert.deepEqual(await getGlobalAgentConfig(userId), global);
    assert.deepEqual(await resolveAgentConfig(userId, "developer"), global);

    // Override de rol -> ese rol usa su propia combinación; los demás siguen en la global.
    const roleOverride = await setRoleAgentConfigOverride(userId, "developer", {
      executorProvider: "claude",
      authMode: "cli_session",
      model: "claude-opus-5",
    });
    assert.deepEqual(await getRoleAgentConfigOverride(userId, "developer"), roleOverride);
    assert.deepEqual(await resolveAgentConfig(userId, "developer"), roleOverride);
    assert.deepEqual(await resolveAgentConfig(userId, "qa"), global);

    // Eliminar el override -> ese rol vuelve a heredar la global (Regla 5.1.3).
    await deleteRoleAgentConfigOverride(userId, "developer");
    assert.equal(await getRoleAgentConfigOverride(userId, "developer"), null);
    assert.deepEqual(await resolveAgentConfig(userId, "developer"), global);
  } finally {
    await deleteRoleAgentConfigOverride(userId, "developer").catch(() => {});
    await pool.query("delete from user_agent_config where user_id = $1 and role is null", [userId]).catch(() => {});
  }
});
