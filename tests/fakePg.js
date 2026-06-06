import { hashPin } from "../server/pgSystemStore.js";

export function fakePgState(overrides = {}) {
  return {
    settings: {
      clinicName: "Charaka Test",
      financialYear: "26",
      gstin: "37AHDPT3692H1ZW"
    },
    sequences: { audit: 1, patient: 240, opd: 25, invoice: 200 },
    users: [
      { id: "U01", name: "Doctor", role: "doctor", pin_hash: hashPin("1111"), active: true },
      { id: "U02", name: "Reception", role: "reception", pin_hash: hashPin("2222"), active: true },
      { id: "U04", name: "Admin", role: "admin", pin_hash: hashPin("4444"), active: true }
    ],
    rolePermissions: [
      { role_id: "admin", permission_id: "settings" },
      { role_id: "admin", permission_id: "masters" },
      { role_id: "reception", permission_id: "reception" },
      { role_id: "doctor", permission_id: "clinical" }
    ],
    doctors: [
      { id: "D01", name: "Dr. Test", active: true }
    ],
    suppliers: [
      { id: "SUP01", name: "Test Supplier", active: true }
    ],
    patients: [
      {
        id: "P001",
        uhid: "GCK/26/0001",
        first_name: "Aarav",
        last_name: "Kumar",
        gender: "M",
        dob: "2020-08-14",
        mobile: "9876543210",
        guardian_rel: "S/o",
        guardian_name: "Suresh Kumar",
        address: "Guntur",
        blood_group: "O+",
        allergies: "Nil known"
      }
    ],
    patientWeights: [],
    services: [
      { id: "S01", name: "Consultation", rate: 400, gst: 0, active: true }
    ],
    drugs: [
      { id: "DR01", name: "Paracetamol Syrup", mrp: 48, gst: 12, active: true },
      { id: "DR02", name: "Amoxicillin 250 Syrup", mrp: 88, gst: 12, active: true }
    ],
    drugBatches: [
      { id: "B001", drug_id: "DR01", batch: "PCS2410", expiry: "2027-01-10", qty: 38, purchase_rate: 38, mrp: 48 },
      { id: "B002", drug_id: "DR02", batch: "AMX2503", expiry: "2026-09-08", qty: 14, purchase_rate: 66, mrp: 88 }
    ],
    visits: [],
    vitals: [],
    prescriptions: [],
    visitItems: [],
    invoices: [],
    invoiceItems: [],
    payments: [],
    purchases: [],
    purchaseItems: [],
    pharmacySales: [],
    saleItems: [],
    salesReturns: [],
    returnItems: [],
    stockMovements: [],
    auditLogs: [],
    ...overrides
  };
}

