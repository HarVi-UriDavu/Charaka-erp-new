import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTransaction } from "./db.js";
import { PgClinicalStore } from "./pgClinicalStore.js";
import { PgPharmacyStore } from "./pgPharmacyStore.js";
import { PgReceptionStore } from "./pgReceptionStore.js";
import { PgReportsStore } from "./pgReportsStore.js";
import { PgSystemStore, hashPin } from "./pgSystemStore.js";
import { httpError, parseCsv } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backups");

const pad = (n, w = 4) => String(n).padStart(w, "0");
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class PgAppStore {
  constructor(db) {
    this.db = db;
    this.system = new PgSystemStore(db);
    this.reception = new PgReceptionStore(db, this.system);
    this.clinical = new PgClinicalStore(db, this.system);
    this.pharmacy = new PgPharmacyStore(db, this.system);
    this.reports = new PgReportsStore(db, this.system);
  }

  login(input) {
    return this.system.login(input);
  }

  addPatient(input, userId) {
    return this.reception.addPatient(input, userId);
  }

  createVisit(input, userId) {
    return this.reception.createVisit(input, userId);
  }

  updateVisitClinical(id, input, userId) {
    return this.clinical.updateVisitClinical(id, input, userId);
  }

  createPharmacySale(input, userId) {
    return this.pharmacy.createPharmacySale(input, userId);
  }

  createPurchase(input, userId) {
    return this.pharmacy.createPurchase(input, userId);
  }

  createReturn(input, userId) {
    return this.pharmacy.createReturn(input, userId);
  }

  updateClinicSettings(input, userId) {
    return this.system.updateClinicSettings(input, userId);
  }

  stockRows() {
    return this.reports.stockRows();
  }

  daybook(date) {
    return this.reports.daybook(date);
  }

  async snapshot() {
    const [system, patients, doctors, services, suppliers, drugs, drugBatches, visits, invoices, pharmacySales, purchases, returns, stockMovements, importJobs, auditLogs] = await Promise.all([
      this.system.snapshotSystem(),
      this.patients(),
      this.doctors(),
      this.services(),
      this.suppliers(),
      this.drugs(),
      this.drugBatches(),
      this.visits(),
      this.invoices(),
      this.pharmacySales(),
      this.purchases(),
      this.returns(),
      this.stockMovements(),
      this.importJobs(),
      this.reports.auditLogs(50)
    ]);
    return {
      ...system,
      patients,
      doctors,
      services,
      suppliers,
      drugs,
      drugBatches,
      visits,
      invoices,
      pharmacySales,
      purchases,
      returns,
      stockMovements,
      importJobs,
      auditLogs
    };
  }

  async patients() {
    const [patients, weights] = await Promise.all([
      this.db.query(
        `select id, uhid, first_name as "firstName", last_name as "lastName", gender, dob, mobile,
                guardian_rel as "guardianRel", guardian_name as "guardianName", address, blood_group as "bloodGroup", allergies
         from patients
         where active = true
         order by created_at desc, id desc`
      ),
      this.db.query(
        `select patient_id as "patientId", recorded_at as date, weight_kg as w
         from patient_weight_history
         order by recorded_at`
      )
    ]);
    const byPatient = groupBy(weights.rows, "patientId");
    return patients.rows.map((row) => ({
      id: row.id,
      uhid: row.uhid,
      firstName: row.firstName,
      lastName: row.lastName,
      gender: row.gender,
      dob: dateOnly(row.dob),
      mobile: row.mobile,
      guardian: { rel: row.guardianRel, name: row.guardianName },
      address: row.address,
      bloodGroup: row.bloodGroup,
      allergies: row.allergies,
      weights: (byPatient[row.id] || []).map((w) => ({ date: w.date, w: Number(w.w) }))
    }));
  }

  async doctors() {
    const result = await this.db.query(
      `select id, name, qualification, reg_no as "regNo", consult_fee as "consultFee",
              follow_up_fee as "followUpFee", active
       from doctors
       order by id`
    );
    return result.rows.map((row) => ({ ...row, consultFee: money(row.consultFee), followUpFee: money(row.followUpFee) }));
  }

  async services() {
    const result = await this.db.query(
      `select id, code, name, category, rate, gst, active
       from services
       order by code, id`
    );
    return result.rows.map((row) => ({ ...row, rate: money(row.rate), gst: Number(row.gst) || 0 }));
  }

  async suppliers() {
    const result = await this.db.query(
      `select id, name, gstin, phone, city, active
       from suppliers
       order by name, id`
    );
    return result.rows;
  }

  async drugs() {
    const result = await this.db.query(
      `select id, name, form, pack, hsn, mrp, gst, reorder_level as "reorderLevel", active
       from drugs
       order by name, id`
    );
    return result.rows.map((row) => ({ ...row, mrp: money(row.mrp), gst: Number(row.gst) || 0, reorderLevel: Number(row.reorderLevel) || 0 }));
  }

  async drugBatches() {
    const result = await this.db.query(
      `select id, drug_id as "drugId", batch, expiry, qty, purchase_rate as "purchaseRate", mrp
       from drug_batches
       order by expiry, id`
    );
    return result.rows.map((row) => ({ ...row, expiry: dateOnly(row.expiry), qty: Number(row.qty) || 0, purchaseRate: money(row.purchaseRate), mrp: money(row.mrp) }));
  }

  async visits() {
    const [visits, vitals, items, prescriptions] = await Promise.all([
      this.db.query(
        `select id, voucher_no as "voucherNo", patient_id as "patientId", doctor_id as "doctorId",
                visit_at as date, status, notes, subtotal, discount, total
         from visits
         order by visit_at desc`
      ),
      this.db.query(
        `select visit_id as "visitId", weight_kg as wt, height_cm as ht, temp_f as temp, pulse, recorded_at as "recordedAt"
         from vitals
         order by recorded_at desc`
      ),
      this.db.query(
        `select visit_id as "visitId", service_id as "serviceId", name, qty, rate, gst
         from visit_items
         order by id`
      ),
      this.db.query(
        `select visit_id as "visitId", drug_id as "drugId", name, dose, frequency, days, qty, notes
         from prescriptions
         order by id`
      )
    ]);
    const vitalsByVisit = groupBy(vitals.rows, "visitId");
    const itemsByVisit = groupBy(items.rows, "visitId");
    const rxByVisit = groupBy(prescriptions.rows, "visitId");
    const invoiceByVisit = Object.fromEntries((await this.invoices()).filter((i) => i.kind === "OPD").map((invoice) => [invoice.refId, invoice]));
    return visits.rows.map((row) => {
      const latestVitals = vitalsByVisit[row.id]?.[0] || {};
      return {
        ...row,
        subtotal: money(row.subtotal),
        discount: money(row.discount),
        total: money(row.total),
        vitals: compactVitals(latestVitals),
        items: (itemsByVisit[row.id] || []).map(mapLineItem),
        paid: invoiceByVisit[row.id]?.paid || { mode: "Cash", cash: 0, upi: 0 },
        prescription: (rxByVisit[row.id] || []).map((rx) => ({
          drugId: rx.drugId || "",
          name: rx.name,
          dose: rx.dose || "",
          frequency: rx.frequency || "",
          days: Number(rx.days) || 0,
          qty: Number(rx.qty) || 1,
          notes: rx.notes || ""
        }))
      };
    });
  }

  async invoices() {
    const [invoices, items] = await Promise.all([
      this.db.query(
        `select i.id,
                i.kind,
                i.ref_id as "refId",
                i.voucher_no as "voucherNo",
                i.party_id as "partyId",
                i.invoice_at as date,
                i.total,
                i.status,
                coalesce(sum(p.amount) filter (where p.mode = 'Cash'), 0) as cash,
                coalesce(sum(p.amount) filter (where p.mode = 'UPI'), 0) as upi
         from invoices i
         left join payments p on p.invoice_id = i.id
         group by i.id
         order by i.invoice_at desc`
      ),
      this.db.query(
        `select invoice_id as "invoiceId", name, qty, rate, gst
         from invoice_items
         order by id`
      )
    ]);
    const itemsByInvoice = groupBy(items.rows, "invoiceId");
    return invoices.rows.map((row) => ({
      ...row,
      total: money(row.total),
      items: (itemsByInvoice[row.id] || []).map(mapLineItem),
      paid: paid(row.cash, row.upi)
    }));
  }

  async pharmacySales() {
    const [sales, items, invoices] = await Promise.all([
      this.db.query(
        `select id, voucher_no as "voucherNo", patient_id as "patientId", linked_visit_id as "linkedVisitId",
                sale_at as date, total, status
         from pharmacy_sales
         order by sale_at desc`
      ),
      this.db.query(
        `select sale_id as "saleId", drug_id as "drugId", batch_id as "batchId", name, qty, rate, gst
         from sale_items
         order by id`
      ),
      this.invoices()
    ]);
    const itemsBySale = groupBy(items.rows, "saleId");
    const invoiceBySale = Object.fromEntries(invoices.filter((i) => i.kind === "PHARMACY").map((invoice) => [invoice.refId, invoice]));
    return sales.rows.map((row) => ({ ...row, total: money(row.total), items: (itemsBySale[row.id] || []).map(mapSaleItem), paid: invoiceBySale[row.id]?.paid || { mode: "Cash", cash: 0, upi: 0 } }));
  }

  async purchases() {
    const [purchases, items] = await Promise.all([
      this.db.query(
        `select id, voucher_no as "voucherNo", supplier_id as "supplierId", invoice_no as "invoiceNo",
                purchase_at as date, total, status
         from purchases
         order by purchase_at desc`
      ),
      this.db.query(
        `select purchase_id as "purchaseId", drug_id as "drugId", batch_id as "batchId", qty, rate, gst, mrp
         from purchase_items
         order by id`
      )
    ]);
    const itemsByPurchase = groupBy(items.rows, "purchaseId");
    return purchases.rows.map((row) => ({ ...row, total: money(row.total), items: (itemsByPurchase[row.id] || []).map(mapPurchaseItem) }));
  }

  async returns() {
    const [returns, items] = await Promise.all([
      this.db.query(
        `select id, voucher_no as "voucherNo", sale_id as "saleId", reason, return_at as date, amount, status
         from sales_returns
         order by return_at desc`
      ),
      this.db.query(
        `select return_id as "returnId", drug_id as "drugId", batch_id as "batchId", qty, rate, gst
         from return_items
         order by id`
      )
    ]);
    const itemsByReturn = groupBy(items.rows, "returnId");
    return returns.rows.map((row) => ({ ...row, type: "Sales return", amount: money(row.amount), items: (itemsByReturn[row.id] || []).map(mapPurchaseItem) }));
  }

  async stockMovements() {
    const result = await this.db.query(
      `select id, movement_at as date, kind, ref_id as "refId", drug_id as "drugId", batch_id as "batchId", qty, note
       from stock_movements
       order by movement_at desc
       limit 500`
    );
    return result.rows.map((row) => ({ ...row, qty: Number(row.qty) || 0 }));
  }

  async importJobs() {
    const result = await this.db.query(
      `select id, entity, imported, failed, errors, created_at as at
       from import_jobs
       order by created_at desc
       limit 50`
    );
    return result.rows;
  }

  async addService(input, userId = "U04") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireAdmin(userId);
      const id = input.id || `S${pad(await countRows(db, "services") + 1, 2)}`;
      const code = required(input.code || id, "code").toUpperCase();
      const service = {
        id,
        code,
        name: required(input.name, "name"),
        category: input.category || "OPD",
        rate: money(input.rate),
        gst: Number(input.gst) || 0,
        active: input.active === false ? false : true
      };
      await db.query(
        `insert into services (id, code, name, category, rate, gst, active)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [service.id, service.code, service.name, service.category, service.rate, service.gst, service.active]
      );
      await system.audit(userId, "CREATE", "service", service.id, { code: service.code, rate: service.rate });
      return service;
    });
  }

  async addDrug(input, userId = "U04") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireAdmin(userId);
      const drug = {
        id: input.id || `DR${pad(await countRows(db, "drugs") + 1, 2)}`,
        name: required(input.name, "name"),
        form: input.form || "",
        pack: input.pack || "",
        hsn: input.hsn || "",
        mrp: money(input.mrp),
        gst: Number(input.gst) || 0,
        reorderLevel: Number(input.reorderLevel) || 0,
        active: input.active === false ? false : true
      };
      await db.query(
        `insert into drugs (id, name, form, pack, hsn, mrp, gst, reorder_level, active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [drug.id, drug.name, drug.form, drug.pack, drug.hsn, drug.mrp, drug.gst, drug.reorderLevel, drug.active]
      );
      await system.audit(userId, "CREATE", "drug", drug.id, { name: drug.name, mrp: drug.mrp });
      return drug;
    });
  }

  async addSupplier(input, userId = "U04") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireAdmin(userId);
      const supplier = {
        id: input.id || `SUP${pad(await countRows(db, "suppliers") + 1, 2)}`,
        name: required(input.name, "name"),
        gstin: input.gstin || "",
        phone: input.phone || "",
        city: input.city || "",
        active: input.active === false ? false : true
      };
      await db.query(
        `insert into suppliers (id, name, gstin, phone, city, active)
         values ($1, $2, $3, $4, $5, $6)`,
        [supplier.id, supplier.name, supplier.gstin, supplier.phone, supplier.city, supplier.active]
      );
      await system.audit(userId, "CREATE", "supplier", supplier.id, { name: supplier.name });
      return supplier;
    });
  }

  async addUser(input, userId = "U04") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireAdmin(userId);
      const role = required(input.role, "role");
      const hasRole = await db.query(`select id from roles where id = $1`, [role]);
      if (!hasRole.rows[0]) throw httpError(400, "Unknown role");
      const user = {
        id: input.id || `U${pad(await countRows(db, "users") + 1, 2)}`,
        name: required(input.name, "name"),
        role,
        active: input.active === false ? false : true
      };
      await db.query(
        `insert into users (id, name, role_id, pin_hash, active)
         values ($1, $2, $3, $4, $5)`,
        [user.id, user.name, user.role, hashPin(input.pin || "0000"), user.active]
      );
      await system.audit(userId, "CREATE", "user", user.id, { role: user.role });
      return user;
    });
  }

  async addOpeningStock(input, userId = "U04") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireAdmin(userId);
      const drug = await getDrug(db, required(input.drugId, "drugId"));
      const qty = Number(input.qty) || 0;
      if (qty <= 0) throw httpError(400, "Opening stock qty must be positive");
      const batch = await upsertBatch(db, drug, input);
      await db.query(`update drug_batches set qty = qty + $2, updated_at = now() where id = $1`, [batch.id, qty]);
      await stockMove(db, system, userId, "OPENING", "manual", drug.id, batch.id, qty, "Manual opening stock");
      await system.audit(userId, "CREATE", "opening_stock", batch.id, { drugId: drug.id, batch: batch.batch, qty });
      return { id: batch.id, drugId: drug.id, batch: batch.batch, expiry: dateOnly(input.expiry || batch.expiry), qty: Number(batch.qty || 0) + qty, purchaseRate: money(input.rate || batch.purchase_rate), mrp: money(input.mrp || batch.mrp) };
    });
  }

  async importCsv(entity, csvText, userId = "U04") {
    await this.system.requireAdmin(userId);
    const rows = parseCsv(csvText);
    const errors = [];
    let imported = 0;
    for (const [idx, row] of rows.entries()) {
      try {
        if (entity === "patients") await this.addPatient(row, userId);
        else if (entity === "services") await this.addService(row, userId);
        else if (entity === "drugs") await this.addDrug(row, userId);
        else if (entity === "suppliers") await this.addSupplier(row, userId);
        else if (entity === "opening-stock") await this.addOpeningStock(row, userId);
        else throw httpError(400, "Unsupported import entity");
        imported += 1;
      } catch (error) {
        errors.push({ row: idx + 2, message: error.message, data: row });
      }
    }
    return this.reports.recordImportJob(entity, imported, errors, userId);
  }

  async backup(userId = "U04") {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `clinic-postgres-snapshot-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify(await this.snapshot(), null, 2));
    return this.reports.recordBackupJob(file, userId, { format: "json-snapshot" });
  }
}

async function runInTransaction(db, work) {
  if (typeof db.connect === "function") return withTransaction(db, work);
  return work(db);
}

async function countRows(db, table) {
  const allowed = new Set(["services", "drugs", "suppliers", "users", "drug_batches"]);
  if (!allowed.has(table)) throw new Error("Unsupported count table");
  const result = await db.query(`select count(*)::int as count from ${table}`);
  return Number(result.rows[0]?.count || 0);
}

async function getDrug(db, id) {
  const result = await db.query(`select * from drugs where id = $1 and active = true`, [id]);
  const drug = result.rows[0];
  if (!drug) throw httpError(404, "Drug not found");
  return drug;
}

async function upsertBatch(db, drug, input) {
  const batchCode = required(input.batch, "batch");
  const existing = await db.query(`select * from drug_batches where drug_id = $1 and batch = $2`, [drug.id, batchCode]);
  if (existing.rows[0]) {
    const batch = existing.rows[0];
    await db.query(
      `update drug_batches
       set expiry = $2, purchase_rate = $3, mrp = $4, updated_at = now()
       where id = $1`,
      [batch.id, input.expiry || batch.expiry, money(input.rate || batch.purchase_rate), money(input.mrp || batch.mrp)]
    );
    return batch;
  }
  const id = `B${pad(await countRows(db, "drug_batches") + 1, 3)}`;
  const batch = { id, drug_id: drug.id, batch: batchCode, expiry: required(input.expiry, "expiry"), qty: 0, purchase_rate: money(input.rate), mrp: money(input.mrp || drug.mrp) };
  await db.query(
    `insert into drug_batches (id, drug_id, batch, expiry, qty, purchase_rate, mrp)
     values ($1, $2, $3, $4, 0, $5, $6)`,
    [batch.id, batch.drug_id, batch.batch, batch.expiry, batch.purchase_rate, batch.mrp]
  );
  return batch;
}

async function stockMove(db, system, userId, kind, refId, drugId, batchId, qty, note) {
  const id = `SM${pad(await system.nextSeq("stock"), 6)}`;
  await db.query(
    `insert into stock_movements (id, kind, ref_id, drug_id, batch_id, qty, note, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, kind, refId, drugId, batchId, qty, note, userId]
  );
  return id;
}

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    groups[row[key]] ||= [];
    groups[row[key]].push(row);
    return groups;
  }, {});
}

