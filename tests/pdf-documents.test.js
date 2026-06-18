import assert from "node:assert/strict";
import test from "node:test";
import { generateClinicPdf } from "../server/pdfDocuments.js";

const meta = { clinicName: "Charaka Test Clinic", clinicSubtitle: "Children's Clinic", address: "Guntur", phone: "1234567890", gstin: "GST123" };
const patient = { firstName: "Baby", lastName: "Rao", uhid: "GCK/26/0001", mobile: "9876543210", guardian: { name: "Rao" } };

test("server generates OPD, prescription, and pharmacy PDFs", async () => {
  const documents = [
    await generateClinicPdf({
      kind: "opd_receipt",
      meta,
      patient,
      record: { id: "V1", voucherNo: "OPD/26/0001", date: new Date().toISOString(), items: [{ name: "Consultation", qty: 1, rate: 400 }], total: 400, vitals: { wt: 12 } }
    }),
    await generateClinicPdf({
      kind: "prescription",
      meta,
      patient,
      record: { id: "V1", voucherNo: "OPD/26/0001", date: new Date().toISOString(), prescription: [{ name: "Paracetamol", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }], notes: "Hydration advised" }
    }),
    await generateClinicPdf({
      kind: "pharmacy_invoice",
      meta,
      patient,
      drugs: [{ id: "DR01", hsn: "300490" }],
      record: { id: "PH1", voucherNo: "PH/26/0001", date: new Date().toISOString(), items: [{ drugId: "DR01", name: "Paracetamol", batch: "B1", expiry: "2027-01-01", qty: 1, rate: 48 }], total: 48 }
    })
  ];

  for (const pdf of documents) {
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 1000);
  }
});