export function fakeDb(state = fakePgState()) {
  return {
    state,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("insert into sequences")) {
        const key = params[0];
        state.sequences[key] = (state.sequences[key] || 0) + 1;
        return { rows: [{ value: state.sequences[key] }] };
      }
      if (text.startsWith("insert into audit_logs")) {
        state.auditLogs.push({ id: params[0], userId: params[1], action: params[2], entity: params[3], entityId: params[4], details: JSON.parse(params[5]) });
        return { rows: [] };
      }
      if (text.includes("from users") && text.includes("pin_hash")) {
        return { rows: state.users.filter((u) => u.id === params[0] && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role, pin_hash: u.pin_hash })) };
      }
      if (text.includes("from users") && text.includes("where id = $1")) {
        return { rows: state.users.filter((u) => u.id === params[0] && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })) };
      }
      if (text.includes("from users") && text.includes("order by id")) {
        return { rows: state.users.map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })) };
      }
      if (text.includes("from role_permissions")) return { rows: state.rolePermissions };
      if (text.includes("from app_settings")) return { rows: [{ value: state.settings }] };
      if (text.startsWith("insert into app_settings")) {
        state.settings = JSON.parse(params[0]);
        return { rows: [] };
      }
      if (text.includes("from patients") && text.includes("where id = $1")) {
        return { rows: state.patients.filter((p) => p.id === params[0]) };
      }
      if (text.startsWith("insert into patients")) {
        const patient = {
          id: params[0],
          uhid: params[1],
          first_name: params[2],
          last_name: params[3],
          gender: params[4],
          dob: params[5],
          mobile: params[6],
          guardian_rel: params[7],
          guardian_name: params[8],
          address: params[9],
          blood_group: params[10],
          allergies: params[11]
        };
        state.patients.unshift(patient);
        return { rows: [patient] };
      }
      if (text.includes("from doctors")) return { rows: state.doctors.filter((d) => d.id === params[0] && d.active) };
      if (text.includes("from services")) return { rows: state.services.filter((s) => params[0].includes(s.id) && s.active) };
      if (text.includes("from suppliers")) return { rows: state.suppliers.filter((s) => s.id === params[0] && s.active) };
      if (text.includes("from drugs") && text.includes("active = true")) return { rows: state.drugs.filter((d) => d.id === params[0] && d.active) };
      if (text.includes("from drug_batches") && text.includes("drug_id = $1") && text.includes("batch = $2")) {
        return { rows: state.drugBatches.filter((b) => b.drug_id === params[0] && b.batch === params[1]) };
      }
      if (text.includes("count(*)::int as count from drug_batches")) return { rows: [{ count: state.drugBatches.length }] };
      if (text.startsWith("insert into drug_batches")) {
        const batch = { id: params[0], drug_id: params[1], batch: params[2], expiry: params[3], qty: 0, purchase_rate: params[4], mrp: params[5] };
        state.drugBatches.push(batch);
        return { rows: [batch] };
      }
      if (text.startsWith("update drug_batches") && text.includes("qty = qty +")) {
        const batch = state.drugBatches.find((b) => b.id === params[0]);
        if (batch) batch.qty += Number(params[1]);
        return { rows: [] };
      }
      if (text.startsWith("update drug_batches") && text.includes("qty = qty -")) {
        const batch = state.drugBatches.find((b) => b.id === params[0]);
        if (batch) batch.qty -= Number(params[1]);
        return { rows: [] };
      }
      if (text.startsWith("update drug_batches") && text.includes("purchase_rate")) {
        const batch = state.drugBatches.find((b) => b.id === params[0]);
        if (batch) {
          batch.expiry = params[1];
          batch.purchase_rate = params[2];
          batch.mrp = params[3];
        }
        return { rows: [] };
      }
      if (text.includes("from drug_batches") && text.includes("where id = $1 and drug_id = $2")) {
        return { rows: state.drugBatches.filter((b) => b.id === params[0] && b.drug_id === params[1]) };
      }
      if (text.startsWith("insert into visits")) {
        const visit = {
          id: params[0],
          voucher_no: params[1],
          patient_id: params[2],
          doctor_id: params[3],
          visit_at: params[4],
          status: params[5],
          subtotal: params[6],
          discount: params[7],
          total: params[8]
        };
        state.visits.unshift(visit);
        return { rows: [visit] };
      }
      if (text.includes("from visits") && text.includes("where id = $1")) {
        return { rows: state.visits.filter((v) => v.id === params[0]) };
      }
      if (text.startsWith("update visits")) {
        const visit = state.visits.find((v) => v.id === params[0]);
        if (visit) {
          visit.status = "done";
          visit.notes = params[1];
          visit.updated_by = params[2];
        }
        return { rows: visit ? [visit] : [] };
      }
      if (text.startsWith("insert into vitals")) {
        state.vitals.push({ visit_id: params[0], weight_kg: params[1], height_cm: params[2], temp_f: params[3], pulse: params[4], recorded_at: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("insert into patient_weight_history")) {
        state.patientWeights.push({ patient_id: params[0], recorded_at: params[1], weight_kg: params[2] });
        return { rows: [] };
      }
      if (text.startsWith("insert into visit_items")) {
        state.visitItems.push({ visit_id: params[0], service_id: params[1], name: params[2], qty: params[3], rate: params[4], gst: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("insert into invoices")) {
        const literalKind = text.includes("values ($1, 'PHARMACY'") ? "PHARMACY" : text.includes("values ($1, 'OPD'") ? "OPD" : null;
        const invoice = literalKind
          ? { id: params[0], kind: literalKind, ref_id: params[1], voucher_no: params[2], party_id: params[3], invoice_at: params[4], total: params[5] }
          : { id: params[0], kind: params[1], ref_id: params[2], voucher_no: params[3], party_id: params[4], invoice_at: params[5], total: params[6] };
        state.invoices.unshift(invoice);
        return { rows: [invoice] };
      }
      if (text.startsWith("insert into invoice_items")) {
        state.invoiceItems.push({ invoice_id: params[0], name: params[1], qty: params[2], rate: params[3], gst: params[4] });
        return { rows: [] };
      }
      if (text.startsWith("insert into payments")) {
        state.payments.push({ invoice_id: params[0], mode: params[1], amount: params[2], paid_at: params[3] });
        return { rows: [] };
      }
      if (text.startsWith("insert into purchases")) {
        state.purchases.unshift({ id: params[0], voucher_no: params[1], supplier_id: params[2], invoice_no: params[3], purchase_at: params[4], total: 0, created_by: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("insert into purchase_items")) {
        state.purchaseItems.push({ purchase_id: params[0], drug_id: params[1], batch_id: params[2], qty: params[3], rate: params[4], gst: params[5], mrp: params[6] });
        return { rows: [] };
      }
      if (text.startsWith("update purchases")) {
        const purchase = state.purchases.find((p) => p.id === params[0]);
        if (purchase) purchase.total = params[1];
        return { rows: [] };
      }
      if (text.startsWith("insert into stock_movements")) {
        state.stockMovements.unshift({ id: params[0], kind: params[1], ref_id: params[2], drug_id: params[3], batch_id: params[4], qty: params[5], note: params[6], created_by: params[7] });
        return { rows: [] };
      }
      if (text.startsWith("insert into pharmacy_sales")) {
        state.pharmacySales.unshift({ id: params[0], voucher_no: params[1], patient_id: params[2], linked_visit_id: params[3], sale_at: params[4], total: params[5], status: "paid", created_by: params[6] });
        return { rows: [] };
      }
      if (text.startsWith("insert into sale_items")) {
        state.saleItems.push({ sale_id: params[0], drug_id: params[1], batch_id: params[2], name: params[3], qty: params[4], rate: params[5], gst: params[6] });
        return { rows: [] };
      }
      if (text.includes("from pharmacy_sales")) return { rows: state.pharmacySales.filter((s) => s.id === params[0]) };
      if (text.includes("from sale_items")) return { rows: state.saleItems.filter((it) => it.sale_id === params[0] && it.drug_id === params[1] && it.batch_id === params[2]) };
      if (text.startsWith("insert into sales_returns")) {
        state.salesReturns.unshift({ id: params[0], voucher_no: params[1], sale_id: params[2], reason: params[3], return_at: params[4], amount: 0, created_by: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("insert into return_items")) {
        state.returnItems.push({ return_id: params[0], drug_id: params[1], batch_id: params[2], qty: params[3], rate: params[4], gst: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("update sales_returns")) {
        const ret = state.salesReturns.find((r) => r.id === params[0]);
        if (ret) ret.amount = params[1];
        return { rows: [] };
      }
      if (text.startsWith("delete from prescriptions")) {
        state.prescriptions = state.prescriptions.filter((rx) => rx.visit_id !== params[0]);
        return { rows: [] };
      }
      if (text.startsWith("insert into prescriptions")) {
        state.prescriptions.push({ visit_id: params[0], drug_id: params[1], name: params[2], dose: params[3], frequency: params[4], days: params[5], qty: params[6] });
        return { rows: [] };
      }
      if (text.includes("from drugs") && text.includes("where id = $1")) {
        return { rows: state.drugs.filter((d) => d.id === params[0]) };
      }
      throw new Error(`Unexpected SQL in fakeDb: ${text}`);
    }
  };
}
