import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../db/pool.js";
import type { UserRow } from "../db/repository.js";
import {
  CannotActOnSelfError,
  CannotActOnTargetError,
  demoteToUser,
  InsufficientRoleError,
  promoteToAdmin,
  reactivateAccount,
  suspendAccount,
} from "./accountAdminService.js";

// Regla 5.8, la matriz completa: corre contra la DB de integración real (mismo criterio que
// repository.test.ts) -- se salta si no hay Postgres disponible localmente (cubierto en VPS).
test("Regla 5.8: jerarquía administrativa -- usuario/admin/superadmin", async (t) => {
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
  client.release();

  async function insertUser(role: "user" | "admin" | "superadmin", protectedFlag = false): Promise<UserRow> {
    const id = randomUUID();
    const result = await pool.query<UserRow>(
      `insert into users (id, handle, email, status, role, is_protected_superadmin)
       values ($1, $2, $3, 'active', $4, $5)
       returning *`,
      [id, `test-admin-${id}`, `test-admin-${id}@example.com`, role, protectedFlag]
    );
    return result.rows[0];
  }

  const normalUser = await insertUser("user");
  const adminA = await insertUser("admin");
  const adminB = await insertUser("admin");
  const superadmin = await insertUser("superadmin");
  const protectedSuperadmin = await insertUser("superadmin", true);

  try {
    // Usuario normal no puede administrar a nadie.
    await assert.rejects(suspendAccount(normalUser, adminA.id), InsufficientRoleError);

    // Admin puede suspender/reactivar a un usuario normal.
    await suspendAccount(adminA, normalUser.id);
    await reactivateAccount(adminA, normalUser.id);

    // Admin NO puede suspender a otro admin.
    await assert.rejects(suspendAccount(adminA, adminB.id), InsufficientRoleError);

    // Solo superadmin puede suspender/reactivar a un admin.
    await suspendAccount(superadmin, adminB.id);
    await reactivateAccount(superadmin, adminB.id);

    // Nadie suspende su propia cuenta, ni siquiera el superadmin.
    await assert.rejects(suspendAccount(superadmin, superadmin.id), CannotActOnSelfError);
    await assert.rejects(suspendAccount(adminA, adminA.id), CannotActOnSelfError);

    // Admin puede promover un usuario normal a admin; no puede degradar a un admin.
    await promoteToAdmin(adminA, normalUser.id);
    await assert.rejects(demoteToUser(adminA, normalUser.id), InsufficientRoleError);

    // Solo superadmin degrada un admin -- y solo si el objetivo es realmente admin.
    await demoteToUser(superadmin, normalUser.id);
    await assert.rejects(demoteToUser(superadmin, normalUser.id), CannotActOnTargetError);

    // Nadie modifica su propio rol.
    await assert.rejects(promoteToAdmin(adminA, adminA.id), CannotActOnSelfError);
    await assert.rejects(demoteToUser(superadmin, superadmin.id), CannotActOnSelfError);

    // La cuenta protegida nunca puede suspenderse ni reactivarse, ni siquiera por otro superadmin.
    await assert.rejects(suspendAccount(superadmin, protectedSuperadmin.id), CannotActOnTargetError);
  } finally {
    const ids = [normalUser.id, adminA.id, adminB.id, superadmin.id, protectedSuperadmin.id];
    await pool.query("delete from sessions where user_id = any($1::uuid[])", [ids]);
    await pool.query("delete from users where id = any($1::uuid[])", [ids]);
  }
});
