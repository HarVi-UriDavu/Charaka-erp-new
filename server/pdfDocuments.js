import PDFDocument from "pdfkit";

const money = (value) => `Rs. ${(Number(value) || 0).toFixed(2)}`;

export async function generateClinicPdf({ kind, record, patient, meta, drugs = [] }) {
  if (!record) throw new Error("Document record not found");
  const doc = new PDFDocument({ size: "A4", margin: 42, info: { Title: documentTitle(kind), Author: meta.clinicName || "Charaka Clinic" } });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  header(doc, meta, documentTitle(kind));
  if (kind === "opd_receipt") opdReceipt(doc, record, patient);
  else if (kind === "prescription") prescription(doc, record, patient);
  else if (kind === "pharmacy_invoice") pharmacyInvoice(doc, record, patient, drugs);
  else throw new Error("Unsupported PDF document kind");
  footer(doc, meta);
  doc.end();
  return done;
}

function header(doc, meta, title) {
  doc.font("Helvetica-Bold").fontSize(16).text(String(meta.clinicName || "Charaka Clinic").toUpperCase(), { align: "center" });
  doc.font("Helvetica").fontSize(9).text(meta.clinicSubtitle || "", { align: "center" });
  doc.text(meta.address || "", { align: "center" });
  doc.text(`Phone: ${meta.phone || ""}${meta.gstin ? `   GSTIN: ${meta.gstin}` : ""}`, { align: "center" });
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(13).text(title, { align: "center", underline: true });
  doc.moveDown();
}

function patientBlock(doc, patient, record) {
  const name = patient ? `${patient.firstName} ${patient.lastName}` : "Walk-in";
  const rows = [
    ["Patient", name, "UHID", patient?.uhid || ""],
    ["Mobile", patient?.mobile || "", "Date", formatDate(record.date)],
    ["Voucher", record.voucherNo || "", "Guardian", patient?.guardian?.name || ""]
  ];
  table(doc, ["", "", "", ""], rows, [70, 180, 70, 180], false);
  doc.moveDown();
}

function opdReceipt(doc, visit, patient) {
  patientBlock(doc, patient, visit);
  const rows = (visit.items || []).map((item, index) => [
    index + 1,
    item.name,
    Number(item.qty) || 0,
    money(item.rate),
    money((Number(item.qty) || 0) * (Number(item.rate) || 0))
  ]);
  table(doc, ["No.", "Particulars", "Qty", "Rate", "Amount"], rows, [35, 270, 45, 80, 80]);
  total(doc, "Total", visit.total);
  if (visit.vitals?.wt || visit.vitals?.temp) {
    doc.moveDown().font("Helvetica").fontSize(10).text(`Weight: ${visit.vitals?.wt || "-"} kg   Temperature: ${visit.vitals?.temp || "-"} F`);
  }
}

function prescription(doc, visit, patient) {
  patientBlock(doc, patient, visit);
  const rows = (visit.prescription || []).map((item, index) => [
    index + 1,
    item.name,
    item.dose || "",
    item.frequency || "",
    item.days || "",
    item.qty || ""
  ]);
  table(doc, ["No.", "Medicine", "Dose", "Frequency", "Days", "Qty"], rows, [30, 190, 80, 95, 50, 45]);
  doc.moveDown();
  doc.font("Helvetica-Bold").fontSize(10).text("Clinical notes");
  doc.font("Helvetica").text(visit.notes || "No additional notes.");
  if (visit.followUpDate) doc.moveDown().text(`Follow-up: ${formatDate(visit.followUpDate)}${visit.followUpReason ? ` - ${visit.followUpReason}` : ""}`);
}

function pharmacyInvoice(doc, sale, patient, drugs) {
  patientBlock(doc, patient, sale);
  const rows = (sale.items || []).map((item, index) => {
    const drug = drugs.find((row) => row.id === item.drugId);
    return [
      index + 1,
      item.name,
      drug?.hsn || "",
      item.batch || "",
      formatDate(item.expiry),
      Number(item.qty) || 0,
      money(item.rate),
      money((Number(item.qty) || 0) * (Number(item.rate) || 0))
    ];
  });
  table(doc, ["No.", "Medicine", "HSN", "Batch", "Expiry", "Qty", "Rate", "Amount"], rows, [28, 145, 55, 65, 60, 35, 65, 75]);
  total(doc, "Bill amount", sale.total);
}

function table(doc, headers, rows, widths, showHeader = true) {
  const startX = doc.x;
  let y = doc.y;
  if (showHeader) {
    doc.font("Helvetica-Bold").fontSize(8);
    drawRow(doc, headers, widths, startX, y, true);
    y += 22;
  }
  doc.font("Helvetica").fontSize(8);
  for (const row of rows.length ? rows : [["", "No items", ...Array(Math.max(0, widths.length - 2)).fill("")]]) {
    const height = Math.max(24, row.reduce((max, cell, index) => Math.max(max, doc.heightOfString(String(cell ?? ""), { width: widths[index] - 8 })), 0) + 10);
    if (y + height > doc.page.height - 70) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    drawRow(doc, row, widths, startX, y, false, height);
    y += height;
  }
  doc.y = y;
}

function drawRow(doc, cells, widths, x, y, shaded, height = 22) {
  let cursor = x;
  cells.forEach((cell, index) => {
    if (shaded) doc.save().fillColor("#e8f3f1").rect(cursor, y, widths[index], height).fill().restore();
    doc.rect(cursor, y, widths[index], height).strokeColor("#8a98a8").stroke();
    doc.fillColor("#172536").text(String(cell ?? ""), cursor + 4, y + 5, { width: widths[index] - 8, height: height - 8 });
    cursor += widths[index];
  });
}

function total(doc, label, amount) {
  doc.moveDown(0.7);
  doc.font("Helvetica-Bold").fontSize(12).text(`${label}: ${money(amount)}`, { align: "right" });
}

function footer(doc, meta) {
  doc.moveDown(2);
  doc.font("Helvetica").fontSize(8).fillColor("#536273").text("Computer-generated document.", { align: "left" });
  doc.text(`For ${meta.clinicName || "Charaka Clinic"} - Authorised Signatory`, { align: "right" });
}

function documentTitle(kind) {
  return {
    opd_receipt: "CONSULTATION CHARGES RECEIPT",
    prescription: "PRESCRIPTION",
    pharmacy_invoice: "PHARMACY TAX INVOICE"
  }[kind] || "CLINIC DOCUMENT";
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}
