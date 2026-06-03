const app = document.getElementById("app");
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const state = {
  data: null,
  route: "dashboard",
  userId: localStorage.getItem("charaka.userId") || "U04",
  selectedPatientId: null,
  selectedVisitId: null,
  pharmacyTab: "sales",
  masterTab: "patients",
  toast: null
};

const modules = [
  ["dashboard", "Dashboard", "D"],
  ["reception", "Reception", "R"],
  ["clinical", "Clinical", "C"],
  ["pharmacy", "Pharmacy", "P"],
  ["billing", "Billing", "B"],
  ["reports", "Reports", "T"],
  ["masters", "Masters", "M"],
  ["settings", "Settings", "S"]
];

load();

async function load() {
  state.data = await api("/api/state");
  const user = currentUser();
  const allowed = state.data.roles[user.role] || [];
  if (!allowed.includes(state.route)) state.route = allowed[0] || "dashboard";
  if (!state.selectedPatientId) state.selectedPatientId = state.data.patients[0]?.id;
  render();
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", "x-user-id": state.userId, ...(options.headers || {}) }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function render() {
  const user = currentUser();
  const allowed = state.data.roles[user.role] || [];
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="mark">च</div><div><div class="brand-title">Charaka</div><div class="brand-sub">Clinic ERP</div></div></div>
        <nav class="nav">
          ${modules.map(([id, label, glyph]) => `<button data-route="${id}" class="${state.route === id ? "active" : ""} ${allowed.includes(id) ? "" : "locked"}" ${allowed.includes(id) ? "" : "disabled"}><span class="glyph">${glyph}</span><span class="label">${label}</span></button>`).join("")}
        </nav>
      </aside>
      <section class="main">
        <header class="topbar">
          <div><div class="clinic-name">${escapeHtml(state.data.meta.clinicName)}</div><div class="clinic-sub">${escapeHtml(state.data.meta.clinicSubtitle)}</div></div>
          <div class="date-pill">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div class="spacer"></div>
          <select class="role-select" id="roleSelect">${state.data.users.map((u) => `<option value="${u.id}" ${u.id === state.userId ? "selected" : ""}>${escapeHtml(u.name)} - ${u.role}</option>`).join("")}</select>
        </header>
        <main class="content">${routeHtml()}</main>
      </section>
      ${state.toast ? `<div class="toast"><strong>${escapeHtml(state.toast.title)}</strong><div class="muted">${escapeHtml(state.toast.body || "")}</div></div>` : ""}
    </div>
  `;
  bindShell();
  bindRoute();
}

function bindShell() {
  document.querySelectorAll("[data-route]").forEach((btn) => btn.addEventListener("click", () => {
    state.route = btn.dataset.route;
    render();
  }));
  document.getElementById("roleSelect").addEventListener("change", (e) => {
    state.userId = e.target.value;
    localStorage.setItem("charaka.userId", state.userId);
    load();
  });
}

function bindRoute() {
  const map = {
    dashboard: bindDashboard,
    reception: bindReception,
    clinical: bindClinical,
    pharmacy: bindPharmacy,
    billing: bindBilling,
    reports: bindReports,
    masters: bindMasters,
    settings: bindSettings
  };
  map[state.route]?.();
}

function routeHtml() {
  return ({
    dashboard: dashboardHtml,
    reception: receptionHtml,
    clinical: clinicalHtml,
    pharmacy: pharmacyHtml,
    billing: billingHtml,
    reports: reportsHtml,
    masters: mastersHtml,
    settings: settingsHtml
  }[state.route] || dashboardHtml)();
}

function currentUser() {
  return state.data.users.find((u) => u.id === state.userId) || state.data.users[0];
}

function dashboardHtml() {
  const d = state.data;
  const today = d.daybook;
  const waiting = d.visits.filter((v) => sameDay(v.date) && v.status !== "done");
  const low = d.stockRows.filter((r) => r.qty <= r.reorderLevel);
  const exp = d.stockRows.filter((r) => r.daysToExpiry <= 45);
  const alerts = [...new Map([...low, ...exp].map((r) => [r.id, r])).values()];
  return `
    ${head("Dashboard", `${waiting.length} active queue patients - ${low.length} low-stock batches - ${exp.length} expiring soon`)}
    <div class="page-body grid">
      <div class="grid cols-4">
        ${stat("Today collection", rupee(today.net), `${today.rows.length} invoices`)}
        ${stat("Cash", rupee(today.cash), "OPD + pharmacy")}
        ${stat("UPI", rupee(today.upi), "OPD + pharmacy")}
        ${stat("Stock value", rupee(sum(d.stockRows, "value")), `${d.stockRows.length} batches`)}
      </div>
      <div class="grid cols-2">
        <section class="card"><div class="card-head"><h2>OPD queue</h2><button class="btn secondary" data-go="clinical">Open clinical</button></div>${queueTable(waiting)}</section>
        <section class="card"><div class="card-head"><h2>Stock alerts</h2><button class="btn secondary" data-go="pharmacy">Open pharmacy</button></div>${stockAlertTable(alerts.slice(0, 8))}</section>
      </div>
      <section class="card"><div class="card-head"><h2>Today invoices</h2><a class="btn secondary" href="/api/export/daybook.csv">Export CSV</a></div>${invoiceTable(today.rows)}</section>
    </div>`;
}

function bindDashboard() {
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { state.route = b.dataset.go; render(); }));
}

function receptionHtml() {
  const d = state.data;
  const q = getValue("patientSearch", "");
  const patients = d.patients.filter((p) => patientText(p).includes(q.toLowerCase()));
  const selected = d.patients.find((p) => p.id === state.selectedPatientId) || patients[0];
  const visits = selected ? d.visits.filter((v) => v.patientId === selected.id) : [];
  return `
    ${head("Reception", `${d.patients.length} patients registered - ${d.visits.filter((v) => sameDay(v.date)).length} visits today`, `<input class="search" id="patientSearch" placeholder="Search UHID, name, mobile..." value="${escapeHtml(q)}"><button class="btn" id="newPatientBtn">New patient</button>`)}
    <div class="page-body split">
      <section class="card list">${patients.map((p) => patientListItem(p, selected?.id === p.id)).join("") || empty("No matching patients")}</section>
      <section class="card pad">${selected ? patientDetailHtml(selected, visits) : empty("Select a patient")}</section>
    </div>`;
}

function bindReception() {
  byId("patientSearch")?.addEventListener("input", (e) => { saveValue("patientSearch", e.target.value); render(); });
  byId("newPatientBtn")?.addEventListener("click", () => openPatientDialog());
  document.querySelectorAll("[data-patient]").forEach((b) => b.addEventListener("click", () => { state.selectedPatientId = b.dataset.patient; render(); }));
  byId("startVisitBtn")?.addEventListener("click", () => openVisitDialog(state.selectedPatientId));
  document.querySelectorAll("[data-print-visit]").forEach((b) => b.addEventListener("click", () => openReceipt("visit", b.dataset.printVisit)));
}

function patientDetailHtml(p, visits) {
  return `
    <div class="toolbar" style="justify-content:space-between">
      <div><h2>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} <span class="badge">${age(p.dob)}</span></h2><p class="hint"><span class="mono">${p.uhid}</span> - ${p.gender === "M" ? "Boy" : "Girl"} - ${escapeHtml(p.guardian.rel)} ${escapeHtml(p.guardian.name)} - ${p.mobile}</p></div>
      <button class="btn" id="startVisitBtn">Start visit</button>
    </div>
    <div class="grid cols-3" style="margin-top:14px">
      ${stat("Allergies", p.allergies || "Nil known", "clinical flag")}
      ${stat("Latest weight", p.weights?.length ? `${p.weights.at(-1).w} kg` : "-", "growth tracking")}
      ${stat("Visits", visits.length, "lifetime")}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h3>Visit history</h3></div>${visitTable(visits)}</div>`;
}

function clinicalHtml() {
  const visits = state.data.visits.filter((v) => sameDay(v.date)).sort((a, b) => new Date(a.date) - new Date(b.date));
  const selected = state.data.visits.find((v) => v.id === (state.selectedVisitId || visits[0]?.id));
  state.selectedVisitId = selected?.id || null;
  return `
    ${head("Clinical", `${visits.filter((v) => v.status === "waiting").length} waiting - ${visits.filter((v) => v.status === "in-consult").length} in consult`)}
    <div class="page-body split">
      <section class="card list">${visits.map((v) => visitQueueItem(v, selected?.id === v.id)).join("") || empty("Queue is empty")}</section>
      <section class="card pad">${selected ? clinicalFormHtml(selected) : empty("Select a patient")}</section>
    </div>`;
}

function bindClinical() {
  document.querySelectorAll("[data-visit]").forEach((b) => b.addEventListener("click", () => { state.selectedVisitId = b.dataset.visit; render(); }));
  byId("addRx")?.addEventListener("click", () => {
    const rows = byId("rxRows");
    rows.insertAdjacentHTML("beforeend", rxRowHtml({}));
  });
  byId("saveClinical")?.addEventListener("click", async () => {
    const id = state.selectedVisitId;
    const payload = {
      status: byId("visitStatus").value,
      notes: byId("clinicalNotes").value,
      vitals: formValues("clinicalVitals"),
      prescription: [...document.querySelectorAll("[data-rx-row]")].map((row) => ({
        drugId: row.querySelector("[name=drugId]").value,
        name: row.querySelector("[name=drugId]").selectedOptions[0]?.textContent || "",
        dose: row.querySelector("[name=dose]").value,
        frequency: row.querySelector("[name=frequency]").value,
        days: row.querySelector("[name=days]").value,
        qty: row.querySelector("[name=qty]").value
      }))
    };
    await mutate(`/api/visits/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, "Clinical visit saved");
  });
  byId("printPrescription")?.addEventListener("click", () => openReceipt("prescription", state.selectedVisitId));
}