function mapLineItem(row) {
  return { serviceId: row.serviceId || "", name: row.name, qty: Number(row.qty) || 0, rate: money(row.rate), gst: Number(row.gst) || 0 };
}

function mapSaleItem(row) {
  return { drugId: row.drugId, batchId: row.batchId, name: row.name, qty: Number(row.qty) || 0, rate: money(row.rate), gst: Number(row.gst) || 0 };
}

function mapPurchaseItem(row) {
  return { drugId: row.drugId, batchId: row.batchId, qty: Number(row.qty) || 0, rate: money(row.rate), gst: Number(row.gst) || 0, mrp: money(row.mrp) };
}

function compactVitals(row) {
  const out = {};
  if (row.wt !== undefined && row.wt !== null) out.wt = Number(row.wt);
  if (row.ht !== undefined && row.ht !== null) out.ht = Number(row.ht);
  if (row.temp !== undefined && row.temp !== null) out.temp = Number(row.temp);
  if (row.pulse !== undefined && row.pulse !== null) out.pulse = Number(row.pulse);
  return out;
}

function paid(cash, upi) {
  const c = money(cash);
  const u = money(upi);
  return { mode: c > 0 && u > 0 ? "Mixed" : c > 0 ? "Cash" : "UPI", cash: c, upi: u };
}

function dateOnly(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") throw httpError(400, `${field} is required`);
  return String(value).trim();
}
