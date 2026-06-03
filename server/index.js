import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClinicStore, httpError } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const store = new ClinicStore();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`Charaka Clinic ERP listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = req.headers["x-user-id"] || "U04";
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};

  if (req.method === "GET" && url.pathname === "/api/state") {
    const state = store.snapshot();
    return sendJson(res, 200, { ...state, stockRows: store.stockRows(), daybook: store.daybook(url.searchParams.get("date") || undefined) });
  }
  if (req.method === "POST" && url.pathname === "/api/patients") return sendJson(res, 201, store.addPatient(body, userId));
  if (req.method === "POST" && url.pathname === "/api/visits") return sendJson(res, 201, store.createVisit(body, userId));
  if (req.method === "PATCH" && url.pathname.startsWith("/api/visits/")) {
    const id = url.pathname.split("/").at(-1);
    return sendJson(res, 200, store.updateVisitClinical(id, body, userId));
  }
  if (req.method === "POST" && url.pathname === "/api/pharmacy/sales") return sendJson(res, 201, store.createPharmacySale(body, userId));
  if (req.method === "POST" && url.pathname === "/api/pharmacy/purchases") return sendJson(res, 201, store.createPurchase(body, userId));
  if (req.method === "POST" && url.pathname === "/api/pharmacy/returns") return sendJson(res, 201, store.createReturn(body, userId));
  if (req.method === "POST" && url.pathname.startsWith("/api/import/")) {
    const entity = url.pathname.split("/").at(-1);
    return sendJson(res, 201, store.importCsv(entity, body.csv || "", userId));
  }
  if (req.method === "POST" && url.pathname === "/api/backup") return sendJson(res, 201, store.backup());
  if (req.method === "GET" && url.pathname === "/api/export/daybook.csv") {
    const book = store.daybook(url.searchParams.get("date") || undefined);
    const csv = ["Voucher,Kind,Date,Party,Total,Cash,UPI", ...book.rows.map((r) => [r.voucherNo, r.kind, r.date, r.partyId || "Walk-in", r.total, r.paid?.cash || 0, r.paid?.upi || 0].map(csvCell).join(","))].join("\n");
    res.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename="daybook-${book.date}.csv"` });
    return res.end(csv);
  }
  throw httpError(404, "Not found");
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Invalid JSON");
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) throw httpError(403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(publicDir, "index.html");
  const ext = path.extname(filePath);
  const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(filePath).pipe(res);
}

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
