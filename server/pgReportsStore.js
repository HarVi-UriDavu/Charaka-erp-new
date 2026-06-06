import { PgSystemStore } from "./pgSystemStore.js";

const todayKey = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export class PgReportsStore {
  constructor(db, system = new PgSystemStore(db)) {
    this.db = db;
    this.system = system;
  }

  async daybook(date = todayKey()) {
    const invoices = await this.db.query(
      `select i.id,
              i.kind,
              i.ref_id as "refId",
              i.voucher_no as "voucherNo",
              i.party_id as "partyId",
              i.invoice_at as date,
              i.total,
              coalesce(sum(p.amount) filter (where p.mode = 'Cash'), 0) as cash,
              coalesce(sum(p.amount) filter (where p.mode = 'UPI'), 0) as upi
       from invoices i
       left join payments p on p.invoice_id = i.id
       where i.invoice_at::date = $1::date
         and i.status = 'paid'
       group by i.id
       order by i.invoice_at desc`,
      [date]
    );
    const returns = await this.db.query(
      `select id, voucher_no as "voucherNo", sale_id as "saleId", reason, return_at as date, amount
       from sales_returns
       where return_at::date = $1::date
         and status = 'posted'
       order by return_at desc`,
      [date]
    );
    const rows = invoices.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      refId: row.refId,
      voucherNo: row.voucherNo,
      partyId: row.partyId,
      date: row.date,
      total: money(row.total),
      paid: { cash: money(row.cash), upi: money(row.upi), mode: row.cash > 0 && row.upi > 0 ? "Mixed" : row.cash > 0 ? "Cash" : "UPI" },
      status: "paid"
    }));
    const cash = rows.reduce((s, row) => s + row.paid.cash, 0);
    const upi = rows.reduce((s, row) => s + row.paid.upi, 0);
    const refund = returns.rows.reduce((s, row) => s + Number(row.amount || 0), 0);
    return { date, rows, returns: returns.rows, cash: money(cash), upi: money(upi), refund: money(refund), net: money(cash + upi - refund) };
  }

  async stockRows() {
    const result = await this.db.query(
      `select b.id,
              b.drug_id as "drugId",
              b.batch,
              b.expiry,
              b.qty,
              b.purchase_rate as "purchaseRate",
              b.mrp,
              d.name as "drugName",
              d.form,
              d.gst,
              d.reorder_level as "reorderLevel",
              (b.expiry - current_date) as "daysToExpiry",
              b.qty * b.purchase_rate as value
       from drug_batches b
       join drugs d on d.id = b.drug_id
       order by d.name, b.expiry`
    );
    return result.rows.map((row) => ({ ...row, qty: Number(row.qty), purchaseRate: money(row.purchaseRate), mrp: money(row.mrp), gst: Number(row.gst) || 0, reorderLevel: Number(row.reorderLevel) || 0, daysToExpiry: Number(row.daysToExpiry) || 0, value: money(row.value) }));
  }

  async auditLogs(limit = 50) {
    const result = await this.db.query(
      `select id, at, user_id as "userId", action, entity, entity_id as "entityId", details
       from audit_logs
       order by at desc
       limit $1`,
      [limit]
    );
    return result.rows;
  }

  async recordImportJob(entity, imported, errors = [], userId = "U04") {
    await this.system.requireAdmin(userId);
    const id = `IMP${String(await this.system.nextSeq("importJob")).padStart(4, "0")}`;
    await this.db.query(
      `insert into import_jobs (id, entity, imported, failed, errors, created_by)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, entity, Number(imported) || 0, errors.length, JSON.stringify(errors), userId]
    );
    await this.system.audit(userId, "IMPORT", entity, id, { imported: Number(imported) || 0, failed: errors.length });
    return { id, entity, imported: Number(imported) || 0, failed: errors.length, errors };
  }

  async recordBackupJob(filePath, userId = "U04", details = {}, kind = "manual", status = "created") {
    await this.system.requireAdmin(userId);
    const result = await this.db.query(
      `insert into backup_jobs (kind, file_path, status, details, created_by)
       values ($1, $2, $3, $4, $5)
       returning id, kind, file_path as "filePath", status, details, created_at as "createdAt"`,
      [kind, filePath, status, JSON.stringify(details), userId]
    );
    await this.system.audit(userId, "BACKUP", "backup", String(result.rows[0].id), { filePath, status });
    return result.rows[0];
  }
}