function pharmacyHtml() {
  const tab = state.pharmacyTab;
  const body = tab === "sales" ? pharmacySalesHtml() : tab === "purchases" ? purchasesHtml() : tab === "returns" ? returnsHtml() : stockHtml();
  return `
    ${head("Pharmacy", `${state.data.drugs.length} drugs - ${state.data.stockRows.length} batches`, `<div class="tabs">${["sales", "purchases", "stock", "returns"].map((t) => `<button data-pharm-tab="${t}" class="${tab === t ? "active" : ""}">${title(t)}</button>`).join("")}</div>`)}
    <div class="page-body">${body}</div>`;
}

function bindPharmacy() {
  document.querySelectorAll("[data-pharm-tab]").forEach((b) => b.addEventListener("click", () => { state.pharmacyTab = b.dataset.pharmTab; render(); }));
  byId("newSaleBtn")?.addEventListener("click", openSaleDialog);
  byId("newPurchaseBtn")?.addEventListener("click", openPurchaseDialog);
  byId("newReturnBtn")?.addEventListener("click", openReturnDialog);
  document.querySelectorAll("[data-print-sale]").forEach((b) => b.addEventListener("click", () => openReceipt("sale", b.dataset.printSale)));
}

function pharmacySalesHtml() {
  return `<section class="card"><div class="card-head"><h2>Pharmacy sales</h2><button class="btn" id="newSaleBtn">New sale</button></div>${salesTable(state.data.pharmacySales)}</section>`;
}

