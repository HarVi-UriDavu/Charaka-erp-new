import assert from "node:assert/strict";
import test from "node:test";
import { PgAppStore } from "../server/pgAppStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

function appState() {
  return fakePgState({
    sequences: { audit: 1, stock: 1, patient: 240, importJob: 1 },
    visits: [
      { id: "V01020", voucher_no: "OPD/26/0020", patient_id: "P001", doctor_id: "D01", visit_at: "2026-06-06T09:00:00.000Z", status: "done", notes: "Well", subtotal: 400, discount: 0, total: 400 }
    ],
    vitals: [
      { visit_id: "V01020", weight_kg: 18.2, height_cm: 110, temp_f: 98.6, pulse: 90, recorded_at: "2026-06-06T09:01:00.000Z" }
    ],
    visitItems: [
      { visit_id: "V01020", service_id: "S01", name: "Consultation", qty: 1, rate: 400, gst: 0 }
    ],
    prescriptions: [
      { visit_id: "V01020", drug_id: "DR01", name: "Paracetamol Syrup", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }
    ],
    invoices: [
      { id: "INV001", kind: "OPD", ref_id: "V01020", voucher_no: "OPD/26/0020", party_id: "P001", invoice_at: "2026-06-06T09:00:00.000Z", total: 400, status: "paid" }
    ],
    invoiceItems: [
      { invoice_id: "INV001", name: "Consultation", qty: 1, rate: 400, gst: 0 }
    ],
    payments: [
      { invoice_id: "INV001", mode: "Cash", amount: 400, paid_at: "2026-06-06T09:00:00.000Z" }
    ]
  });
}

test("Postgres app store returns frontend snapshot shape", async () => {
  const store = new PgAppStore(fakeDb(appState()));
  const snapshot = await store.snapshot();

  assert.equal(snapshot.meta.clinicName, "Charaka Test");
  assert.equal(snapshot.patients[0].guardian.name, "Suresh Kumar");
  assert.equal(snapshot.visits[0].prescription[0].name, "Paracetamol Syrup");
  assert.equal(snapshot.visits[0].paid.cash, 400);
  assert.equal(snapshot.invoices[0].items[0].name, "Consultation");
});

test("Postgres app store supports manual admin master data", async () => {
  const state = appState();
  const store = new PgAppStore(fakeDb(state));

  const drug = await store.addDrug({ name: "ORS Sachet", mrp: 22, gst: 5, reorderLevel: 25 }, "U04");
  const supplier = await store.addSupplier({ name: "Sai Medical Agencies", city: "Guntur" }, "U04");
  const user = await store.addUser({ name: "Evening Reception", role: "reception", pin: "2468" }, "U04");

  assert.equal(drug.id, "DR03");
  assert.equal(supplier.id, "SUP02");
  assert.equal(user.role, "reception");
  assert.equal(state.auditLogs.at(-1).entity, "user");
});

test("Postgres app store imports CSV and records import job", async () => {
  const state = appState();
  const store = new PgAppStore(fakeDb(state));

  const job = await store.importCsv("suppliers", "name,city\nNew Supplier,Guntur", "U04");

  assert.equal(job.imported, 1);
  assert.equal(job.failed, 0);
  assert.equal(state.suppliers.at(-1).name, "New Supplier");
  assert.equal(state.importJobs[0].entity, "suppliers");
});
