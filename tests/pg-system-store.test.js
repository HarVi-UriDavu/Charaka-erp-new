import assert from "node:assert/strict";
import test from "node:test";
import { PgSystemStore, hashPin } from "../server/pgSystemStore.js";

function fakeDb() {
  const state = {
    settings: {
      clinicName: "Charaka Test",
      financialYear: "26",
      gstin: "37AHDPT3692H1ZW"
    },
    sequences: { audit: 1 },
    users: [
      { id: "U01", name: "Doctor", role: "doctor", pin_hash: hashPin("1111"), active: true },
      { id: "U04", name: "Admin", role: "admin", pin_hash: hashPin("4444"), active: true }
    ],
    rolePermissions: [
      { role_id: "admin", permission_id: "settings" },
      { role_id: "admin", permission_id: "masters" },
      { role_id: "doctor", permission_id: "clinical" }
    ],
    auditLogs: []
  };
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("insert into sequences")) {
        const key = params[0];
        state.sequences[key] = (state.sequences[key] || 0) + 1;
        return { rows: [{ value: state.sequences[key] }] };
      }
      if (text.startsWith("insert into audit_logs")) {
        state.auditLogs.push({ id: params[0], userId: params[1], action: params[2], entity: params[3], entityId: params[4], details: JSON.parse(params[5]) });
        return { rows: [] };
      }
      if (text.includes("from users") && text.includes("pin_hash")) {
        return { rows: state.users.filter((u) => u.id === params[0] && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role, pin_hash: u.pin_hash })) };
      }
      if (text.includes("from users") && text.includes("where id = $1")) {
        return { rows: state.users.filter((u) => u.id === params[0] && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })) };
      }
      if (text.includes("from users") && text.includes("order by id")) {
        return { rows: state.users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })) };
      }
      if (text.includes("from role_permissions")) {
        return { rows: state.rolePermissions };
      }
      if (text.includes("from app_settings")) {
        return { rows: [{ value: state.settings }] };
      }
      if (text.startsWith("insert into app_settings")) {
        state.settings = JSON.parse(params[0]);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in fakeDb: ${text}`);
    }
  };
}

test("Postgres system store logs in with hashed PIN", async () => {
  const db = fakeDb();
  const store = new PgSystemStore(db);
  const session = await store.login({ userId: "U04", pin: "4444" });
  assert.equal(session.role, "admin");
  assert.equal(db.state.auditLogs[0].action, "LOGIN");
  await assert.rejects(() => store.login({ userId: "U04", pin: "1111" }), /Invalid account or PIN/);
});

test("Postgres system store updates clinic settings with admin guard", async () => {
  const db = fakeDb();
  const store = new PgSystemStore(db);
  const meta = await store.updateClinicSettings({ clinicName: "Updated Clinic", financialYear: "27" }, "U04");
  assert.equal(meta.clinicName, "Updated Clinic");
  assert.equal(meta.financialYear, "27");
  assert.equal(db.state.auditLogs.at(-1).entity, "settings");
  await assert.rejects(() => store.updateClinicSettings({ clinicName: "Blocked" }, "U01"), /Only admin/);
});

test("Postgres system snapshot returns settings, roles, and users", async () => {
  const store = new PgSystemStore(fakeDb());
  const snapshot = await store.snapshotSystem();
  assert.equal(snapshot.meta.clinicName, "Charaka Test");
  assert.deepEqual(snapshot.roles.admin, ["settings", "masters"]);
  assert.equal(snapshot.users.length, 2);
});