function purchasesHtml() {
  return `<section class="card"><div class="card-head"><h2>Purchases / GRN</h2><button class="btn" id="newPurchaseBtn">New purchase</button></div>${purchaseTable(state.data.purchases)}</section>`;
}

function stockHtml() {
  return `<section class="card"><div class="card-head"><h2>Batch stock</h2></div>${stockTable(state.data.stockRows)}</section>`;
}

function returnsHtml() {
  return `<section class="card"><div class="card-head"><h2>Returns</h2><button class="btn" id="newReturnBtn">New sales return</button></div>${returnTable(state.data.returns)}</section>`;
}

function billingHtml() {
  const date = getValue("billingDate", new Date().toISOString().slice(0, 10));
  const rows = state.data.invoices.filter((i) => i.date.slice(0, 10) === date);
  const cash = rows.reduce((s, r) => s + (r.paid.cash || 0), 0);
  const upi = rows.reduce((s, r) => s + (r.paid.upi || 0), 0);
  return `
    ${head("Billing", "Unified OPD and pharmacy ledger", `<input type="date" id="billingDate" value="${date}"><a class="btn secondary" href="/api/export/daybook.csv?date=${date}">Export CSV</a>`)}
    <div class="page-body grid">
      <div class="grid cols-3">${stat("Total", rupee(cash + upi), `${rows.length} invoices`)}${stat("Cash", rupee(cash), "collected")}${stat("UPI", rupee(upi), "collected")}</div>
      <section class="card">${invoiceTable(rows)}</section>
    </div>`;
}

function bindBilling() {
  byId("billingDate")?.addEventListener("change", (e) => { saveValue("billingDate", e.target.value); render(); });
}

function reportsHtml() {
  const book = state.data.daybook;
  const stockValue = sum(state.data.stockRows, "value");
  return `
    ${head("Reports", "Collections, stock valuation, imports, and audit trail")}
    <div class="page-body grid">
      <div class="grid cols-4">${stat("Net collection", rupee(book.net), book.date)}${stat("Invoices", book.rows.length, "selected day")}${stat("Refunds", rupee(book.refund), "sales returns")}${stat("Stock valuation", rupee(stockValue), "purchase value")}</div>
      <section class="card"><div class="card-head"><h2>Daybook</h2><a class="btn secondary" href="/api/export/daybook.csv?date=${book.date}">Export CSV</a></div>${invoiceTable(book.rows)}</section>
      <section class="card"><div class="card-head"><h2>Audit log</h2></div>${auditTable(state.data.auditLogs.slice(0, 50))}</section>
    </div>`;
}

function bindReports() {}

function mastersHtml() {
  const tab = state.masterTab;
  const data = state.data;
  const tables = {
    patients: patientMasterTable(data.patients),
    services: simpleTable(data.services, ["code", "name", "category", "rate", "gst"]),
    drugs: simpleTable(data.drugs, ["name", "form", "pack", "hsn", "mrp", "gst", "reorderLevel"]),
    suppliers: simpleTable(data.suppliers, ["name", "gstin", "phone", "city"]),
    users: simpleTable(data.users, ["name", "role", "active"]),
    stock: stockTable(data.stockRows)
  };
  const addLabels = {
    patients: "",
    services: "Add service",
    drugs: "Add drug",
    suppliers: "Add supplier",
    users: "Add account",
    stock: "Add opening stock"
  };
  return `
    ${head("Masters", "Reference data and spreadsheet imports", `<div class="tabs">${Object.keys(tables).map((t) => `<button data-master-tab="${t}" class="${tab === t ? "active" : ""}">${title(t)}</button>`).join("")}</div>`)}
    <div class="page-body grid cols-2">
      <section class="card"><div class="card-head"><h2>${title(tab)}</h2>${addLabels[tab] ? `<button class="btn" id="addMasterBtn">${addLabels[tab]}</button>` : ""}</div>${tables[tab]}</section>
      <section class="card pad">
        <h2>CSV import</h2><p class="hint">Paste CSV with headers, or use the manual add buttons on the left. Supported CSV entities: patients, services, drugs, suppliers, opening-stock.</p>
        <div class="grid" style="margin-top:12px">
          <div class="field"><label>Entity</label><select id="importEntity"><option value="patients">patients</option><option value="services">services</option><option value="drugs">drugs</option><option value="suppliers">suppliers</option><option value="opening-stock">opening-stock</option></select></div>
          <div class="field"><label>CSV</label><textarea id="importCsv" placeholder="firstName,lastName,dob,gender,mobile,guardianName&#10;Anu,Rao,2021-01-03,F,9876543219,Ramesh Rao"></textarea></div>
          <button class="btn" id="runImport">Run import</button>
          ${state.data.importJobs[0] ? `<div class="hint">Last import: ${state.data.importJobs[0].imported} imported, ${state.data.importJobs[0].failed} failed.</div>` : ""}
        </div>
      </section>
    </div>`;
}

