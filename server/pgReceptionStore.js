import { withTransaction } from "./db.js";
import { PgSystemStore } from "./pgSystemStore.js";
import { httpError } from "./store.js";

const pad = (n, w = 4) => String(n).padStart(w, "0");
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class PgReceptionStore {
  constructor(db, system = new PgSystemStore(db)) {
    this.db = db;
    this.system = system;
  }

  async addPatient(input, userId = "U04") {
    await this.system.requireUser(userId);
    const meta = await this.system.clinicSettings();
    const seq = await this.system.nextSeq("patient");
    const patient = {
      id: `P${pad(seq, 3)}`,
      uhid: `GCK/${meta.financialYear}/${pad(seq, 4)}`,
      firstName: required(input.firstName, "firstName"),
      lastName: required(input.lastName, "lastName"),
      gender: input.gender === "F" ? "F" : "M",
      dob: required(input.dob, "dob"),
      mobile: validateMobile(input.mobile),
      guardian: { rel: input.guardianRel || "C/o", name: required(input.guardianName, "guardianName") },
      address: input.address || "",
      bloodGroup: input.bloodGroup || "",
      allergies: input.allergies || "Nil known",
      weights: []
    };
    await this.db.query(
      `insert into patients (id, uhid, first_name, last_name, gender, dob, mobile, guardian_rel, guardian_name, address, blood_group, allergies)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [patient.id, patient.uhid, patient.firstName, patient.lastName, patient.gender, patient.dob, patient.mobile, patient.guardian.rel, patient.guardian.name, patient.address, patient.bloodGroup, patient.allergies]
    );
    await this.system.audit(userId, "CREATE", "patient", patient.id, { uhid: patient.uhid });
    return patient;
  }

  async createVisit(input, userId = "U02") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireUser(userId);
      const meta = await system.clinicSettings();
      const patient = await getPatient(db, required(input.patientId, "patientId"));
      const doctor = await getDoctor(db, required(input.doctorId, "doctorId"));
      const items = await normalizeServiceItems(db, input.items || []);
      const subtotal = money(items.reduce((s, it) => s + it.rate * it.qty, 0));
      const discount = money(input.discount || 0);
      const total = Math.max(0, money(subtotal - discount));
      const paid = normalizePayment(input.payment, total);
      const seq = await system.nextSeq("opd");
      const invoiceSeq = await system.nextSeq("invoice");
      const visitAt = new Date().toISOString();
      const id = `V${pad(10000 + seq, 5)}`;
      const voucherNo = `OPD/${meta.financialYear}/${pad(seq, 4)}`;
      const visit = {
        id,
        voucherNo,
        patientId: patient.id,
        doctorId: doctor.id,
        date: visitAt,
        status: "waiting",
        vitals: normalizeVitals(input.vitals),
        items,
        subtotal,
        discount,
        total,
        paid,
        notes: "",
        prescription: []
      };
      await db.query(
        `insert into visits (id, voucher_no, patient_id, doctor_id, visit_at, status, subtotal, discount, total, created_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         returning *`,
        [visit.id, visit.voucherNo, visit.patientId, visit.doctorId, visit.date, visit.status, visit.subtotal, visit.discount, visit.total, userId]
      );
      if (Object.keys(visit.vitals).length) {
        await db.query(
          `insert into vitals (visit_id, weight_kg, height_cm, temp_f, pulse, recorded_at, recorded_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [visit.id, visit.vitals.wt || null, visit.vitals.ht || null, visit.vitals.temp || null, visit.vitals.pulse || null, visit.date, userId]
        );
      }
      if (visit.vitals.wt) {
        await db.query(
          `insert into patient_weight_history (patient_id, recorded_at, weight_kg)
           values ($1, $2, $3)`,
          [patient.id, visit.date, visit.vitals.wt]
        );
      }
      for (const item of items) {
        await db.query(
          `insert into visit_items (visit_id, service_id, name, qty, rate, gst)
           values ($1, $2, $3, $4, $5, $6)`,
          [visit.id, item.serviceId, item.name, item.qty, item.rate, item.gst || 0]
        );
      }
      const invoiceId = `INV${pad(invoiceSeq, 5)}`;
      await db.query(
        `insert into invoices (id, kind, ref_id, voucher_no, party_id, invoice_at, total, created_by)
         values ($1, 'OPD', $2, $3, $4, $5, $6, $7)
         returning *`,
        [invoiceId, visit.id, visit.voucherNo, patient.id, visit.date, visit.total, userId]
      );
      for (const item of items) {
        await db.query(
          `insert into invoice_items (invoice_id, name, qty, rate, gst)
           values ($1, $2, $3, $4, $5)`,
          [invoiceId, item.name, item.qty, item.rate, item.gst || 0]
        );
      }
      if (paid.cash) await insertPayment(db, invoiceId, "Cash", paid.cash, visit.date);
      if (paid.upi) await insertPayment(db, invoiceId, "UPI", paid.upi, visit.date);
      await system.audit(userId, "CREATE", "visit", visit.id, { voucherNo, total });
      return visit;
    });
  }
}

async function runInTransaction(db, work) {
  if (typeof db.connect === "function") return withTransaction(db, work);
  return work(db);
}

async function getPatient(db, id) {
  const result = await db.query(
    `select *
     from patients
     where id = $1`,
    [id]
  );
  const patient = result.rows[0];
  if (!patient) throw httpError(404, "Patient not found");
  return patient;
}

async function getDoctor(db, id) {
  const result = await db.query(
    `select *
     from doctors
     where id = $1 and active = true`,
    [id]
  );
  const doctor = result.rows[0];
  if (!doctor) throw httpError(404, "Doctor not found");
  return doctor;
}

async function normalizeServiceItems(db, items) {
  const requested = items.length ? items : [{ serviceId: "S01", qty: 1 }];
  const ids = requested.map((it) => required(it.serviceId, "serviceId"));
  const result = await db.query(
    `select *
     from services
     where id = any($1) and active = true`,
    [ids]
  );
  return requested.map((it) => {
    const service = result.rows.find((s) => s.id === it.serviceId);
    if (!service) throw httpError(404, "Service not found");
    const qty = Number(it.qty) || 1;
    return { serviceId: service.id, name: service.name, rate: money(service.rate), qty, gst: Number(service.gst) || 0 };
  });
}

async function insertPayment(db, invoiceId, mode, amount, paidAt) {
  await db.query(
    `insert into payments (invoice_id, mode, amount, paid_at)
     values ($1, $2, $3, $4)`,
    [invoiceId, mode, amount, paidAt]
  );
}

function normalizeVitals(input = {}) {
  const vitals = {};
  for (const key of ["wt", "ht", "temp", "pulse"]) {
    if (input[key] !== "" && input[key] !== undefined && input[key] !== null) vitals[key] = Number(input[key]);
  }
  return vitals;
}

function normalizePayment(payment = {}, total) {
  const cash = money(payment.cash || 0);
  const upi = money(payment.upi || 0);
  if (cash + upi + 0.01 < total) throw httpError(400, "Payment is less than total");
  if (cash + upi > total + 0.01) throw httpError(400, "Payment is more than total");
  const mode = cash > 0 && upi > 0 ? "Mixed" : cash > 0 ? "Cash" : "UPI";
  return { mode, cash, upi };
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") throw httpError(400, `${field} is required`);
  return String(value).trim();
}

function validateMobile(value) {
  const mobile = String(value || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile)) throw httpError(400, "mobile must be a 10-digit Indian number");
  return mobile;
}
