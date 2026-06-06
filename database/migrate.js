import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../server/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

const pool = await createPool({ max: 1 });

try {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  console.log("PostgreSQL schema applied");
} finally {
  await pool.end();
}
