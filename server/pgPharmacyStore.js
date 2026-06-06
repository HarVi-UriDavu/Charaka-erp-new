import { withTransaction } from "./db.js";
import { PgSystemStore } from "./pgSystemStore.js";
import { httpError } from "./store.js";

const pad = (n, w = 4) => String(n).padStart(w, "0");
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class PgPharmacyStore {
  constructor(db, system = new PgSystemStore(db)) {
    this.db = db;
    this.system = system;
  }

  async createPurchase(input, userId = "U03") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireUser(userId);
      const meta = await system.clinicSettings();
      const supplier = await getSupplier(db, required(input.supplierId, "supplierId"));
      const rows = input.items || [];
      if (!rows.length) throw httpError(400, "At least one purchase item is required");
      const seq = await system.nextSeq("purchase");
      const purchase = {
        id: `GRN${pad(seq, 4)}`,
        voucherNo: `GRN/${meta.financialYear}/${pad(seq, 3)}`,
        date: new Date().toISOString(),
        supplierId: supplier.id,
        invoiceNo: required(input.invoiceNo, "invoiceNo"),
        items: [],
        total: 0
      };
      await db.query(
        `insert into purchases (id, voucher_no, supplier_id, invoice_no, purchase_at, total, created_by)
         values ($1, $2, $3, $4, $5, 0, $6)`,
        [purchase.id, purchase.voucherNo, purchase.supplierId, purchase.invoiceNo, purchase.date, userId]
      );
      for (const row of rows) {
        const drug = await getDrug(db, required(row.drugId, "drugId"));
        const qty = Number(row.qty) || 0;
        if (qty <= 0) throw httpError(400, "Purchase quantity must be positive");
        const batch = await upsertBatch(db, drug, row);
        await db.query(`update drug_batches set qty = qty + $2, updated_at = now() where id = $1`, [batch.id, qty]);
        const item = { drugId: drug.id, name: drug.name, batchId: batch.id, batch: batch.batch, expiry: batch.expiry, qty, rate: money(row.rate), gst: Number(row.gst ?? drug.gst) || 0 };
        purchase.items.push(item);
        purchase.total += item.qty * item.rate;
        await db.query(
          `insert into purchase_items (purchase_id, drug_id, batch_id, qty, rate, gst, mrp)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [purchase.id, drug.id, batch.id, qty, item.rate, item.gst, money(row.mrp || drug.mrp)]
        );
        await stockMove(db, system, userId, "PURCHASE", purchase.id, drug.id, batch.id, qty, `Purchase ${purchase.voucherNo}`);
      }
      purchase.total = money(purchase.total);
      await db.query(`update purchases set total = $2 where id = $1`, [purchase.id, purchase.total]);
      await system.audit(userId, "CREATE", "purchase", purchase.id, { voucherNo: purchase.voucherNo, total: purchase.total });
      return purchase;
    });
  }

  async createPharmacySale(input, userId = "U03") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireUser(userId);
      const meta = await system.clinicSettings();
      const items = [];
      for (const row of input.items || []) items.push(await normalizeSaleItem(db, row));
      if (!items.length) throw httpError(400, "At least one item is required");
      for (const item of items) {
        if (item.batchQty < item.qty) throw httpError(409, `${item.name} ${item.batch} has only ${item.batchQty} units`);
      }
      const total = money(items.reduce((s, it) => s + it.rate * it.qty, 0));
      const paid = normalizePayment(input.payment, total);
      const seq = await system.nextSeq("pharmacy");
      const invoiceSeq = await system.nextSeq("invoice");
      const sale = {
        id: `PH${pad(seq, 4)}`,
        voucherNo: `PH/${meta.financialYear}/${pad(seq, 4)}`,
        date: new Date().toISOString(),
        patientId: input.patientId || null,
        linkedVisitId: input.linkedVisitId || null,
        items: items.map(({ batchQty, ...item }) => item),
        paid,
        total,
        status: "paid"
      };
      await db.query(
        `insert into pharmacy_sales (id, voucher_no, patient_id, linked_visit_id, sale_at, total, status, created_by)
         values ($1, $2, $3, $4, $5, $6, 'paid', $7)`,
        [sale.id, sale.voucherNo, sale.patientId, sale.linkedVisitId, sale.date, sale.total, userId]
      );
      for (const item of items) {
        await db.query(`update drug_batches set qty = qty - $2, updated_at = now() where id = $1`, [item.batchId, item.qty]);
        await db.query(
          `insert into sale_items (sale_id, drug_id, batch_id, name, qty, rate, gst)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [sale.id, item.drugId, item.batchId, item.name, item.qty, item.rate, item.gst]
        );
        await stockMove(db, system, userId, "SALE", sale.id, item.drugId, item.batchId, -item.qty, `Sale ${sale.voucherNo}`);
      }
      const invoiceId = `INV${pad(invoiceSeq, 5)}`;
      await db.query(
        `insert into invoices (id, kind, ref_id, voucher_no, party_id, invoice_at, total, created_by)
         values ($1, 'PHARMACY', $2, $3, $4, $5, $6, $7)`,
        [invoiceId, sale.id, sale.voucherNo, sale.patientId, sale.date, sale.total, userId]
      );
      for (const item of items) {
        await db.query(
          `insert into invoice_items (invoice_id, name, qty, rate, gst)
           values ($1, $2, $3, $4, $5)`,
          [invoiceId, item.name, item.qty, item.rate, item.gst]
        );
      }
      if (paid.cash) await insertPayment(db, invoiceId, "Cash", paid.cash, sale.date);
      if (paid.upi) await insertPayment(db, invoiceId, "UPI", paid.upi, sale.date);
      await system.audit(userId, "CREATE", "pharmacy_sale", sale.id, { voucherNo: sale.voucherNo, total });
      return sale;
    });
  }

  async createReturn(input, userId = "U03") {
    return runInTransaction(this.db, async (db) => {
      const system = new PgSystemStore(db);
      await system.requireUser(userId);
      const meta = await system.clinicSettings();
      const sale = await getSale(db, required(input.saleId, "saleId"));
      const seq = await system.nextSeq("return");
      const ret = {
        id: `RET${pad(seq, 4)}`,
        voucherNo: `RET/${meta.financialYear}/${pad(seq, 4)}`,
        date: new Date().toISOString(),
        type: "Sales return",
        saleId: sale.id,
        reason: input.reason || "",
        items: [],
        amount: 0
      };
      await db.query(
        `insert into sales_returns (id, voucher_no, sale_id, reason, return_at, amount, created_by)
         values ($1, $2, $3, $4, $5, 0, $6)`,
        [ret.id, ret.voucherNo, ret.saleId, ret.reason, ret.date, userId]
      );
      for (const row of input.items || []) {
        const sold = await getSaleItem(db, sale.id, required(row.drugId, "drugId"), required(row.batchId, "batchId"));
        const qty = Number(row.qty) || 0;
        if (qty <= 0 || qty > sold.qty) throw httpError(400, "Invalid return quantity");
        const item = { drugId: sold.drug_id, name: sold.name, batchId: sold.batch_id, qty, rate: money(sold.rate), gst: Number(sold.gst) || 0 };
        ret.items.push(item);
        ret.amount += item.qty * item.rate;
        await db.query(`update drug_batches set qty = qty + $2, updated_at = now() where id = $1`, [item.batchId, qty]);
        await db.query(
          `insert into return_items (return_id, drug_id, batch_id, qty, rate, gst)
           values ($1, $2, $3, $4, $5, $6)`,
          [ret.id, item.drugId, item.batchId, qty, item.rate, item.gst]
        );
        await stockMove(db, system, userId, "RETURN", ret.id, item.drugId, item.batchId, qty, `Return ${ret.voucherNo}`);
      }
      ret.amount = money(ret.amount);
      await db.query(`update sales_returns set amount = $2 where id = $1`, [ret.id, ret.amount]);
      await system.audit(userId, "CREATE", "return", ret.id, { voucherNo: ret.voucherNo, amount: ret.amount });
      return ret;
    });
  }
}

