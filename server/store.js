import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSeedData } from "./seed.js";
import { generateClinicPdf } from "./pdfDocuments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const backupDir = path.join(rootDir, "backups");
export const dataFile = path.join(dataDir, "clinic.json");

const pad = (n, w = 4) => String(n).padStart(w, "0");
const todayKey = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class ClinicStore {
  constructor(file = dataFile) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      const seed = createSeedData();
      fs.writeFileSync(this.file, JSON.stringify(seed, null, 2));
      return seed;
    }
    const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    const seed = createSeedData();
    data.meta = { ...seed.meta, ...(data.meta || {}) };
    data.sequences = { ...seed.sequences, ...(data.sequences || {}) };
    data.roles ||= {};
    for (const [role, permissions] of Object.entries(seed.roles)) {
      data.roles[role] = [...new Set([...(data.roles[role] || []), ...permissions])];
    }
    for (const key of ["vaccines", "vaccinations", "whatsappOutbox", "reminderJobs", "callbackRequests"]) {
      data[key] ||= structuredClone(seed[key]);
    }
    for (const patient of data.patients || []) {
      patient.whatsappConsent ??= false;
      patient.whatsappConsentAt ??= null;
      patient.whatsappConsentBy ??= null;
      patient.whatsappLanguage ||= "en";
      patient.whatsappOptedOut ??= false;
      patient.whatsappNumberConfirmed ??= false;
    }
    for (const visit of data.visits || []) {
      visit.followUpDate ??= null;
      visit.followUpReason ||= "";
    }
    if (!data.meta.gstin) data.meta.gstin = seed.meta.gstin;
    if (!data.meta.drugLicenseNo20) data.meta.drugLicenseNo20 = seed.meta.drugLicenseNo20;
    if (!data.meta.drugLicenseNo21) data.meta.drugLicenseNo21 = seed.meta.drugLicenseNo21;
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
    return data;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  snapshot() {
    return structuredClone(this.state);
  }

  nextSeq(key) {
    this.state.sequences[key] = (this.state.sequences[key] || 0) + 1;
    return this.state.sequences[key];
  }

  audit(userId, action, entity, entityId, details = {}) {
    const id = `AUD${pad(this.nextSeq("audit"), 6)}`;
    this.state.auditLogs.unshift({ id, at: new Date().toISOString(), userId, action, entity, entityId, details });
  }

  requireUser(userId) {
    const user = this.state.users.find((u) => u.id === userId && u.active);
    if (!user) throw httpError(401, "Unknown or inactive user");
    return user;
  }

  login(input) {
    const userId = required(input.userId, "userId");
    const pin = String(input.pin || "");
    const user = this.state.users.find((u) => u.id === userId && u.active);
    if (!user || String(user.pin || "") !== pin) throw httpError(401, "Invalid account or PIN");
    this.audit(user.id, "LOGIN", "user", user.id, {});
    this.save();
    return { userId: user.id, name: user.name, role: user.role };
  }

  requireAdmin(userId) {
    const user = this.requireUser(userId);
    if (user.role !== "admin") throw httpError(403, "Only admin can change master data");
    return user;
  }

  updateClinicSettings(input, userId = "U04") {
    this.requireAdmin(userId);
    const allowed = [
      "clinicName",
      "clinicSubtitle",
      "address",
      "phone",
      "email",
      "gstin",
      "drugLicenseNo20",
      "drugLicenseNo21",
      "regNo",
      "financialYear"
    ];
    for (const key of allowed) {
      if (input[key] !== undefined) this.state.meta[key] = String(input[key]).trim();
    }
    if (!this.state.meta.clinicName) throw httpError(400, "Clinic name is required");
    if (!/^\d{2}$/.test(this.state.meta.financialYear || "")) throw httpError(400, "Financial year must be two digits, like 26");
    this.audit(userId, "UPDATE", "settings", "clinic", { fields: Object.keys(input).filter((k) => allowed.includes(k)) });
    this.save();
    return this.state.meta;
  }

  addPatient(input, userId = "U04") {
    this.requireUser(userId);
    const seq = this.nextSeq("patient");
    const patient = {
      id: `P${pad(seq, 3)}`,
      uhid: `GCK/${this.state.meta.financialYear}/${pad(seq, 4)}`,
      firstName: required(input.firstName, "firstName"),
      lastName: required(input.lastName, "lastName"),
      gender: input.gender === "F" ? "F" : "M",
      dob: required(input.dob, "dob"),
      mobile: validateMobile(input.mobile),
      guardian: { rel: input.guardianRel || "C/o", name: required(input.guardianName, "guardianName") },
      address: input.address || "",
      bloodGroup: input.bloodGroup || "",
      allergies: input.allergies || "Nil known",
      whatsappConsent: Boolean(input.whatsappConsent),
      whatsappConsentAt: input.whatsappConsent ? new Date().toISOString() : null,
      whatsappConsentBy: input.whatsappConsent ? userId : null,
      whatsappLanguage: input.whatsappLanguage === "te" ? "te" : "en",
      whatsappOptedOut: false,
      whatsappNumberConfirmed: Boolean(input.whatsappNumberConfirmed),
      weights: []
    };
    this.state.patients.unshift(patient);
    this.audit(userId, "CREATE", "patient", patient.id, { uhid: patient.uhid });
    this.save();
    return patient;
  }

  createVisit(input, userId = "U02") {
    this.requireUser(userId);
    const patient = this.state.patients.find((p) => p.id === required(input.patientId, "patientId"));
    if (!patient) throw httpError(404, "Patient not found");
    const doctor = this.state.doctors.find((d) => d.id === required(input.doctorId, "doctorId") && d.active);
    if (!doctor) throw httpError(404, "Doctor not found");
    const items = normalizeServiceItems(this.state, input.items || []);
    const subtotal = money(items.reduce((s, it) => s + it.rate * it.qty, 0));
    const discount = money(input.discount || 0);
    const total = Math.max(0, money(subtotal - discount));
    const paid = normalizePayment(input.payment, total);
    const seq = this.nextSeq("opd");
    const id = `V${pad(10000 + seq, 5)}`;
    const voucherNo = `OPD/${this.state.meta.financialYear}/${pad(seq, 4)}`;
    const visit = {
      id,
      voucherNo,
      patientId: patient.id,
      doctorId: doctor.id,
      date: new Date().toISOString(),
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
    this.state.visits.unshift(visit);
    if (visit.vitals.wt) patient.weights.push({ date: visit.date, w: visit.vitals.wt });
    this.state.invoices.unshift(this.invoiceFrom("OPD", visit, patient.id));
    this.audit(userId, "CREATE", "visit", visit.id, { voucherNo, total });
    this.queueDocument("opd_receipt", visit.id, visit.patientId, userId);
    this.save();
    return visit;
  }

  updateVisitClinical(id, input, userId = "U01") {
    this.requireUser(userId);
    const visit = this.state.visits.find((v) => v.id === id);
    if (!visit) throw httpError(404, "Visit not found");
    visit.status = "done";
    visit.vitals = { ...visit.vitals, ...normalizeVitals(input.vitals || {}) };
    visit.notes = input.notes || "";
    visit.followUpDate = input.followUpDate || null;
    visit.followUpReason = input.followUpReason || "";
    visit.prescription = (input.prescription || []).filter((r) => r.name || r.drugId).map((r) => ({
      drugId: r.drugId || "",
      name: r.name || this.state.drugs.find((d) => d.id === r.drugId)?.name || "",
      dose: r.dose || "",
      frequency: r.frequency || "",
      days: Number(r.days) || 0,
      qty: Number(r.qty) || 1
    }));
    this.audit(userId, "UPDATE", "visit", visit.id, { status: visit.status, rx: visit.prescription.length });
    this.queueDocument("prescription", visit.id, visit.patientId, userId);
    this.scheduleFollowUp(visit, userId);
    this.save();
    return visit;
  }

  createPharmacySale(input, userId = "U03") {
    this.requireUser(userId);
    const items = (input.items || []).map((it) => this.normalizeSaleItem(it));
    if (!items.length) throw httpError(400, "At least one item is required");
    items.forEach((it) => {
      const batch = this.state.drugBatches.find((b) => b.id === it.batchId);
      if (!batch) throw httpError(400, `Batch not found for ${it.name}`);
      if (batch.qty < it.qty) throw httpError(409, `${it.name} ${batch.batch} has only ${batch.qty} units`);
    });
    const total = money(items.reduce((s, it) => s + it.rate * it.qty, 0));
    const paid = normalizePayment(input.payment, total);
    const seq = this.nextSeq("pharmacy");
    const sale = {
      id: `PH${pad(seq, 4)}`,
      voucherNo: `PH/${this.state.meta.financialYear}/${pad(seq, 4)}`,
      date: new Date().toISOString(),
      patientId: input.patientId || null,
      linkedVisitId: input.linkedVisitId || null,
      items,
      paid,
      total,
      status: "paid"
    };
    for (const item of items) {
      const batch = this.state.drugBatches.find((b) => b.id === item.batchId);
      batch.qty -= item.qty;
      this.stockMove("SALE", sale.id, item.drugId, item.batchId, -item.qty, `Sale ${sale.voucherNo}`);
    }
    this.state.pharmacySales.unshift(sale);
    this.state.invoices.unshift(this.invoiceFrom("PHARMACY", sale, sale.patientId));
    this.audit(userId, "CREATE", "pharmacy_sale", sale.id, { voucherNo: sale.voucherNo, total });
    if (sale.patientId) this.queueDocument("pharmacy_invoice", sale.id, sale.patientId, userId);
    this.save();
    return sale;
  }

  createPurchase(input, userId = "U03") {
    this.requireUser(userId);
    const supplier = this.state.suppliers.find((s) => s.id === required(input.supplierId, "supplierId"));
    if (!supplier) throw httpError(404, "Supplier not found");
    const items = input.items || [];
    if (!items.length) throw httpError(400, "At least one purchase item is required");
    const seq = this.nextSeq("purchase");
    const purchase = {
      id: `GRN${pad(seq, 4)}`,
      voucherNo: `GRN/${this.state.meta.financialYear}/${pad(seq, 3)}`,
      date: new Date().toISOString(),
      supplierId: supplier.id,
      invoiceNo: required(input.invoiceNo, "invoiceNo"),
      items: [],
      total: 0
    };
    for (const it of items) {
      const drug = this.state.drugs.find((d) => d.id === required(it.drugId, "drugId"));
      if (!drug) throw httpError(404, "Drug not found");
      const qty = Number(it.qty) || 0;
      if (qty <= 0) throw httpError(400, "Purchase quantity must be positive");
      let batch = this.state.drugBatches.find((b) => b.drugId === drug.id && b.batch === it.batch);
      if (!batch) {
        batch = {
          id: `B${pad(this.state.drugBatches.length + 1, 3)}`,
          drugId: drug.id,
          batch: required(it.batch, "batch"),
          expiry: required(it.expiry, "expiry"),
          qty: 0,
          purchaseRate: money(it.rate),
          mrp: money(it.mrp || drug.mrp)
        };
        this.state.drugBatches.push(batch);
      }
      batch.qty += qty;
      batch.expiry = it.expiry || batch.expiry;
      batch.purchaseRate = money(it.rate || batch.purchaseRate);
      batch.mrp = money(it.mrp || batch.mrp);
      const item = { drugId: drug.id, name: drug.name, batchId: batch.id, batch: batch.batch, expiry: batch.expiry, qty, rate: money(it.rate), gst: Number(it.gst ?? drug.gst) || 0 };
      purchase.items.push(item);
      purchase.total += item.qty * item.rate;
      this.stockMove("PURCHASE", purchase.id, drug.id, batch.id, qty, `Purchase ${purchase.voucherNo}`);
    }
    purchase.total = money(purchase.total);
    this.state.purchases.unshift(purchase);
    this.audit(userId, "CREATE", "purchase", purchase.id, { voucherNo: purchase.voucherNo, total: purchase.total });
    this.save();
    return purchase;
  }

  createReturn(input, userId = "U03") {
    this.requireUser(userId);
    const sale = this.state.pharmacySales.find((s) => s.id === required(input.saleId, "saleId"));
    if (!sale) throw httpError(404, "Sale not found");
    const seq = this.nextSeq("return");
    const ret = {
      id: `RET${pad(seq, 4)}`,
      voucherNo: `RET/${this.state.meta.financialYear}/${pad(seq, 4)}`,
      date: new Date().toISOString(),
      type: "Sales return",
      saleId: sale.id,
      reason: input.reason || "",
      items: [],
      amount: 0
    };
    for (const req of input.items || []) {
      const sold = sale.items.find((it) => it.drugId === req.drugId && it.batchId === req.batchId);
      if (!sold) throw httpError(400, "Return item does not match sale");
      const qty = Number(req.qty) || 0;
      if (qty <= 0 || qty > sold.qty) throw httpError(400, "Invalid return quantity");
      const batch = this.state.drugBatches.find((b) => b.id === sold.batchId);
      batch.qty += qty;
      const item = { ...sold, qty };
      ret.items.push(item);
      ret.amount += item.qty * item.rate;
      this.stockMove("RETURN", ret.id, item.drugId, item.batchId, qty, `Return ${ret.voucherNo}`);
    }
    ret.amount = money(ret.amount);
    this.state.returns.unshift(ret);
    this.audit(userId, "CREATE", "return", ret.id, { voucherNo: ret.voucherNo, amount: ret.amount });
    this.save();
    return ret;
  }

  normalizeSaleItem(it) {
    const drug = this.state.drugs.find((d) => d.id === required(it.drugId, "drugId"));
    if (!drug) throw httpError(404, "Drug not found");
    const batch = this.state.drugBatches.find((b) => b.id === required(it.batchId, "batchId") && b.drugId === drug.id);
    if (!batch) throw httpError(404, "Batch not found");
    const qty = Number(it.qty) || 0;
    if (qty <= 0) throw httpError(400, "Sale quantity must be positive");
    if (!batch.expiry) throw httpError(400, "Expiry is required for stock-tracked sale");
    return { drugId: drug.id, name: drug.name, batchId: batch.id, batch: batch.batch, expiry: batch.expiry, qty, rate: money(it.rate || batch.mrp || drug.mrp), gst: Number(drug.gst) || 0 };
  }

  stockMove(kind, refId, drugId, batchId, qty, note) {
    const id = `SM${pad(this.nextSeq("stock"), 6)}`;
    this.state.stockMovements.unshift({ id, date: new Date().toISOString(), kind, refId, drugId, batchId, qty, note });
  }

  invoiceFrom(kind, record, partyId) {
    return {
      id: `INV${pad(this.nextSeq("invoice"), 5)}`,
      kind,
      refId: record.id,
      voucherNo: record.voucherNo,
      partyId: partyId || null,
      date: record.date,
      items: record.items.map((it) => ({ name: it.name, qty: it.qty, rate: it.rate, gst: it.gst || 0 })),
      paid: record.paid,
      total: record.total,
      status: "paid"
    };
  }

  daybook(date = todayKey()) {
    const rows = this.state.invoices.filter((inv) => todayKey(inv.date) === date);
    const returns = this.state.returns.filter((r) => todayKey(r.date) === date);
    const cash = rows.reduce((s, r) => s + (r.paid?.cash || 0), 0);
    const upi = rows.reduce((s, r) => s + (r.paid?.upi || 0), 0);
    const refund = returns.reduce((s, r) => s + (r.amount || 0), 0);
    return { date, rows, returns, cash: money(cash), upi: money(upi), refund: money(refund), net: money(cash + upi - refund) };
  }

  stockRows() {
    return this.state.drugBatches.map((batch) => {
      const drug = this.state.drugs.find((d) => d.id === batch.drugId);
      const daysToExpiry = Math.ceil((new Date(batch.expiry) - new Date()) / 86400000);
      return { ...batch, drugName: drug?.name || "Unknown", form: drug?.form || "", gst: drug?.gst || 0, reorderLevel: drug?.reorderLevel || 0, daysToExpiry, value: money(batch.qty * batch.purchaseRate) };
    }).sort((a, b) => a.drugName.localeCompare(b.drugName));
  }

  addService(input, userId = "U04") {
    this.requireAdmin(userId);
    const id = input.id || `S${pad(this.state.services.length + 1, 2)}`;
    const code = required(input.code || id, "code").toUpperCase();
    if (this.state.services.some((s) => s.code.toUpperCase() === code)) throw httpError(409, "Service code already exists");
    const service = {
      id,
      code,
      name: required(input.name, "name"),
      category: input.category || "OPD",
      rate: money(input.rate),
      gst: Number(input.gst) || 0,
      active: input.active === false ? false : true
    };
    this.state.services.push(service);
    this.audit(userId, "CREATE", "service", service.id, { code: service.code, rate: service.rate });
    this.save();
    return service;
  }

  addDrug(input, userId = "U04") {
    this.requireAdmin(userId);
    const id = input.id || `DR${pad(this.state.drugs.length + 1, 2)}`;
    const name = required(input.name, "name");
    if (this.state.drugs.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw httpError(409, "Drug already exists");
    const drug = {
      id,
      name,
      form: input.form || "",
      pack: input.pack || "",
      hsn: input.hsn || "",
      mrp: money(input.mrp),
      gst: Number(input.gst) || 0,
      reorderLevel: Number(input.reorderLevel) || 0,
      active: input.active === false ? false : true
    };
    this.state.drugs.push(drug);
    this.audit(userId, "CREATE", "drug", drug.id, { name: drug.name, mrp: drug.mrp });
    this.save();
    return drug;
  }

  addSupplier(input, userId = "U04") {
    this.requireAdmin(userId);
    const id = input.id || `SUP${pad(this.state.suppliers.length + 1, 2)}`;
    const supplier = {
      id,
      name: required(input.name, "name"),
      gstin: input.gstin || "",
      phone: input.phone || "",
      city: input.city || "",
      active: input.active === false ? false : true
    };
    this.state.suppliers.push(supplier);
    this.audit(userId, "CREATE", "supplier", supplier.id, { name: supplier.name });
    this.save();
    return supplier;
  }

  addUser(input, userId = "U04") {
    this.requireAdmin(userId);
    const role = required(input.role, "role");
    if (!this.state.roles[role]) throw httpError(400, "Unknown role");
    const id = input.id || `U${pad(this.state.users.length + 1, 2)}`;
    const user = {
      id,
      name: required(input.name, "name"),
      role,
      pin: String(input.pin || "0000"),
      active: input.active === false ? false : true
    };
    this.state.users.push(user);
    this.audit(userId, "CREATE", "user", user.id, { role: user.role });
    this.save();
    return user;
  }

  addOpeningStock(input, userId = "U04") {
    this.requireAdmin(userId);
    const drug = this.state.drugs.find((d) => d.id === required(input.drugId, "drugId"));
    if (!drug) throw httpError(404, "Drug not found");
    const qty = Number(input.qty) || 0;
    if (qty <= 0) throw httpError(400, "Opening stock qty must be positive");
    let batch = this.state.drugBatches.find((b) => b.drugId === drug.id && b.batch === input.batch);
    if (!batch) {
      batch = {
        id: `B${pad(this.state.drugBatches.length + 1, 3)}`,
        drugId: drug.id,
        batch: required(input.batch, "batch"),
        expiry: required(input.expiry, "expiry"),
        qty: 0,
        purchaseRate: money(input.rate),
        mrp: money(input.mrp || drug.mrp)
      };
      this.state.drugBatches.push(batch);
    }
    batch.qty += qty;
    batch.expiry = input.expiry || batch.expiry;
    batch.purchaseRate = money(input.rate || batch.purchaseRate);
    batch.mrp = money(input.mrp || batch.mrp);
    this.stockMove("OPENING", "manual", drug.id, batch.id, qty, "Manual opening stock");
    this.audit(userId, "CREATE", "opening_stock", batch.id, { drugId: drug.id, batch: batch.batch, qty });
    this.save();
    return batch;
  }

  importCsv(entity, csvText, userId = "U04") {
    this.requireAdmin(userId);
    const rows = parseCsv(csvText);
    const errors = [];
    let imported = 0;
    rows.forEach((row, idx) => {
      try {
        if (entity === "patients") this.addPatient(row, userId);
        else if (entity === "services") this.importService(row);
        else if (entity === "drugs") this.importDrug(row);
        else if (entity === "suppliers") this.importSupplier(row);
        else if (entity === "opening-stock") this.importOpeningStock(row);
        else throw httpError(400, "Unsupported import entity");
        imported += 1;
      } catch (error) {
        errors.push({ row: idx + 2, message: error.message, data: row });
      }
    });
    const job = { id: `IMP${pad(this.nextSeq("importJob"), 4)}`, entity, at: new Date().toISOString(), imported, failed: errors.length, errors };
    this.state.importJobs.unshift(job);
    this.audit(userId, "IMPORT", entity, job.id, { imported, failed: errors.length });
    this.save();
    return job;
  }

  importService(row) {
    const id = row.id || `S${pad(this.state.services.length + 1, 2)}`;
    this.state.services.push({ id, code: row.code || id, name: required(row.name, "name"), category: row.category || "OPD", rate: money(row.rate), gst: Number(row.gst) || 0, active: true });
  }

  importDrug(row) {
    const id = row.id || `DR${pad(this.state.drugs.length + 1, 2)}`;
    this.state.drugs.push({ id, name: required(row.name, "name"), form: row.form || "", pack: row.pack || "", hsn: row.hsn || "", mrp: money(row.mrp), gst: Number(row.gst) || 0, reorderLevel: Number(row.reorderLevel) || 0, active: true });
  }

  importSupplier(row) {
    const id = row.id || `SUP${pad(this.state.suppliers.length + 1, 2)}`;
    this.state.suppliers.push({ id, name: required(row.name, "name"), gstin: row.gstin || "", phone: row.phone || "", city: row.city || "", active: true });
  }

  importOpeningStock(row) {
    const drug = this.state.drugs.find((d) => d.id === row.drugId || d.name.toLowerCase() === String(row.drug || row.name || "").toLowerCase());
    if (!drug) throw httpError(404, "Drug not found");
    let batch = this.state.drugBatches.find((b) => b.drugId === drug.id && b.batch === row.batch);
    if (!batch) {
      batch = { id: `B${pad(this.state.drugBatches.length + 1, 3)}`, drugId: drug.id, batch: required(row.batch, "batch"), expiry: required(row.expiry, "expiry"), qty: 0, purchaseRate: money(row.rate), mrp: money(row.mrp || drug.mrp) };
      this.state.drugBatches.push(batch);
    }
    const qty = Number(row.qty) || 0;
    if (qty <= 0) throw httpError(400, "Opening stock qty must be positive");
    batch.qty += qty;
    this.stockMove("OPENING", "import", drug.id, batch.id, qty, "Opening stock import");
  }

  updatePatientWhatsApp(patientId, input, userId = "U02") {
    this.requireUser(userId);
    const patient = this.state.patients.find((row) => row.id === patientId);
    if (!patient) throw httpError(404, "Patient not found");
    patient.whatsappConsent = Boolean(input.whatsappConsent);
    patient.whatsappConsentAt = patient.whatsappConsent ? patient.whatsappConsentAt || new Date().toISOString() : null;
    patient.whatsappConsentBy = patient.whatsappConsent ? userId : null;
    patient.whatsappLanguage = input.whatsappLanguage === "te" ? "te" : "en";
    patient.whatsappNumberConfirmed = Boolean(input.whatsappNumberConfirmed);
    if (patient.whatsappConsent && patient.whatsappNumberConfirmed && !patient.whatsappOptedOut) {
      for (const message of this.state.whatsappOutbox.filter((row) => row.patientId === patientId && row.status === "blocked_no_consent")) {
        message.status = "queued";
        message.scheduledFor = new Date().toISOString();
        message.updatedAt = new Date().toISOString();
      }
    }
    this.audit(userId, "UPDATE", "patient_whatsapp", patientId, {
      consent: patient.whatsappConsent,
      language: patient.whatsappLanguage,
      confirmed: patient.whatsappNumberConfirmed
    });
    this.save();
    return patient;
  }

  addVaccine(input, userId = "U04") {
    this.requireAdmin(userId);
    const vaccine = {
      id: input.id || `VAC${pad(this.nextSeq("vaccine"), 3)}`,
      code: required(input.code, "code").toUpperCase(),
      name: required(input.name, "name"),
      description: input.description || "",
      active: input.active === false ? false : true
    };
    if (this.state.vaccines.some((row) => row.code === vaccine.code)) throw httpError(409, "Vaccine code already exists");
    this.state.vaccines.push(vaccine);
    this.audit(userId, "CREATE", "vaccine", vaccine.id, { code: vaccine.code });
    this.save();
    return vaccine;
  }

  recordVaccination(input, userId = "U01") {
    this.requireUser(userId);
    const patient = this.state.patients.find((row) => row.id === required(input.patientId, "patientId"));
    if (!patient) throw httpError(404, "Patient not found");
    const vaccine = this.state.vaccines.find((row) => row.id === required(input.vaccineId, "vaccineId") && row.active);
    if (!vaccine) throw httpError(404, "Vaccine not found");
    if (input.nextVaccineId && !this.state.vaccines.some((row) => row.id === input.nextVaccineId && row.active)) throw httpError(404, "Next vaccine not found");
    const vaccination = {
      id: `VX${pad(this.nextSeq("vaccination"), 6)}`,
      patientId: patient.id,
      vaccineId: vaccine.id,
      administeredAt: input.administeredAt || todayKey(),
      batchNo: input.batchNo || "",
      administeredBy: userId,
      nextVaccineId: input.nextVaccineId || null,
      nextDueDate: input.nextDueDate || null,
      notes: input.notes || ""
    };
    this.state.vaccinations.unshift(vaccination);
    if (vaccination.nextDueDate && vaccination.nextVaccineId) {
      for (const offsetDays of [7, 1]) this.insertReminder("vaccine", "vaccination", vaccination.id, patient.id, vaccination.nextDueDate, offsetDays);
    }
    this.audit(userId, "CREATE", "vaccination", vaccination.id, { patientId: patient.id, vaccineId: vaccine.id, nextDueDate: vaccination.nextDueDate });
    this.save();
    return vaccination;
  }

  queueDocument(documentKind, refId, patientId, userId) {
    const patient = this.state.patients.find((row) => row.id === patientId);
    if (!patient) return null;
    const idempotencyKey = `document:${documentKind}:${refId}:v1`;
    const existing = this.state.whatsappOutbox.find((row) => row.idempotencyKey === idempotencyKey);
    if (existing) return existing;
    const message = {
      id: `WA${pad(this.nextSeq("whatsapp"), 6)}`,
      patientId,
      phone: patient.mobile,
      language: patient.whatsappLanguage || "en",
      kind: "document",
      templateName: "charaka_document",
      refType: documentKind === "pharmacy_invoice" ? "pharmacy_sale" : "visit",
      refId,
      documentKind,
      idempotencyKey,
      payload: { documentKind, refId },
      scheduledFor: new Date().toISOString(),
      status: localMessageStatus(patient),
      attempts: 0,
      externalId: null,
      lastError: "",
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.state.whatsappOutbox.unshift(message);
    return message;
  }

  scheduleFollowUp(visit, userId) {
    this.state.reminderJobs = this.state.reminderJobs.filter((row) => !(row.refType === "visit" && row.refId === visit.id && row.kind === "followup" && row.status === "pending"));
    if (!visit.followUpDate) return [];
    const reminder = this.insertReminder("followup", "visit", visit.id, visit.patientId, visit.followUpDate, 1);
    this.audit(userId, "CREATE", "reminder_job", reminder.id, { kind: "followup", dueDate: visit.followUpDate, offsetDays: 1 });
    return [reminder];
  }

  insertReminder(kind, refType, refId, patientId, dueDate, offsetDays) {
    const key = `schedule:${kind}:${refId}:${offsetDays}:${dueDate}`;
    const existing = this.state.reminderJobs.find((row) => row.idempotencyKey === key);
    if (existing) return existing;
    const reminder = {
      id: `REM${pad(this.nextSeq("reminder"), 6)}`,
      patientId,
      kind,
      refType,
      refId,
      dueDate,
      remindAt: reminderDate(dueDate, offsetDays),
      offsetDays,
      status: "pending",
      outboxId: null,
      idempotencyKey: key,
      createdAt: new Date().toISOString()
    };
    this.state.reminderJobs.push(reminder);
    return reminder;
  }

  processDueReminders() {
    const now = Date.now();
    const queued = [];
    for (const reminder of this.state.reminderJobs.filter((row) => row.status === "pending" && new Date(row.remindAt).getTime() <= now)) {
      const patient = this.state.patients.find((row) => row.id === reminder.patientId);
      const existing = this.state.whatsappOutbox.find((row) => row.idempotencyKey === `reminder:${reminder.kind}:${reminder.refId}:${reminder.offsetDays}`);
      const message = existing || {
        id: `WA${pad(this.nextSeq("whatsapp"), 6)}`,
        patientId: patient.id,
        phone: patient.mobile,
        language: patient.whatsappLanguage || "en",
        kind: reminder.kind === "followup" ? "followup_reminder" : "vaccine_reminder",
        templateName: reminder.kind === "followup" ? "charaka_followup_reminder" : "charaka_vaccine_reminder",
        refType: reminder.refType,
        refId: reminder.refId,
        documentKind: null,
        idempotencyKey: `reminder:${reminder.kind}:${reminder.refId}:${reminder.offsetDays}`,
        payload: { dueDate: reminder.dueDate, offsetDays: reminder.offsetDays },
        scheduledFor: new Date().toISOString(),
        status: localMessageStatus(patient),
        attempts: 0,
        externalId: null,
        lastError: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (!existing) this.state.whatsappOutbox.unshift(message);
      reminder.outboxId = message.id;
      reminder.status = message.status === "queued" ? "queued" : "failed";
      queued.push(message);
    }
    if (queued.length) this.save();
    return queued;
  }

  resendWhatsApp(id, userId = "U04") {
    this.requireUser(userId);
    const source = this.state.whatsappOutbox.find((row) => row.id === id);
    if (!source) throw httpError(404, "WhatsApp message not found");
    const patient = this.state.patients.find((row) => row.id === source.patientId);
    const seq = this.nextSeq("whatsapp");
    const message = {
      ...structuredClone(source),
      id: `WA${pad(seq, 6)}`,
      idempotencyKey: `${source.idempotencyKey}:resend:${seq}`,
      status: localMessageStatus(patient),
      attempts: 0,
      externalId: null,
      lastError: "",
      payload: { ...(source.payload || {}), resendOf: source.id },
      scheduledFor: new Date().toISOString(),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.state.whatsappOutbox.unshift(message);
    this.save();
    return message;
  }

  closeCallback(id, userId = "U02") {
    this.requireUser(userId);
    const callback = this.state.callbackRequests.find((row) => row.id === id);
    if (!callback) throw httpError(404, "Callback request not found");
    callback.status = "closed";
    callback.handledBy = userId;
    callback.handledAt = new Date().toISOString();
    this.audit(userId, "UPDATE", "callback_request", id, { status: "closed" });
    this.save();
    return callback;
  }

  async whatsappDocument(id) {
    const message = this.state.whatsappOutbox.find((row) => row.id === id);
    if (!message?.documentKind) throw httpError(404, "WhatsApp document not found");
    const record = message.documentKind === "pharmacy_invoice"
      ? this.state.pharmacySales.find((row) => row.id === message.refId)
      : this.state.visits.find((row) => row.id === message.refId);
    const patient = this.state.patients.find((row) => row.id === message.patientId);
    return generateClinicPdf({ kind: message.documentKind, record, patient, meta: this.state.meta, drugs: this.state.drugs });
  }

  backup() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupDir, `clinic-${stamp}.json`);
    fs.copyFileSync(this.file, file);
    return { file, createdAt: new Date().toISOString() };
  }
}

function normalizeServiceItems(state, items) {
  const out = (items.length ? items : [{ serviceId: "S01", qty: 1 }]).map((it) => {
    const service = state.services.find((s) => s.id === it.serviceId && s.active);
    if (!service) throw httpError(404, "Service not found");
    const qty = Number(it.qty) || 1;
    return { serviceId: service.id, name: service.name, rate: money(service.rate), qty };
  });
  return out;
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

function localMessageStatus(patient) {
  if (patient?.whatsappOptedOut) return "opted_out";
  if (!patient?.whatsappConsent || !patient?.whatsappNumberConfirmed) return "blocked_no_consent";
  return "queued";
}

function reminderDate(dueDate, offsetDays) {
  const date = new Date(`${dueDate}T09:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() - Number(offsetDays));
  return date.toISOString();
}

export function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const helpers = { todayKey, money };
