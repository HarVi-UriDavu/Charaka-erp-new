import assert from "node:assert/strict";
import test from "node:test";
import { PgClinicalStore } from "../server/pgClinicalStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

function stateWithVisit() {
  return fakePgState({
    visits: [{
      id: "V10026",
      voucher_no: "OPD/26/0026",
      patient_id: "P001",
      doctor_id: "D01",
      visit_at: "2026-06-06T09:00:00.000Z",
      status: "waiting",
      notes: ""
    }],
    prescriptions: [{ visit_id: "V10026", drug_id: "DR02", name: "Old Drug", dose: "old", frequency: "old", days: 1, qty: 1 }]
  });
}

test("Postgres clinical store marks visit done and saves prescription", async () => {
  const db = fakeDb(stateWithVisit());
  const store = new PgClinicalStore(db);
  const updated = await store.updateVisitClinical("V10026", {
    notes: "Fever improved",
    vitals: { wt: 18.2, temp: 98.7 },
    prescription: [{ drugId: "DR01", name: "Paracetamol Syrup", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }]
  }, "U01");
  assert.equal(updated.status, "done");
  assert.equal(updated.prescription.length, 1);
  assert.equal(db.state.visits[0].status, "done");
  assert.equal(db.state.visits[0].notes, "Fever improved");
  assert.equal(db.state.vitals[0].weight_kg, 18.2);
  assert.equal(db.state.patientWeights[0].weight_kg, 18.2);
  assert.equal(db.state.prescriptions.length, 1);
  assert.equal(db.state.prescriptions[0].name, "Paracetamol Syrup");
  assert.equal(db.state.auditLogs.at(-1).details.rx, 1);
});

test("Postgres clinical store resolves drug name when only drugId is sent", async () => {
  const db = fakeDb(stateWithVisit());
  const store = new PgClinicalStore(db);
  const updated = await store.updateVisitClinical("V10026", {
    prescription: [{ drugId: "DR01", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }]
  }, "U01");
  assert.equal(updated.prescription[0].name, "Paracetamol Syrup");
});

test("Postgres clinical store rejects missing visit", async () => {
  const db = fakeDb(fakePgState());
  const store = new PgClinicalStore(db);
  await assert.rejects(
    () => store.updateVisitClinical("V404", { prescription: [] }, "U01"),
    /Visit not found/
  );
});
