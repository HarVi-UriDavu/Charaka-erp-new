import assert from "node:assert/strict";
import test from "node:test";
import { PgReportsStore } from "../server/pgReportsStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

function reportsState() {
  return fakePgState({
    sequences: { audit: 1, importJob: 1 },
    invoices: [
      { id: "INV001", kind: "OPD", ref_id: "V001", voucher_no: "OPD/26/0001", party_id: "P001", invoice_at: "2026-06-06T09:00:00.000Z", total: 400 },
      { id: "INV002", kind: "PHARMACY", ref_id: "PH001", voucher_no: "PH/26/0001", party_id: "P001", invoice_at: "2026-06-06T10:00:00.000Z", total: 96 }
    ],
    payments: [
      { invoice_id: "INV001", mode: "Cash", amount: 400, paid_at: "2026-06-06T09:00:00.000Z" },
      { invoice_id: "INV002", mode: "UPI", amount: 96, paid_at: "2026-06-06T10:00:00.000Z" }
    ],
    salesReturns: [
      { id: "RET0001", voucher_no: "RET/26/0001", sale_id: "PH001", reason: "Return", return_at: "2026-06-06T11:00:00.000Z", amount: 48 }
    ]
  });
}

test("Postgres reports store builds daybook totals", async () => {
  const store = new PgReportsStore(fakeDb(reportsState()));
  const book = await store.daybook("2026-06-06");
  assert.equal(book.rows.length, 2);
  assert.equal(book.cash, 400);
  assert.equal(book.upi, 96);
  assert.equal(book.refund, 48);
  assert.equal(book.net, 448);
});

test("Postgres reports store returns stock valuation rows", async () => {
  const store = new PgReportsStore(fakeDb(fakePgState()));
  const rows = await store.stockRows();
  const row = rows.find((r) => r.id === "B001");
  assert.equal(row.drugName, "Paracetamol Syrup");
  assert.equal(row.value, 1444);
});

test("Postgres reports store records import and backup jobs", async () => {
  const db = fakeDb(fakePgState({ sequences: { audit: 1, importJob: 1 } }));
  const store = new PgReportsStore(db);
  const job = await store.recordImportJob("patients", 2, [{ row: 4, message: "Bad mobile" }], "U04");
  const backup = await store.recordBackupJob("/backups/clinic.sql", "U04", { size: 2048 });
  assert.equal(job.id, "IMP0002");
  assert.equal(job.failed, 1);
  assert.equal(db.state.importJobs[0].entity, "patients");
  assert.equal(backup.filePath, "/backups/clinic.sql");
  assert.equal(db.state.backupJobs[0].details.size, 2048);
  assert.equal(db.state.auditLogs.at(-1).action, "BACKUP");
});

test("Postgres reports store reads audit logs", async () => {
  const db = fakeDb(fakePgState());
  db.state.auditLogs.push({ id: "AUD0001", userId: "U04", action: "CREATE", entity: "patient", entityId: "P001", details: { uhid: "GCK/26/0001" } });
  const store = new PgReportsStore(db);
  const logs = await store.auditLogs(10);
  assert.equal(logs[0].entity, "patient");
});