function bindMasters() {
  document.querySelectorAll("[data-master-tab]").forEach((b) => b.addEventListener("click", () => { state.masterTab = b.dataset.masterTab; render(); }));
  byId("addMasterBtn")?.addEventListener("click", () => openMasterDialog(state.masterTab));
  byId("runImport")?.addEventListener("click", async () => {
    const entity = byId("importEntity").value;
    const csv = byId("importCsv").value;
    const job = await mutate(`/api/import/${entity}`, { method: "POST", body: JSON.stringify({ csv }) }, "Import complete");
    if (job.failed) showToast("Import completed with errors", `${job.failed} rows failed. Check Reports/audit and latest job data.`);
  });
}

function openMasterDialog(tab) {
  const forms = {
    services: {
      title: "Add service",
      endpoint: "/api/admin/services",
      success: "Service added",
      body: `<form id="masterForm" class="grid cols-2">${field("code", "Code", "text", true)}${field("name", "Service name", "text", true)}${field("category", "Category", "text", false, "OPD")}${field("rate", "Rate", "number", true, "0")}${field("gst", "GST %", "number", false, "0")}</form>`
    },
    drugs: {
      title: "Add drug",
      endpoint: "/api/admin/drugs",
      success: "Drug added",
      body: `<form id="masterForm" class="grid cols-2">${field("name", "Drug name", "text", true)}${field("form", "Form", "text", false, "Syrup")}${field("pack", "Pack", "text", false, "60 ml")}${field("hsn", "HSN", "text")}${field("mrp", "MRP", "number", true, "0")}${field("gst", "GST %", "number", false, "12")}${field("reorderLevel", "Low-stock alert qty", "number", false, "10")}</form>`
    },
    suppliers: {
      title: "Add supplier",
      endpoint: "/api/admin/suppliers",
      success: "Supplier added",
      body: `<form id="masterForm" class="grid cols-2">${field("name", "Supplier name", "text", true)}${field("gstin", "GSTIN", "text")}${field("phone", "Phone", "tel")}${field("city", "City", "text", false, "Guntur")}</form>`
    },
    users: {
      title: "Add account",
      endpoint: "/api/admin/users",
      success: "Account added",
      body: `<form id="masterForm" class="grid cols-2">${field("name", "Account name", "text", true)}<div class="field"><label>Role *</label><select name="role">${Object.keys(state.data.roles).map((r) => `<option value="${r}">${title(r)}</option>`).join("")}</select></div>${field("pin", "Temporary PIN", "text", false, "0000")}</form>`
    },
    stock: {
      title: "Add opening stock",
      endpoint: "/api/admin/opening-stock",
      success: "Opening stock added",
      body: `<form id="masterForm" class="grid cols-2"><div class="field"><label>Drug *</label><select name="drugId">${state.data.drugs.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select></div>${field("batch", "Batch", "text", true)}${field("expiry", "Expiry", "date", true)}${field("qty", "Quantity", "number", true, "1")}${field("rate", "Purchase rate", "number", true, "0")}${field("mrp", "MRP", "number", false, "0")}</form>`
    }
  };
  const config = forms[tab];
  if (!config) return;
  openDialog(config.title, config.body, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="saveMaster">Save</button>`);
  byId("saveMaster").addEventListener("click", async () => {
    const payload = formValues("masterForm");
    await mutate(config.endpoint, { method: "POST", body: JSON.stringify(payload) }, config.success);
    closeDialog();
  });
}

function settingsHtml() {
  return `
    ${head("Settings", "Local server operations and backups")}
    <div class="page-body grid cols-2">
      <section class="card pad"><h2>Clinic server</h2><p class="hint">Run this app on the clinic LAN server and open it from reception, pharmacy, and doctor-room browsers.</p><div class="grid" style="margin-top:14px">${stat("Current host", location.host, "LAN machines use this server address")}${stat("Data file", "data/clinic.json", "first-pass local persistence")}</div></section>
      <section class="card pad"><h2>Backup</h2><p class="hint">Creates a restorable JSON snapshot in the local backups folder.</p><button class="btn" id="backupBtn" style="margin-top:14px">Create backup now</button></section>
    </div>`;
}

function bindSettings() {
  byId("backupBtn")?.addEventListener("click", async () => {
    const backup = await mutate("/api/backup", { method: "POST", body: "{}" }, "Backup created");
    showToast("Backup created", backup.file);
  });
}

function openPatientDialog() {
  openDialog("Register new patient", `
    <form id="patientForm" class="grid cols-2">
      ${field("firstName", "First name", "text", true)}
      ${field("lastName", "Last name", "text", true)}
      ${field("dob", "Date of birth", "date", true)}
      <div class="field"><label>Gender</label><select name="gender"><option value="M">Boy</option><option value="F">Girl</option></select></div>
      ${field("mobile", "Mobile", "tel", true)}
      ${field("guardianName", "Guardian name", "text", true)}
      ${field("guardianRel", "Guardian relation", "text", false, "S/o")}
      ${field("bloodGroup", "Blood group")}
      <div class="field" style="grid-column:1/-1"><label>Address</label><textarea name="address"></textarea></div>
      <div class="field" style="grid-column:1/-1"><label>Allergies</label><input name="allergies" placeholder="Nil known"></div>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="savePatient">Register</button>`);
  byId("savePatient").addEventListener("click", async () => {
    const payload = formValues("patientForm");
    const p = await mutate("/api/patients", { method: "POST", body: JSON.stringify(payload) }, "Patient registered");
    state.selectedPatientId = p.id;
    closeDialog();
  });
}

function openVisitDialog(patientId) {
  const p = state.data.patients.find((x) => x.id === patientId);
  openDialog(`Start visit - ${p.firstName} ${p.lastName}`, `
    <form id="visitForm" class="grid">
      <div class="grid cols-4">
        ${field("wt", "Weight kg", "number")}
        ${field("ht", "Height cm", "number")}
        ${field("temp", "Temp F", "number")}
        ${field("pulse", "Pulse", "number")}
      </div>
      <div class="grid cols-2">
        <div class="field"><label>Doctor</label><select name="doctorId">${state.data.doctors.filter((d) => d.active).map((d) => `<option value="${d.id}">${escapeHtml(d.name)} - ${rupee(d.consultFee)}</option>`).join("")}</select></div>
        <div class="field"><label>Discount</label><input name="discount" type="number" value="0"></div>
      </div>
      <div class="grid cols-3">
        <div class="field"><label>Service</label><select name="serviceId">${state.data.services.filter((s) => s.active).map((s) => `<option value="${s.id}">${escapeHtml(s.name)} - ${rupee(s.rate)}</option>`).join("")}</select></div>
        <div class="field"><label>Cash</label><input name="cash" type="number" value="400"></div>
        <div class="field"><label>UPI</label><input name="upi" type="number" value="0"></div>
      </div>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="saveVisit">Save visit</button>`);
  byId("saveVisit").addEventListener("click", async () => {
    const f = formValues("visitForm");
    const service = state.data.services.find((s) => s.id === f.serviceId);
    const visit = await mutate("/api/visits", { method: "POST", body: JSON.stringify({
      patientId,
      doctorId: f.doctorId,
      vitals: { wt: f.wt, ht: f.ht, temp: f.temp, pulse: f.pulse },
      items: [{ serviceId: f.serviceId, qty: 1 }],
      discount: f.discount,
      payment: { cash: f.cash, upi: f.upi }
    }) }, `Visit created for ${service.name}`);
    state.selectedVisitId = visit.id;
    closeDialog();
  });
}

function openSaleDialog() {
  openDialog("New pharmacy sale", `
    <form id="saleForm" class="grid">
      <div class="grid cols-2">
        <div class="field"><label>Patient optional</label><select name="patientId"><option value="">Walk-in</option>${state.data.patients.map((p) => `<option value="${p.id}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} - ${p.uhid}</option>`).join("")}</select></div>
        <div class="field"><label>Linked visit optional</label><select name="linkedVisitId"><option value="">None</option>${state.data.visits.filter((v) => v.prescription?.length).map((v) => `<option value="${v.id}">${v.voucherNo} - ${patientName(v.patientId)}</option>`).join("")}</select></div>
      </div>
      <div id="saleRows">${saleRowHtml()}</div>
      <button type="button" class="btn secondary" id="addSaleRow">Add line</button>
      <div class="grid cols-2">${field("cash", "Cash", "number", false, "0")}${field("upi", "UPI", "number", false, "0")}</div>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="saveSale">Save sale</button>`);
  byId("addSaleRow").addEventListener("click", () => byId("saleRows").insertAdjacentHTML("beforeend", saleRowHtml()));
  byId("saveSale").addEventListener("click", async () => {
    const form = byId("saleForm");
    const items = [...form.querySelectorAll("[data-sale-row]")].map((row) => ({ drugId: row.querySelector("[name=drugId]").value, batchId: row.querySelector("[name=batchId]").value, qty: row.querySelector("[name=qty]").value }));
    await mutate("/api/pharmacy/sales", { method: "POST", body: JSON.stringify({ patientId: form.patientId.value, linkedVisitId: form.linkedVisitId.value, items, payment: { cash: form.cash.value, upi: form.upi.value } }) }, "Pharmacy sale saved");
    closeDialog();
  });
}

function openPurchaseDialog() {
  openDialog("New purchase / GRN", `
    <form id="purchaseForm" class="grid">
      <div class="grid cols-2">
        <div class="field"><label>Supplier</label><select name="supplierId">${state.data.suppliers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></div>
        ${field("invoiceNo", "Supplier invoice no.", "text", true)}
      </div>
      <div id="purchaseRows">${purchaseRowHtml()}</div>
      <button type="button" class="btn secondary" id="addPurchaseRow">Add line</button>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="savePurchase">Save GRN</button>`);
  byId("addPurchaseRow").addEventListener("click", () => byId("purchaseRows").insertAdjacentHTML("beforeend", purchaseRowHtml()));
  byId("savePurchase").addEventListener("click", async () => {
    const form = byId("purchaseForm");
    const items = [...form.querySelectorAll("[data-purchase-row]")].map((row) => Object.fromEntries([...row.querySelectorAll("input,select")].map((el) => [el.name, el.value])));
    await mutate("/api/pharmacy/purchases", { method: "POST", body: JSON.stringify({ supplierId: form.supplierId.value, invoiceNo: form.invoiceNo.value, items }) }, "Purchase saved");
    closeDialog();
  });
}

function openReturnDialog() {
  const sale = state.data.pharmacySales[0];
  if (!sale) return showToast("No sale available", "Create a pharmacy sale before recording a sales return.");
  openDialog("New sales return", `
    <form id="returnForm" class="grid">
      <div class="field"><label>Sale</label><select name="saleId">${state.data.pharmacySales.map((s) => `<option value="${s.id}">${s.voucherNo} - ${rupee(s.total)}</option>`).join("")}</select></div>
      <div class="field"><label>Reason</label><input name="reason" value="Returned by patient"></div>
      <p class="hint">First implementation returns one unit of the first item from the selected sale.</p>
    </form>`, `<button class="btn secondary" data-close>Cancel</button><button class="btn" id="saveReturn">Save return</button>`);
  byId("saveReturn").addEventListener("click", async () => {
    const selected = state.data.pharmacySales.find((s) => s.id === byId("returnForm").saleId.value);
    const first = selected.items[0];
    await mutate("/api/pharmacy/returns", { method: "POST", body: JSON.stringify({ saleId: selected.id, reason: byId("returnForm").reason.value, items: [{ drugId: first.drugId, batchId: first.batchId, qty: 1 }] }) }, "Return saved");
    closeDialog();
  });
}

function openReceipt(kind, id) {
  const record = kind === "sale" ? state.data.pharmacySales.find((s) => s.id === id) : state.data.visits.find((v) => v.id === id);
  if (!record) return;
  const patient = record.patientId ? state.data.patients.find((p) => p.id === record.patientId) : null;
  const items = kind === "prescription" ? record.prescription || [] : record.items || [];
  openDialog(kind === "prescription" ? "Prescription" : "Receipt", `
    <div class="receipt">
      <h2>${escapeHtml(state.data.meta.clinicName)}</h2>
      <p class="small muted" style="text-align:center">${escapeHtml(state.data.meta.clinicSubtitle)}<br>${escapeHtml(state.data.meta.address)} - ${escapeHtml(state.data.meta.phone)}</p>
      <hr>
      <div class="grid cols-2 small"><div><strong>${kind === "prescription" ? "Visit" : "Voucher"}:</strong> ${record.voucherNo}</div><div class="right"><strong>Date:</strong> ${fmtDate(record.date)}</div>${patient ? `<div><strong>Patient:</strong> ${escapeHtml(patient.firstName)} ${escapeHtml(patient.lastName)}</div><div class="right"><strong>UHID:</strong> ${patient.uhid}</div>` : ""}</div>
      <table style="margin-top:14px"><thead><tr><th>Name</th><th class="right">Qty/Days</th><th class="right">${kind === "prescription" ? "Dose" : "Rate"}</th></tr></thead><tbody>${items.map((it) => `<tr><td>${escapeHtml(it.name)}</td><td class="right">${it.qty || it.days || ""}</td><td class="right">${kind === "prescription" ? escapeHtml([it.dose, it.frequency].filter(Boolean).join(" ")) : rupee(it.rate)}</td></tr>`).join("")}</tbody></table>
      ${kind !== "prescription" ? `<h2 class="right" style="margin-top:18px">Total ${rupee(record.total)}</h2>` : `<p style="margin-top:18px"><strong>Notes:</strong> ${escapeHtml(record.notes || "")}</p>`}
    </div>`, `<button class="btn secondary" data-close>Close</button><button class="btn" onclick="window.print()">Print</button>`);
}

async function mutate(url, options, success) {
  try {
    const result = await api(url, options);
    await load();
    showToast(success, "");
    return result;
  } catch (error) {
    showToast("Could not save", error.message);
    throw error;
  }
}

function openDialog(titleText, body, foot) {
  document.body.insertAdjacentHTML("beforeend", `<div class="modal" id="modal"><div class="dialog"><div class="dialog-head"><h2>${escapeHtml(titleText)}</h2><button class="btn ghost" data-close>Close</button></div><div class="dialog-body">${body}</div><div class="dialog-foot">${foot}</div></div></div>`);
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeDialog));
}
function closeDialog() { byId("modal")?.remove(); }
function showToast(titleText, body) { state.toast = { title: titleText, body }; render(); setTimeout(() => { state.toast = null; render(); }, 2600); }

function head(titleText, hint, right = "") { return `<div class="page-head"><div><h1>${titleText}</h1><p class="hint">${hint}</p></div><div class="spacer"></div><div class="toolbar">${right}</div></div>`; }
function stat(label, value, sub) { return `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-sub">${sub || ""}</div></div>`; }
function patientListItem(p, active) { return `<button class="list-item ${active ? "active" : ""}" data-patient="${p.id}"><strong>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</strong>${p.allergies && p.allergies !== "Nil known" ? ` <span class="badge rose">${escapeHtml(p.allergies)}</span>` : ""}<div class="hint mono">${p.uhid}</div><div class="hint">${age(p.dob)} - ${p.gender === "M" ? "Boy" : "Girl"} - ${escapeHtml(p.guardian.name)} - ${p.mobile}</div></button>`; }
function patientText(p) { return `${p.uhid} ${p.firstName} ${p.lastName} ${p.mobile} ${p.guardian.name}`.toLowerCase(); }
function visitQueueItem(v, active) { const p = state.data.patients.find((x) => x.id === v.patientId); return `<button class="list-item ${active ? "active" : ""}" data-visit="${v.id}"><strong>${patientName(v.patientId)}</strong> <span class="badge ${v.status === "done" ? "green" : v.status === "waiting" ? "amber" : "teal"}">${v.status}</span><div class="hint mono">${v.voucherNo}</div><div class="hint">${p ? age(p.dob) : ""} - ${fmtTime(v.date)} - ${rupee(v.total)}</div></button>`; }
function queueTable(rows) { return rows.length ? `<table><thead><tr><th>Patient</th><th>Status</th><th>Time</th></tr></thead><tbody>${rows.map((v) => `<tr><td>${patientName(v.patientId)}<div class="hint mono">${v.voucherNo}</div></td><td><span class="badge amber">${v.status}</span></td><td>${fmtTime(v.date)}</td></tr>`).join("")}</tbody></table>` : empty("No active queue"); }
function clinicalFormHtml(v) { return `<h2>${patientName(v.patientId)} <span class="badge ${v.status === "done" ? "green" : "teal"}">${v.status}</span></h2><p class="hint mono">${v.voucherNo}</p><form id="clinicalVitals" class="grid cols-4" style="margin-top:14px">${field("wt", "Weight kg", "number", false, v.vitals?.wt || "")}${field("ht", "Height cm", "number", false, v.vitals?.ht || "")}${field("temp", "Temp F", "number", false, v.vitals?.temp || "")}${field("pulse", "Pulse", "number", false, v.vitals?.pulse || "")}</form><div class="field" style="margin-top:12px"><label>Notes</label><textarea id="clinicalNotes">${escapeHtml(v.notes || "")}</textarea></div><div class="toolbar" style="margin-top:14px"><h3>Prescription</h3><button class="btn secondary" id="addRx">Add drug</button></div><div id="rxRows" class="grid">${(v.prescription || []).map(rxRowHtml).join("") || rxRowHtml({})}</div><div class="toolbar" style="margin-top:14px"><select id="visitStatus" style="width:auto"><option value="in-consult" ${v.status === "in-consult" ? "selected" : ""}>In consult</option><option value="done" ${v.status === "done" ? "selected" : ""}>Done</option><option value="waiting" ${v.status === "waiting" ? "selected" : ""}>Waiting</option></select><button class="btn" id="saveClinical">Save clinical</button><button class="btn secondary" id="printPrescription">Print prescription</button></div>`; }
function rxRowHtml(r = {}) { return `<div data-rx-row class="grid cols-5"><div class="field"><label>Drug</label><select name="drugId"><option value="">Text only</option>${state.data.drugs.map((d) => `<option value="${d.id}" ${r.drugId === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}</select></div><div class="field"><label>Dose</label><input name="dose" value="${escapeHtml(r.dose || "")}"></div><div class="field"><label>Frequency</label><input name="frequency" value="${escapeHtml(r.frequency || "")}"></div><div class="field"><label>Days</label><input name="days" type="number" value="${r.days || ""}"></div><div class="field"><label>Qty</label><input name="qty" type="number" value="${r.qty || 1}"></div></div>`; }
function saleRowHtml() { return `<div data-sale-row class="grid cols-3" style="margin-bottom:10px"><div class="field"><label>Drug</label><select name="drugId">${state.data.drugs.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select></div><div class="field"><label>Batch</label><select name="batchId">${state.data.stockRows.filter((b) => b.qty > 0).map((b) => `<option value="${b.id}">${escapeHtml(b.drugName)} - ${b.batch} - ${b.qty} left - exp ${fmtDate(b.expiry)}</option>`).join("")}</select></div><div class="field"><label>Qty</label><input name="qty" type="number" value="1" min="1"></div></div>`; }
function purchaseRowHtml() { return `<div data-purchase-row class="grid cols-6" style="margin-bottom:10px"><div class="field"><label>Drug</label><select name="drugId">${state.data.drugs.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join("")}</select></div><div class="field"><label>Batch</label><input name="batch" required></div><div class="field"><label>Expiry</label><input name="expiry" type="date" required></div><div class="field"><label>Qty</label><input name="qty" type="number" value="1"></div><div class="field"><label>Rate</label><input name="rate" type="number" value="0"></div><div class="field"><label>MRP</label><input name="mrp" type="number" value="0"></div></div>`; }
function invoiceTable(rows) { return rows.length ? `<table><thead><tr><th>Voucher</th><th>Kind</th><th>Party</th><th>Date</th><th class="right">Cash</th><th class="right">UPI</th><th class="right">Total</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="mono">${r.voucherNo}</td><td><span class="badge teal">${r.kind}</span></td><td>${patientName(r.partyId) || "Walk-in"}</td><td>${fmtDateTime(r.date)}</td><td class="right mono">${r.paid?.cash ? rupee(r.paid.cash) : "-"}</td><td class="right mono">${r.paid?.upi ? rupee(r.paid.upi) : "-"}</td><td class="right mono"><strong>${rupee(r.total)}</strong></td></tr>`).join("")}</tbody></table>` : empty("No invoices"); }
function visitTable(rows) { return rows.length ? `<table><thead><tr><th>Voucher</th><th>Date</th><th>Status</th><th class="right">Total</th><th></th></tr></thead><tbody>${rows.map((v) => `<tr><td class="mono">${v.voucherNo}</td><td>${fmtDateTime(v.date)}</td><td><span class="badge">${v.status}</span></td><td class="right">${rupee(v.total)}</td><td class="right"><button class="btn secondary" data-print-visit="${v.id}">Print</button></td></tr>`).join("")}</tbody></table>` : empty("No visits yet"); }
function salesTable(rows) { return rows.length ? `<table><thead><tr><th>Voucher</th><th>Patient</th><th>Items</th><th class="right">Total</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td class="mono">${s.voucherNo}</td><td>${patientName(s.patientId) || "Walk-in"}</td><td>${s.items.map((i) => i.name).join(", ")}</td><td class="right">${rupee(s.total)}</td><td class="right"><button class="btn secondary" data-print-sale="${s.id}">Print</button></td></tr>`).join("")}</tbody></table>` : empty("No pharmacy sales yet"); }
function purchaseTable(rows) { return rows.length ? `<table><thead><tr><th>GRN</th><th>Supplier</th><th>Invoice</th><th>Items</th><th class="right">Total</th></tr></thead><tbody>${rows.map((p) => `<tr><td class="mono">${p.voucherNo}</td><td>${supplierName(p.supplierId)}</td><td>${escapeHtml(p.invoiceNo)}</td><td>${p.items.length}</td><td class="right">${rupee(p.total)}</td></tr>`).join("")}</tbody></table>` : empty("No purchases yet"); }
function stockTable(rows) { return `<table><thead><tr><th>Drug</th><th>Batch</th><th>Expiry</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Value</th><th>Alert</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.drugName)}</td><td class="mono">${r.batch}</td><td>${fmtDate(r.expiry)}</td><td class="right mono">${r.qty}</td><td class="right">${rupee(r.purchaseRate)}</td><td class="right">${rupee(r.value)}</td><td>${r.qty <= r.reorderLevel ? `<span class="badge amber">Low stock</span>` : ""} ${r.daysToExpiry <= 45 ? `<span class="badge rose">Expiring</span>` : ""}</td></tr>`).join("")}</tbody></table>`; }
function stockAlertTable(rows) { return rows.length ? stockTable(rows) : empty("No stock alerts"); }
function returnTable(rows) { return rows.length ? `<table><thead><tr><th>Voucher</th><th>Sale</th><th>Reason</th><th class="right">Amount</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.voucherNo}</td><td>${r.saleId}</td><td>${escapeHtml(r.reason)}</td><td class="right">${rupee(r.amount)}</td></tr>`).join("")}</tbody></table>` : empty("No returns yet"); }
function auditTable(rows) { return rows.length ? `<table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>${rows.map((a) => `<tr><td>${fmtDateTime(a.at)}</td><td>${userName(a.userId)}</td><td>${a.action}</td><td>${a.entity}</td><td class="small">${escapeHtml(JSON.stringify(a.details))}</td></tr>`).join("")}</tbody></table>` : empty("No audit events yet"); }
function simpleTable(rows, fields) { return `<table><thead><tr>${fields.map((f) => `<th>${title(f)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${fields.map((f) => `<td>${escapeHtml(String(row[f] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`; }
function patientMasterTable(rows) { return `<table><thead><tr><th>UHID</th><th>Name</th><th>Mobile</th><th>Guardian</th></tr></thead><tbody>${rows.map((p) => `<tr><td class="mono">${p.uhid}</td><td>${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}</td><td>${p.mobile}</td><td>${escapeHtml(p.guardian.name)}</td></tr>`).join("")}</tbody></table>`; }

function field(name, label, type = "text", required = false, value = "") { return `<div class="field"><label>${label}${required ? " *" : ""}</label><input name="${name}" type="${type}" value="${escapeHtml(String(value))}" ${required ? "required" : ""}></div>`; }
function formValues(formId) { const form = byId(formId); return Object.fromEntries([...form.querySelectorAll("input,select,textarea")].map((el) => [el.name || el.id, el.value])); }
function byId(id) { return document.getElementById(id); }
function empty(text) { return `<div class="empty">${text}</div>`; }
function rupee(n) { return INR.format(Number(n) || 0); }
function sum(rows, fieldName) { return rows.reduce((s, r) => s + (Number(r[fieldName]) || 0), 0); }
function sameDay(date) { return new Date(date).toDateString() === new Date().toDateString(); }
function fmtDate(date) { return new Date(date).toLocaleDateString("en-IN"); }
function fmtTime(date) { return new Date(date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); }
function fmtDateTime(date) { return `${fmtDate(date)} ${fmtTime(date)}`; }
function patientName(id) { const p = state.data.patients.find((x) => x.id === id); return p ? `${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)}` : ""; }
function supplierName(id) { return escapeHtml(state.data.suppliers.find((s) => s.id === id)?.name || ""); }
function userName(id) { return escapeHtml(state.data.users.find((u) => u.id === id)?.name || id || ""); }
function title(s) { return String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function age(dob) { const ms = Date.now() - new Date(dob); const y = Math.floor(ms / 31557600000); if (y > 0) return `${y}y`; return `${Math.max(0, Math.floor(ms / 2629800000))}m`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function saveValue(key, value) { sessionStorage.setItem(`charaka.${key}`, value); }
function getValue(key, fallback) { return sessionStorage.getItem(`charaka.${key}`) ?? fallback; }