async function runInTransaction(db, work) {
  if (typeof db.connect === "function") return withTransaction(db, work);
  return work(db);
}

async function getSupplier(db, id) {
  const result = await db.query(`select * from suppliers where id = $1 and active = true`, [id]);
  const supplier = result.rows[0];
  if (!supplier) throw httpError(404, "Supplier not found");
  return supplier;
}

async function getDrug(db, id) {
  const result = await db.query(`select * from drugs where id = $1 and active = true`, [id]);
  const drug = result.rows[0];
  if (!drug) throw httpError(404, "Drug not found");
  return drug;
}

async function upsertBatch(db, drug, row) {
  const batchCode = required(row.batch, "batch");
  const existing = await db.query(`select * from drug_batches where drug_id = $1 and batch = $2`, [drug.id, batchCode]);
  if (existing.rows[0]) {
    const batch = existing.rows[0];
    await db.query(
      `update drug_batches
       set expiry = $2, purchase_rate = $3, mrp = $4, updated_at = now()
       where id = $1`,
      [batch.id, row.expiry || batch.expiry, money(row.rate || batch.purchase_rate), money(row.mrp || batch.mrp)]
    );
    return { ...batch, expiry: row.expiry || batch.expiry, purchase_rate: money(row.rate || batch.purchase_rate), mrp: money(row.mrp || batch.mrp) };
  }
  const id = `B${pad(await countBatches(db) + 1, 3)}`;
  const batch = { id, drug_id: drug.id, batch: batchCode, expiry: required(row.expiry, "expiry"), qty: 0, purchase_rate: money(row.rate), mrp: money(row.mrp || drug.mrp) };
  await db.query(
    `insert into drug_batches (id, drug_id, batch, expiry, qty, purchase_rate, mrp)
     values ($1, $2, $3, $4, 0, $5, $6)
     returning *`,
    [batch.id, batch.drug_id, batch.batch, batch.expiry, batch.purchase_rate, batch.mrp]
  );
  return batch;
}

