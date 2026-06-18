import { createPool, withTransaction } from "../server/db.js";
import { hashPin } from "../server/pgSystemStore.js";
import { createSeedData } from "../server/seed.js";

const seed = createSeedData();
const pool = await createPool({ max: 1 });

try {
  await withTransaction(pool, async (db) => {
    await seedSettings(db);
    await seedSequences(db);
    await seedUsers(db);
    await seedDoctors(db);
    await seedServices(db);
    await seedSuppliers(db);
    await seedDrugsAndBatches(db);
    await seedVaccines(db);
    await seedPatients(db);
    await seedVisitsAndInvoices(db);
    await seedStockMovements(db);
  });
  console.log("PostgreSQL seed data loaded");
} finally {
  await pool.end();
}

async function seedSettings(db) {
  await db.query(
    `insert into app_settings (key, value)
     values ('clinic', $1)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(seed.meta)]
  );
}

async function seedSequences(db) {
  for (const [key, value] of Object.entries(seed.sequences)) {
    await db.query(
      `insert into sequences (key, value)
       values ($1, $2)
       on conflict (key) do update set value = greatest(sequences.value, excluded.value)`,
      [key, value]
    );
  }
}

async function seedUsers(db) {
  for (const user of seed.users) {
    await db.query(
      `insert into users (id, name, role_id, pin_hash, active)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set
         name = excluded.name,
         role_id = excluded.role_id,
         pin_hash = excluded.pin_hash,
         active = excluded.active,
         updated_at = now()`,
      [user.id, user.name, user.role, hashPin(user.pin), user.active]
    );
  }
}

async function seedDoctors(db) {
  for (const doctor of seed.doctors) {
    await db.query(
      `insert into doctors (id, name, qualification, reg_no, consult_fee, follow_up_fee, active)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         name = excluded.name,
         qualification = excluded.qualification,
         reg_no = excluded.reg_no,
         consult_fee = excluded.consult_fee,
         follow_up_fee = excluded.follow_up_fee,
         active = excluded.active,
         updated_at = now()`,
      [doctor.id, doctor.name, doctor.qualification, doctor.regNo, doctor.consultFee, doctor.followUpFee, doctor.active]
    );
  }
}

async function seedServices(db) {
  for (const service of seed.services) {
    await db.query(
      `insert into services (id, code, name, category, rate, gst, active)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         code = excluded.code,
         name = excluded.name,
         category = excluded.category,
         rate = excluded.rate,
         gst = excluded.gst,
         active = excluded.active,
         updated_at = now()`,
      [service.id, service.code, service.name, service.category, service.rate, service.gst, service.active]
    );
  }
}

async function seedSuppliers(db) {
  for (const supplier of seed.suppliers) {
    await db.query(
      `insert into suppliers (id, name, gstin, phone, city, active)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         name = excluded.name,
         gstin = excluded.gstin,
         phone = excluded.phone,
         city = excluded.city,
         active = excluded.active,
         updated_at = now()`,
      [supplier.id, supplier.name, supplier.gstin, supplier.phone, supplier.city, supplier.active]
    );
  }
}

async function seedDrugsAndBatches(db) {
  for (const drug of seed.drugs) {
    await db.query(
      `insert into drugs (id, name, form, pack, hsn, mrp, gst, reorder_level, active)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         name = excluded.name,
         form = excluded.form,
         pack = excluded.pack,
         hsn = excluded.hsn,
         mrp = excluded.mrp,
         gst = excluded.gst,
         reorder_level = excluded.reorder_level,
         active = excluded.active,
         updated_at = now()`,
      [drug.id, drug.name, drug.form, drug.pack, drug.hsn, drug.mrp, drug.gst, drug.reorderLevel, drug.active]
    );
  }
  for (const batch of seed.drugBatches) {
    await db.query(
      `insert into drug_batches (id, drug_id, batch, expiry, qty, purchase_rate, mrp)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         drug_id = excluded.drug_id,
         batch = excluded.batch,
         expiry = excluded.expiry,
         qty = excluded.qty,
         purchase_rate = excluded.purchase_rate,
         mrp = excluded.mrp,
         updated_at = now()`,
      [batch.id, batch.drugId, batch.batch, dateOnly(batch.expiry), batch.qty, batch.purchaseRate, batch.mrp]
    );
  }
}

async function seedPatients(db) {
  for (const patient of seed.patients) {
    await db.query(
      `insert into patients
         (id, uhid, first_name, last_name, gender, dob, mobile, guardian_rel, guardian_name,
          address, blood_group, allergies, whatsapp_consent, whatsapp_consent_at,
          whatsapp_consent_by, whatsapp_language, whatsapp_opted_out, whatsapp_number_confirmed)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict (id) do update set
         uhid = excluded.uhid,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         gender = excluded.gender,
         dob = excluded.dob,
         mobile = excluded.mobile,
         guardian_rel = excluded.guardian_rel,
         guardian_name = excluded.guardian_name,
         address = excluded.address,
         blood_group = excluded.blood_group,
         allergies = excluded.allergies,
         whatsapp_consent = excluded.whatsapp_consent,
         whatsapp_consent_at = excluded.whatsapp_consent_at,
         whatsapp_consent_by = excluded.whatsapp_consent_by,
         whatsapp_language = excluded.whatsapp_language,
         whatsapp_opted_out = excluded.whatsapp_opted_out,
         whatsapp_number_confirmed = excluded.whatsapp_number_confirmed,
         updated_at = now()`,
      [patient.id, patient.uhid, patient.firstName, patient.lastName, patient.gender, patient.dob, patient.mobile, patient.guardian.rel, patient.guardian.name, patient.address, patient.bloodGroup, patient.allergies, patient.whatsappConsent || false, patient.whatsappConsentAt || null, patient.whatsappConsentBy || null, patient.whatsappLanguage || "en", patient.whatsappOptedOut || false, patient.whatsappNumberConfirmed || false]
    );
    for (const weight of patient.weights || []) {
      await db.query(
        `insert into patient_weight_history (patient_id, recorded_at, weight_kg)
         select $1, $2, $3
         where not exists (
           select 1 from patient_weight_history where patient_id = $1 and recorded_at = $2 and weight_kg = $3
         )`,
        [patient.id, weight.date, weight.w]
      );
    }
  }
}

async function seedVaccines(db) {
  for (const vaccine of seed.vaccines || []) {
    await db.query(
      `insert into vaccines (id, code, name, description, active)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set
         code = excluded.code,
         name = excluded.name,
         description = excluded.description,
         active = excluded.active,
         updated_at = now()`,
      [vaccine.id, vaccine.code, vaccine.name, vaccine.description || "", vaccine.active]
    );
  }
}

async function seedVisitsAndInvoices(db) {
  for (const visit of seed.visits) {
    await db.query(
      `insert into visits
         (id, voucher_no, patient_id, doctor_id, visit_at, status, notes, subtotal, discount, total,
          follow_up_date, follow_up_reason, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'U04', 'U04')
       on conflict (id) do update set
         voucher_no = excluded.voucher_no,
         patient_id = excluded.patient_id,
         doctor_id = excluded.doctor_id,
         visit_at = excluded.visit_at,
         status = excluded.status,
         notes = excluded.notes,
         subtotal = excluded.subtotal,
         discount = excluded.discount,
         total = excluded.total,
         follow_up_date = excluded.follow_up_date,
         follow_up_reason = excluded.follow_up_reason,
         updated_at = now()`,
      [visit.id, visit.voucherNo, visit.patientId, visit.doctorId, visit.date, visit.status, visit.notes, visit.subtotal, visit.discount, visit.total, visit.followUpDate || null, visit.followUpReason || ""]
    );
    if (visit.vitals && Object.keys(visit.vitals).length) {
      await db.query(
        `insert into vitals (visit_id, weight_kg, height_cm, temp_f, pulse, recorded_at, recorded_by)
         select $1, $2, $3, $4, $5, $6, 'U04'
         where not exists (select 1 from vitals where visit_id = $1 and recorded_at = $6)`,
        [visit.id, visit.vitals.wt || null, visit.vitals.ht || null, visit.vitals.temp || null, visit.vitals.pulse || null, visit.date]
      );
    }
    for (const item of visit.items) {
      await db.query(
        `insert into visit_items (visit_id, service_id, name, qty, rate, gst)
         select $1, $2, $3, $4, $5, $6
         where not exists (select 1 from visit_items where visit_id = $1 and service_id = $2 and name = $3)`,
        [visit.id, item.serviceId, item.name, item.qty, item.rate, item.gst || 0]
      );
    }
    for (const rx of visit.prescription || []) {
      await db.query(
        `insert into prescriptions (visit_id, drug_id, name, dose, frequency, days, qty)
         select $1, $2, $3, $4, $5, $6, $7
         where not exists (select 1 from prescriptions where visit_id = $1 and drug_id = $2 and name = $3)`,
        [visit.id, rx.drugId || null, rx.name, rx.dose || "", rx.frequency || "", rx.days || 0, rx.qty || 1]
      );
    }
  }
  for (const invoice of seed.invoices) {
    await db.query(
      `insert into invoices (id, kind, ref_id, voucher_no, party_id, invoice_at, total, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'U04')
       on conflict (id) do update set
         kind = excluded.kind,
         ref_id = excluded.ref_id,
         voucher_no = excluded.voucher_no,
         party_id = excluded.party_id,
         invoice_at = excluded.invoice_at,
         total = excluded.total,
         status = excluded.status`,
      [invoice.id, invoice.kind, invoice.refId, invoice.voucherNo, invoice.partyId || null, invoice.date, invoice.total, invoice.status]
    );
    for (const item of invoice.items || []) {
      await db.query(
        `insert into invoice_items (invoice_id, name, qty, rate, gst)
         select $1, $2, $3, $4, $5
         where not exists (select 1 from invoice_items where invoice_id = $1 and name = $2)`,
        [invoice.id, item.name, item.qty, item.rate, item.gst || 0]
      );
    }
    if (invoice.paid?.cash) await insertPayment(db, invoice.id, "Cash", invoice.paid.cash, invoice.date);
    if (invoice.paid?.upi) await insertPayment(db, invoice.id, "UPI", invoice.paid.upi, invoice.date);
  }
}

async function seedStockMovements(db) {
  for (const movement of seed.stockMovements) {
    await db.query(
      `insert into stock_movements (id, movement_at, kind, ref_id, drug_id, batch_id, qty, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'U04')
       on conflict (id) do update set
         movement_at = excluded.movement_at,
         kind = excluded.kind,
         ref_id = excluded.ref_id,
         drug_id = excluded.drug_id,
         batch_id = excluded.batch_id,
         qty = excluded.qty,
         note = excluded.note`,
      [movement.id, movement.date, movement.kind, movement.refId, movement.drugId, movement.batchId, movement.qty, movement.note]
    );
  }
}

async function insertPayment(db, invoiceId, mode, amount, paidAt) {
  await db.query(
    `insert into payments (invoice_id, mode, amount, paid_at)
     select $1, $2, $3, $4
     where not exists (select 1 from payments where invoice_id = $1 and mode = $2 and amount = $3)`,
    [invoiceId, mode, amount, paidAt]
  );
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}
