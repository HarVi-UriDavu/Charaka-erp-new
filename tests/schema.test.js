import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");

test("PostgreSQL schema includes core ERP tables", () => {
  const tables = [
    "app_settings",
    "sequences",
    "roles",
    "permissions",
    "users",
    "patients",
    "visits",
    "vitals",
    "prescriptions",
    "services",
    "invoices",
    "payments",
    "drugs",
    "drug_batches",
    "stock_movements",
    "suppliers",
    "purchases",
    "pharmacy_sales",
    "sales_returns",
    "import_jobs",
    "backup_jobs",
    "audit_logs"
  ];
  for (const table of tables) {
    assert.match(schema, new RegExp(`create table if not exists ${table}\\b`));
  }
});

test("PostgreSQL schema keeps finance and stock guardrails", () => {
  assert.match(schema, /check \(status in \('waiting', 'in-consult', 'done', 'cancelled'\)\)/);
  assert.match(schema, /check \(kind in \('OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'\)\)/);
  assert.match(schema, /unique \(drug_id, batch\)/);
});