async function countBatches(db) {
  const result = await db.query(`select count(*)::int as count from drug_batches`);
  return Number(result.rows[0]?.count || 0);
}

async function normalizeSaleItem(db, row) {
  const drug = await getDrug(db, required(row.drugId, "drugId"));
  const batch = await getBatch(db, required(row.batchId, "batchId"), drug.id);
  const qty = Number(row.qty) || 0;
  if (qty <= 0) throw httpError(400, "Sale quantity must be positive");
  if (!batch.expiry) throw httpError(400, "Expiry is required for stock-tracked sale");
  return { drugId: drug.id, name: drug.name, batchId: batch.id, batch: batch.batch, expiry: batch.expiry, qty, rate: money(row.rate || batch.mrp || drug.mrp), gst: Number(drug.gst) || 0, batchQty: Number(batch.qty) || 0 };
}

async function getBatch(db, id, drugId) {
  const result = await db.query(`select * from drug_batches where id = $1 and drug_id = $2`, [id, drugId]);
  const batch = result.rows[0];
  if (!batch) throw httpError(404, "Batch not found");
  return batch;
}

async function getSale(db, id) {
  const result = await db.query(`select * from pharmacy_sales where id = $1`, [id]);
  const sale = result.rows[0];
  if (!sale) throw httpError(404, "Sale not found");
  return sale;
}

async function getSaleItem(db, saleId, drugId, batchId) {
  const result = await db.query(`select * from sale_items where sale_id = $1 and drug_id = $2 and batch_id = $3`, [saleId, drugId, batchId]);
  const item = result.rows[0];
  if (!item) throw httpError(400, "Return item does not match sale");
  return item;
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

async function insertPayment(db, invoiceId, mode, amount, paidAt) {
  await db.query(
    `insert into payments (invoice_id, mode, amount, paid_at)
     values ($1, $2, $3, $4)`,
    [invoiceId, mode, amount, paidAt]
  );
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
