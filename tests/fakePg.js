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
    importJobs: [],
    backupJobs: [],
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
      if (text.includes("from invoices i") && text.includes("left join payments") && text.includes("where i.invoice_at::date")) {
        const date = params[0];
        const rows = state.invoices
          .filter((invoice) => sameDay(invoice.invoice_at, date))
          .map((invoice) => {
            const payments = state.payments.filter((p) => p.invoice_id === invoice.id);
            return {
              id: invoice.id,
              kind: invoice.kind,
              refId: invoice.ref_id,
              voucherNo: invoice.voucher_no,
              partyId: invoice.party_id,
              date: invoice.invoice_at,
              total: invoice.total,
              cash: payments.filter((p) => p.mode === "Cash").reduce((s, p) => s + Number(p.amount || 0), 0),
              upi: payments.filter((p) => p.mode === "UPI").reduce((s, p) => s + Number(p.amount || 0), 0)
            };
          });
        return { rows };
      }
      if (text.includes("from invoices i") && text.includes("left join payments") && text.includes("group by i.id")) {
        return {
          rows: state.invoices.map((invoice) => {
            const payments = state.payments.filter((p) => p.invoice_id === invoice.id);
            return {
              id: invoice.id,
              kind: invoice.kind,
              refId: invoice.ref_id,
              voucherNo: invoice.voucher_no,
              partyId: invoice.party_id,
              date: invoice.invoice_at,
              total: invoice.total,
              status: invoice.status || "paid",
              cash: payments.filter((p) => p.mode === "Cash").reduce((s, p) => s + Number(p.amount || 0), 0),
              upi: payments.filter((p) => p.mode === "UPI").reduce((s, p) => s + Number(p.amount || 0), 0)
            };
          })
        };
      }
      if (text.includes("from sales_returns") && text.includes("return_at::date")) {
        return { rows: state.salesReturns.filter((r) => sameDay(r.return_at, params[0])).map((r) => ({ id: r.id, voucherNo: r.voucher_no, saleId: r.sale_id, reason: r.reason, date: r.return_at, amount: r.amount })) };
      }
      if (text.includes("from drug_batches b") && text.includes("join drugs")) {
        return {
          rows: state.drugBatches.map((batch) => {
            const drug = state.drugs.find((d) => d.id === batch.drug_id) || {};
            return {
              id: batch.id,
              drugId: batch.drug_id,
              batch: batch.batch,
              expiry: batch.expiry,
              qty: batch.qty,
              purchaseRate: batch.purchase_rate,
              mrp: batch.mrp,
              drugName: drug.name || "",
              form: drug.form || "",
              gst: drug.gst || 0,
              reorderLevel: drug.reorder_level || drug.reorderLevel || 0,
              daysToExpiry: 30,
              value: Number(batch.qty || 0) * Number(batch.purchase_rate || 0)
            };
          })
        };
      }
      if (text.includes("from audit_logs") && text.includes("order by at desc")) {
        return { rows: state.auditLogs.slice(0, params[0]).map((log) => ({ id: log.id, at: log.at || new Date().toISOString(), userId: log.userId, action: log.action, entity: log.entity, entityId: log.entityId, details: log.details })) };
      }
      if (text.includes("from patients") && text.includes("where id = $1")) {
        return { rows: state.patients.filter((p) => p.id === params[0]) };
      }
      if (text.includes("from patients") && text.includes("where active = true")) {
        return {
          rows: state.patients.map((p) => ({
            id: p.id,
            uhid: p.uhid,
            firstName: p.firstName || p.first_name,
            lastName: p.lastName || p.last_name,
            gender: p.gender,
            dob: p.dob,
            mobile: p.mobile,
            guardianRel: p.guardianRel || p.guardian_rel,
            guardianName: p.guardianName || p.guardian_name,
            address: p.address,
            bloodGroup: p.bloodGroup || p.blood_group,
            allergies: p.allergies
          }))
        };
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
      if (text.includes("from patient_weight_history") && text.includes("order by recorded_at")) {
        return { rows: state.patientWeights.map((w) => ({ patientId: w.patient_id, date: w.recorded_at, w: w.weight_kg })) };
      }
      if (text.includes("from doctors") && text.includes("order by id")) {
        return {
          rows: state.doctors.map((d) => ({
            id: d.id,
            name: d.name,
            qualification: d.qualification || "",
            regNo: d.reg_no || d.regNo || "",
            consultFee: d.consult_fee || d.consultFee || 0,
            followUpFee: d.follow_up_fee || d.followUpFee || 0,
            active: d.active
          }))
        };
      }
      if (text.includes("from doctors")) return { rows: state.doctors.filter((d) => d.id === params[0] && d.active) };
      if (text.includes("count(*)::int as count from services")) return { rows: [{ count: state.services.length }] };
      if (text.includes("count(*)::int as count from drugs")) return { rows: [{ count: state.drugs.length }] };
      if (text.includes("count(*)::int as count from suppliers")) return { rows: [{ count: state.suppliers.length }] };
      if (text.includes("count(*)::int as count from users")) return { rows: [{ count: state.users.length }] };
      if (text.includes("from services") && text.includes("order by code")) {
        return {
          rows: state.services.map((s) => ({
            id: s.id,
            code: s.code || s.id,
            name: s.name,
            category: s.category || "OPD",
            rate: s.rate,
            gst: s.gst || 0,
            active: s.active
          }))
        };
      }
      if (text.includes("from services")) return { rows: state.services.filter((s) => params[0].includes(s.id) && s.active) };
      if (text.includes("from suppliers") && text.includes("order by name")) {
        return { rows: state.suppliers.map((s) => ({ id: s.id, name: s.name, gstin: s.gstin || "", phone: s.phone || "", city: s.city || "", active: s.active })) };
      }
      if (text.includes("from suppliers")) return { rows: state.suppliers.filter((s) => s.id === params[0] && s.active) };
      if (text.includes("from roles") && text.includes("where id = $1")) {
        return { rows: state.rolePermissions.some((rp) => rp.role_id === params[0]) ? [{ id: params[0] }] : [] };
      }
      if (text.includes("from drugs") && text.includes("active = true")) return { rows: state.drugs.filter((d) => d.id === params[0] && d.active) };
      if (text.includes("from drugs") && text.includes("order by name")) {
        return {
          rows: state.drugs.map((d) => ({
            id: d.id,
            name: d.name,
            form: d.form || "",
            pack: d.pack || "",
            hsn: d.hsn || "",
            mrp: d.mrp || 0,
            gst: d.gst || 0,
            reorderLevel: d.reorderLevel || d.reorder_level || 0,
            active: d.active
          }))
        };
      }
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
      if (text.includes("from drug_batches") && text.includes("order by expiry")) {
        return {
          rows: state.drugBatches.map((b) => ({ id: b.id, drugId: b.drug_id, batch: b.batch, expiry: b.expiry, qty: b.qty, purchaseRate: b.purchase_rate, mrp: b.mrp }))
        };
      }
      if (text.startsWith("insert into services")) {
        state.services.push({ id: params[0], code: params[1], name: params[2], category: params[3], rate: params[4], gst: params[5], active: params[6] });
        return { rows: [] };
      }
      if (text.startsWith("insert into drugs")) {
        state.drugs.push({ id: params[0], name: params[1], form: params[2], pack: params[3], hsn: params[4], mrp: params[5], gst: params[6], reorder_level: params[7], active: params[8] });
        return { rows: [] };
      }
      if (text.startsWith("insert into suppliers")) {
        state.suppliers.push({ id: params[0], name: params[1], gstin: params[2], phone: params[3], city: params[4], active: params[5] });
        return { rows: [] };
      }
      if (text.startsWith("insert into users")) {
        state.users.push({ id: params[0], name: params[1], role: params[2], pin_hash: params[3], active: params[4] });
        return { rows: [] };
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
      if (text.includes("from visits") && text.includes("order by visit_at desc")) {
        return {
          rows: state.visits.map((v) => ({
            id: v.id,
            voucherNo: v.voucherNo || v.voucher_no,
            patientId: v.patientId || v.patient_id,
            doctorId: v.doctorId || v.doctor_id,
            date: v.date || v.visit_at,
            status: v.status,
            notes: v.notes || "",
            subtotal: v.subtotal || 0,
            discount: v.discount || 0,
            total: v.total || 0
          }))
        };
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
      if (text.includes("from vitals") && text.includes("order by recorded_at desc")) {
        return { rows: state.vitals.map((v) => ({ visitId: v.visit_id, wt: v.weight_kg, ht: v.height_cm, temp: v.temp_f, pulse: v.pulse, recordedAt: v.recorded_at })) };
      }
      if (text.includes("from visit_items") && text.includes("order by id")) {
        return { rows: state.visitItems.map((it) => ({ visitId: it.visit_id, serviceId: it.service_id, name: it.name, qty: it.qty, rate: it.rate, gst: it.gst })) };
      }
      if (text.includes("from prescriptions") && text.includes("order by id")) {
        return { rows: state.prescriptions.map((rx) => ({ visitId: rx.visit_id, drugId: rx.drug_id, name: rx.name, dose: rx.dose, frequency: rx.frequency, days: rx.days, qty: rx.qty, notes: rx.notes || "" })) };
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
      if (text.includes("from invoice_items") && text.includes("order by id")) {
        return { rows: state.invoiceItems.map((it) => ({ invoiceId: it.invoice_id, name: it.name, qty: it.qty, rate: it.rate, gst: it.gst })) };
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
      if (text.startsWith("insert into import_jobs")) {
        const job = { id: params[0], entity: params[1], imported: params[2], failed: params[3], errors: JSON.parse(params[4]), created_by: params[5] };
        state.importJobs.unshift(job);
        return { rows: [] };
      }
      if (text.startsWith("insert into backup_jobs")) {
        const job = { id: state.backupJobs.length + 1, kind: params[0], filePath: params[1], status: params[2], details: JSON.parse(params[3]), created_by: params[4], createdAt: new Date().toISOString() };
        state.backupJobs.unshift(job);
        return { rows: [job] };
      }
      if (text.startsWith("insert into pharmacy_sales")) {
        state.pharmacySales.unshift({ id: params[0], voucher_no: params[1], patient_id: params[2], linked_visit_id: params[3], sale_at: params[4], total: params[5], status: "paid", created_by: params[6] });
        return { rows: [] };
      }
      if (text.startsWith("insert into sale_items")) {
        state.saleItems.push({ sale_id: params[0], drug_id: params[1], batch_id: params[2], name: params[3], qty: params[4], rate: params[5], gst: params[6] });
        return { rows: [] };
      }
      if (text.includes("from pharmacy_sales") && text.includes("order by sale_at desc")) {
        return { rows: state.pharmacySales.map((s) => ({ id: s.id, voucherNo: s.voucher_no, patientId: s.patient_id, linkedVisitId: s.linked_visit_id, date: s.sale_at, total: s.total, status: s.status })) };
      }
      if (text.includes("from pharmacy_sales")) return { rows: state.pharmacySales.filter((s) => s.id === params[0]) };
      if (text.includes("from sale_items") && text.includes("order by id")) {
        return { rows: state.saleItems.map((it) => ({ saleId: it.sale_id, drugId: it.drug_id, batchId: it.batch_id, name: it.name, qty: it.qty, rate: it.rate, gst: it.gst })) };
      }
      if (text.includes("from sale_items")) return { rows: state.saleItems.filter((it) => it.sale_id === params[0] && it.drug_id === params[1] && it.batch_id === params[2]) };
      if (text.startsWith("insert into sales_returns")) {
        state.salesReturns.unshift({ id: params[0], voucher_no: params[1], sale_id: params[2], reason: params[3], return_at: params[4], amount: 0, created_by: params[5] });
        return { rows: [] };
      }
      if (text.includes("from purchases") && text.includes("order by purchase_at desc")) {
        return { rows: state.purchases.map((p) => ({ id: p.id, voucherNo: p.voucher_no, supplierId: p.supplier_id, invoiceNo: p.invoice_no, date: p.purchase_at, total: p.total, status: p.status || "posted" })) };
      }
      if (text.includes("from purchase_items") && text.includes("order by id")) {
        return { rows: state.purchaseItems.map((it) => ({ purchaseId: it.purchase_id, drugId: it.drug_id, batchId: it.batch_id, qty: it.qty, rate: it.rate, gst: it.gst, mrp: it.mrp })) };
      }
      if (text.includes("from sales_returns") && text.includes("order by return_at desc")) {
        return { rows: state.salesReturns.map((r) => ({ id: r.id, voucherNo: r.voucher_no, saleId: r.sale_id, reason: r.reason, date: r.return_at, amount: r.amount, status: r.status || "posted" })) };
      }
      if (text.includes("from return_items") && text.includes("order by id")) {
        return { rows: state.returnItems.map((it) => ({ returnId: it.return_id, drugId: it.drug_id, batchId: it.batch_id, qty: it.qty, rate: it.rate, gst: it.gst })) };
      }
      if (text.includes("from stock_movements") && text.includes("order by movement_at desc")) {
        return { rows: state.stockMovements.map((m) => ({ id: m.id, date: m.movement_at || m.date, kind: m.kind, refId: m.ref_id || m.refId, drugId: m.drug_id || m.drugId, batchId: m.batch_id || m.batchId, qty: m.qty, note: m.note })) };
      }
      if (text.includes("from import_jobs") && text.includes("order by created_at desc")) {
        return { rows: state.importJobs.map((j) => ({ id: j.id, entity: j.entity, imported: j.imported, failed: j.failed, errors: j.errors, at: j.created_at || j.at })) };
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

function sameDay(value, date) {
  return new Date(value).toISOString().slice(0, 10) === date;
}
