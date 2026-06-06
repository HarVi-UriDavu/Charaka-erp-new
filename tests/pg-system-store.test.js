import assert from "node:assert/strict";
import test from "node:test";
import { PgSystemStore } from "../server/pgSystemStore.js";
import { fakeDb } from "./fakePg.js";

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
  assert.equal(snapshot.users.length, 3);
});
