import { withTransaction } from "./db.js";
import { PgSystemStore } from "./pgSystemStore.js";
import { httpError } from "./store.js";

export class PgClinicalStore {
  constructor(db, system = new PgSystemStore(db)) {
    this.db = db;
    this.system = system;
  }

  async updateVisitClinical(id, input, userId = "U01") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireUser(userId);
      const visit = await getVisit(db, id);
      const vitals = normalizeVitals(input.vitals || {});
      await db.query(
        `update visits
         set status = 'done',
             notes = $2,
             follow_up_date = $3,
             follow_up_reason = $4,
             updated_by = $5,
             updated_at = now()
         where id = $1
         returning *`,
        [id, input.notes || "", input.followUpDate || null, input.followUpReason || "", userId]
      );
      if (Object.keys(vitals).length) {
        await db.query(
          `insert into vitals (visit_id, weight_kg, height_cm, temp_f, pulse, recorded_at, recorded_by)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, vitals.wt || null, vitals.ht || null, vitals.temp || null, vitals.pulse || null, new Date().toISOString(), userId]
        );
      }
      if (vitals.wt) {
        await db.query(
          `insert into patient_weight_history (patient_id, recorded_at, weight_kg)
           values ($1, $2, $3)`,
          [visit.patient_id, new Date().toISOString(), vitals.wt]
        );
      }
      await db.query(`delete from prescriptions where visit_id = $1`, [id]);
      const prescription = [];
      for (const row of input.prescription || []) {
        if (!row.name && !row.drugId) continue;
        const item = {
          drugId: row.drugId || "",
          name: row.name || await drugName(db, row.drugId),
          dose: row.dose || "",
          frequency: row.frequency || "",
          days: Number(row.days) || 0,
          qty: Number(row.qty) || 1
        };
        await db.query(
          `insert into prescriptions (visit_id, drug_id, name, dose, frequency, days, qty)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, item.drugId || null, item.name, item.dose, item.frequency, item.days, item.qty]
        );
        prescription.push(item);
      }
      await system.audit(userId, "UPDATE", "visit", id, { status: "done", rx: prescription.length });
      return {
        id,
        voucherNo: visit.voucher_no,
        patientId: visit.patient_id,
        doctorId: visit.doctor_id,
        date: visit.visit_at,
        status: "done",
        vitals: { ...vitals },
        notes: input.notes || "",
        followUpDate: input.followUpDate || null,
        followUpReason: input.followUpReason || "",
        prescription
      };
    });
  }
}

async function runInTransaction(db, work) {
  if (typeof db.connect === "function") return withTransaction(db, work);
  return work(db);
}

async function getVisit(db, id) {
  const result = await db.query(
    `select *
     from visits
     where id = $1`,
    [id]
  );
  const visit = result.rows[0];
  if (!visit) throw httpError(404, "Visit not found");
  return visit;
}

async function drugName(db, id) {
  if (!id) return "";
  const result = await db.query(
    `select name
     from drugs
     where id = $1`,
    [id]
  );
  return result.rows[0]?.name || "";
}

function normalizeVitals(input = {}) {
  const vitals = {};
  for (const key of ["wt", "ht", "temp", "pulse"]) {
    if (input[key] !== "" && input[key] !== undefined && input[key] !== null) vitals[key] = Number(input[key]);
  }
  return vitals;
}
