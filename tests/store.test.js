import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClinicStore } from "../server/store.js";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charaka-test-"));
  return new ClinicStore(path.join(dir, "clinic.json"));
}

test("OPD visit creates invoice and daybook totals", () => {
  const store = tempStore();
  const visit = store.createVisit({
    patientId: "P001",
    doctorId: "D01",
    vitals: { wt: 18.4 },
    items: [{ serviceId: "S01", qty: 1 }],
    payment: { cash: 400, upi: 0 }
  }, "U02");
  assert.match(visit.voucherNo, /^OPD\/26\//);
  const book = store.daybook(new Date().toISOString().slice(0, 10));
  assert.ok(book.rows.some((r) => r.refId === visit.id));
  assert.ok(book.cash >= 400);
});

test("pharmacy sale decrements selected batch stock", () => {
  const store = tempStore();
  const batch = store.state.drugBatches.find((b) => b.drugId === "DR01");
  const before = batch.qty;
  const sale = store.createPharmacySale({
    patientId: "P001",
    items: [{ drugId: "DR01", batchId: batch.id, qty: 2 }],
    payment: { cash: 96, upi: 0 }
  }, "U03");
  assert.equal(batch.qty, before - 2);
  assert.equal(sale.total, 96);
  assert.ok(store.state.stockMovements.some((m) => m.refId === sale.id && m.qty === -2));
});

test("purchase increases existing or new batch stock", () => {
  const store = tempStore();
  const purchase = store.createPurchase({
    supplierId: "SUP01",
    invoiceNo: "AP/999",
    items: [{ drugId: "DR01", batch: "PCSNEW", expiry: "2027-12-31", qty: 10, rate: 39, mrp: 50 }]
  }, "U03");
  const batch = store.state.drugBatches.find((b) => b.batch === "PCSNEW");
  assert.equal(batch.qty, 10);
  assert.equal(purchase.total, 390);
});

test("sales return reverses stock and amount", () => {
  const store = tempStore();
  const batch = store.state.drugBatches.find((b) => b.drugId === "DR03");
  const sale = store.createPharmacySale({
    items: [{ drugId: "DR03", batchId: batch.id, qty: 3 }],
    payment: { cash: 66, upi: 0 }
  }, "U03");
  const afterSale = batch.qty;
  const ret = store.createReturn({
    saleId: sale.id,
    reason: "Patient return",
    items: [{ drugId: "DR03", batchId: batch.id, qty: 1 }]
  }, "U03");
  assert.equal(batch.qty, afterSale + 1);
  assert.equal(ret.amount, 22);
});

test("CSV import records row errors", () => {
  const store = tempStore();
  const job = store.importCsv("patients", "firstName,lastName,dob,gender,mobile,guardianName\nBaby,Rao,2024-01-01,F,9876543219,Rao\nBad,Rao,2024-01-01,F,123,Rao", "U04");
  assert.equal(job.imported, 1);
  assert.equal(job.failed, 1);
});
