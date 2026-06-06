import assert from "node:assert/strict";
import test from "node:test";
import { PgReceptionStore } from "../server/pgReceptionStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

test("Postgres reception store registers patient with UHID sequence", async () => {
  const db = fakeDb(fakePgState());
  const store = new PgReceptionStore(db);
  const patient = await store.addPatient({
    firstName: "Baby",
    lastName: "Rao",
    gender: "F",
    dob: "2024-01-01",
    mobile: "9876543219",
    guardianName: "Ramesh Rao",
    guardianRel: "D/o",
    address: "Guntur",
    bloodGroup: "B+",
    allergies: "Nil known"
  }, "U02");
  assert.equal(patient.id, "P241");
  assert.equal(patient.uhid, "GCK/26/0241");
  assert.equal(db.state.patients[0].first_name, "Baby");
  assert.equal(db.state.auditLogs.at(-1).entity, "patient");
});

test("Postgres reception store creates OPD visit invoice and payment rows", async () => {
  const db = fakeDb(fakePgState());
  const store = new PgReceptionStore(db);
  const visit = await store.createVisit({
    patientId: "P001",
    doctorId: "D01",
    vitals: { wt: 18.4, temp: 99 },
    items: [{ serviceId: "S01", qty: 1 }],
    payment: { cash: 400, upi: 0 }
  }, "U02");
  assert.equal(visit.id, "V10026");
  assert.equal(visit.voucherNo, "OPD/26/0026");
  assert.equal(visit.total, 400);
  assert.equal(db.state.visits[0].voucher_no, "OPD/26/0026");
  assert.equal(db.state.vitals[0].weight_kg, 18.4);
  assert.equal(db.state.patientWeights[0].weight_kg, 18.4);
  assert.equal(db.state.visitItems[0].name, "Consultation");
  assert.equal(db.state.invoices[0].id, "INV00201");
  assert.equal(db.state.payments[0].mode, "Cash");
  assert.equal(db.state.auditLogs.at(-1).entity, "visit");
});

test("Postgres reception store rejects underpaid OPD visit", async () => {
  const db = fakeDb(fakePgState());
  const store = new PgReceptionStore(db);
  await assert.rejects(
    () => store.createVisit({
      patientId: "P001",
      doctorId: "D01",
      items: [{ serviceId: "S01", qty: 1 }],
      payment: { cash: 100, upi: 0 }
    }, "U02"),
    /Payment is less than total/
  );
});
