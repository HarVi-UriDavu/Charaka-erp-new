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

test("clinical save marks visit done automatically", () => {
  const store = tempStore();
  const visit = store.createVisit({
    patientId: "P001",
    doctorId: "D01",
    items: [{ serviceId: "S01", qty: 1 }],
    payment: { cash: 400, upi: 0 }
  }, "U02");
  const updated = store.updateVisitClinical(visit.id, {
    status: "in-consult",
    notes: "Prescription entered",
    prescription: [{ drugId: "DR01", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }]
  }, "U01");
  assert.equal(updated.status, "done");
  assert.equal(updated.prescription.length, 1);
});

test("pharmacy sale rejects overpayment", () => {
  const store = tempStore();
  const batch = store.state.drugBatches.find((b) => b.drugId === "DR02");
  assert.throws(
    () => store.createPharmacySale({
      patientId: "P001",
      items: [{ drugId: "DR02", batchId: batch.id, qty: 1 }],
      payment: { cash: 400, upi: 0 }
    }, "U03"),
    /Payment is more than total/
  );
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

test("admin can manually add master data and opening stock", () => {
  const store = tempStore();
  const service = store.addService({ code: "XRAY", name: "X-ray review", category: "OPD", rate: 150, gst: 0 }, "U04");
  const drug = store.addDrug({ name: "Test Drops", form: "Drops", pack: "10 ml", mrp: 42, gst: 12, reorderLevel: 5 }, "U04");
  const supplier = store.addSupplier({ name: "Test Medicals", phone: "9876543210", city: "Guntur" }, "U04");
  const user = store.addUser({ name: "Evening Reception", role: "reception", pin: "2468" }, "U04");
  const batch = store.addOpeningStock({ drugId: drug.id, batch: "TST001", expiry: "2027-01-31", qty: 12, rate: 30, mrp: 42 }, "U04");
  assert.equal(service.name, "X-ray review");
  assert.equal(supplier.name, "Test Medicals");
  assert.equal(user.role, "reception");
  assert.equal(batch.qty, 12);
  assert.ok(store.state.stockMovements.some((m) => m.kind === "OPENING" && m.batchId === batch.id));
});

test("non-admin cannot manually change master data", () => {
  const store = tempStore();
  assert.throws(
    () => store.addDrug({ name: "Blocked Drug", mrp: 10 }, "U03"),
    /Only admin/
  );
});

test("login accepts valid PIN and rejects invalid PIN", () => {
  const store = tempStore();
  const session = store.login({ userId: "U04", pin: "4444" });
  assert.equal(session.role, "admin");
  assert.throws(
    () => store.login({ userId: "U04", pin: "1111" }),
    /Invalid account or PIN/
  );
});

test("existing data loads receipt metadata defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charaka-test-"));
  const file = path.join(dir, "clinic.json");
  fs.writeFileSync(file, JSON.stringify({ meta: { clinicName: "Existing" }, sequences: {}, users: [] }));
  const store = new ClinicStore(file);
  assert.equal(store.state.meta.gstin, "37AHDPT3692H1ZW");
  assert.ok(store.state.meta.drugLicenseNo20);
});

test("admin can update clinic receipt settings", () => {
  const store = tempStore();
  const meta = store.updateClinicSettings({
    clinicName: "Charaka Clinic Test",
    gstin: "37ABCDE1234F1Z5",
    drugLicenseNo20: "DL20TEST",
    financialYear: "27"
  }, "U04");
  assert.equal(meta.clinicName, "Charaka Clinic Test");
  assert.equal(meta.gstin, "37ABCDE1234F1Z5");
  assert.equal(meta.drugLicenseNo20, "DL20TEST");
  assert.equal(meta.financialYear, "27");
});

test("non-admin cannot update clinic receipt settings", () => {
  const store = tempStore();
  assert.throws(
    () => store.updateClinicSettings({ gstin: "37BLOCKED1234Z1" }, "U03"),
    /Only admin/
  );
});

test("admin can add pediatric dosing rules", () => {
  const store = tempStore();
  const rule = store.addDosingRule({
    drugId: "DR01",
    indication: "Fever",
    route: "Oral",
    dosePerKg: 15,
    doseUnit: "mg",
    frequency: "every 6 hours",
    days: 3,
    maxDose: 500,
    formulationStrength: 120,
    formulationUnit: "mg",
    formulationVolumeMl: 5,
    source: "Doctor-approved licensed pediatric formulary"
  }, "U04");
  assert.match(rule.id, /^DRULE/);
  assert.equal(rule.drugId, "DR01");
  assert.equal(rule.dosePerKg, 15);
  assert.equal(rule.frequency, "every 6 hours");
});

test("backend suggests pediatric dose from approved rule", () => {
  const store = tempStore();
  const rule = store.addDosingRule({
    drugId: "DR01",
    indication: "Fever",
    dosePerKg: 10,
    doseUnit: "mg",
    frequency: "every 8 hours",
    days: 2,
    formulationStrength: 100,
    formulationUnit: "mg",
    formulationVolumeMl: 5,
    source: "Doctor-approved test rule"
  }, "U04");
  const visit = store.createVisit({
    patientId: "P001",
    doctorId: "D01",
    vitals: { wt: 12 },
    items: [{ serviceId: "S01", qty: 1 }],
    payment: { cash: 400, upi: 0 }
  }, "U02");
  const suggestion = store.suggestDose({ visitId: visit.id, drugId: "DR01", indication: "Fever" }, "U01");
  assert.equal(suggestion.ruleId, rule.id);
  assert.equal(suggestion.dose, "120 mg / approx 6 ml");
  assert.equal(suggestion.frequency, "every 8 hours");
  assert.equal(suggestion.source, "Doctor-approved test rule");
});

test("backend dosing suggestion requires a matching rule", () => {
  const store = tempStore();
  assert.throws(
    () => store.suggestDose({ patientId: "P001", drugId: "DR01", vitals: { wt: 12 } }, "U01"),
    /No matching admin-approved dosing rule/
  );
});

test("non-admin cannot add pediatric dosing rules", () => {
  const store = tempStore();
  assert.throws(
    () => store.addDosingRule({ drugId: "DR01", dosePerKg: 10, frequency: "BD", source: "Blocked" }, "U03"),
    /Only admin/
  );
});

test("clinical prescription keeps dosing suggestion metadata", () => {
  const store = tempStore();
  const visit = store.createVisit({
    patientId: "P001",
    doctorId: "D01",
    vitals: { wt: 18 },
    items: [{ serviceId: "S01", qty: 1 }],
    payment: { cash: 400, upi: 0 }
  }, "U02");
  const updated = store.updateVisitClinical(visit.id, {
    prescription: [{
      drugId: "DR01",
      indication: "Fever",
      dose: "270 mg / approx 11.3 ml",
      frequency: "every 6 hours",
      days: 3,
      qty: 1,
      dosingRuleId: "DRULE0001",
      suggestedDose: "270 mg / approx 11.3 ml",
      suggestionSource: "Doctor-approved licensed pediatric formulary"
    }]
  }, "U01");
  assert.equal(updated.prescription[0].dosingRuleId, "DRULE0001");
  assert.equal(updated.prescription[0].suggestionSource, "Doctor-approved licensed pediatric formulary");
});
