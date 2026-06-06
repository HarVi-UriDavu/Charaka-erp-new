import assert from "node:assert/strict";
import test from "node:test";
import { PgPharmacyStore } from "../server/pgPharmacyStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

test("Postgres pharmacy store records purchase and increases batch stock", async () => {
  const db = fakeDb(fakePgState({ sequences: { audit: 1, purchase: 46, stock: 1 } }));
  const store = new PgPharmacyStore(db);
  const purchase = await store.createPurchase({
    supplierId: "SUP01",
    invoiceNo: "AP/999",
    items: [{ drugId: "DR01", batch: "PCSNEW", expiry: "2027-12-31", qty: 10, rate: 39, mrp: 50 }]
  }, "U04");
  const batch = db.state.drugBatches.find((b) => b.batch === "PCSNEW");
  assert.equal(purchase.voucherNo, "GRN/26/047");
  assert.equal(purchase.total, 390);
  assert.equal(batch.qty, 10);
  assert.equal(db.state.purchaseItems[0].batch_id, batch.id);
  assert.equal(db.state.stockMovements[0].kind, "PURCHASE");
});

test("Postgres pharmacy store records sale, invoice, payment, and stock movement", async () => {
  const db = fakeDb(fakePgState({ sequences: { audit: 1, pharmacy: 123, invoice: 200, stock: 1 } }));
  const store = new PgPharmacyStore(db);
  const sale = await store.createPharmacySale({
    patientId: "P001",
    items: [{ drugId: "DR01", batchId: "B001", qty: 2 }],
    payment: { cash: 96, upi: 0 }
  }, "U04");
  const batch = db.state.drugBatches.find((b) => b.id === "B001");
  assert.equal(sale.voucherNo, "PH/26/0124");
  assert.equal(sale.total, 96);
  assert.equal(batch.qty, 36);
  assert.equal(db.state.saleItems[0].qty, 2);
  assert.equal(db.state.invoices[0].kind, "PHARMACY");
  assert.equal(db.state.payments[0].amount, 96);
  assert.equal(db.state.stockMovements[0].qty, -2);
});

test("Postgres pharmacy store rejects sale when batch stock is insufficient", async () => {
  const db = fakeDb(fakePgState());
  const store = new PgPharmacyStore(db);
  await assert.rejects(
    () => store.createPharmacySale({
      items: [{ drugId: "DR01", batchId: "B001", qty: 200 }],
      payment: { cash: 9600, upi: 0 }
    }, "U04"),
    /has only 38 units/
  );
});

test("Postgres pharmacy store reverses stock on sales return", async () => {
  const db = fakeDb(fakePgState({ sequences: { audit: 1, pharmacy: 123, invoice: 200, return: 8, stock: 1 } }));
  const store = new PgPharmacyStore(db);
  const sale = await store.createPharmacySale({
    patientId: "P001",
    items: [{ drugId: "DR01", batchId: "B001", qty: 3 }],
    payment: { cash: 144, upi: 0 }
  }, "U04");
  const afterSale = db.state.drugBatches.find((b) => b.id === "B001").qty;
  const ret = await store.createReturn({
    saleId: sale.id,
    reason: "Patient return",
    items: [{ drugId: "DR01", batchId: "B001", qty: 1 }]
  }, "U04");
  assert.equal(ret.voucherNo, "RET/26/0009");
  assert.equal(ret.amount, 48);
  assert.equal(db.state.drugBatches.find((b) => b.id === "B001").qty, afterSale + 1);
  assert.equal(db.state.returnItems[0].qty, 1);
  assert.equal(db.state.stockMovements[0].kind, "RETURN");
});
