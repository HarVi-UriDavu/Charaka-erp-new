export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const iso = (d) => d.toISOString();
const addDays = (n) => {
  const d = today();
  d.setDate(d.getDate() + n);
  return d;
};
const at = (hour, minute = 0, delta = 0) => {
  const d = addDays(delta);
  d.setHours(hour, minute, 0, 0);
  return d;
};

export function createSeedData() {
  return {
    meta: {
      clinicName: "Prof. D. Rama Kotaiah",
      clinicSubtitle: "Children's Clinic & Vaccination Centre",
      address: "D.No 5-21-7, Kothapet Main Road, Guntur - 522001",
      phone: "+91 863 222 4477",
      email: "charaka.clinic@gmail.com",
      gstin: "37AHDPT3692H1ZW",
      drugLicenseNo20: "RLF20AP2025001241",
      drugLicenseNo21: "RFL21AP2025001236",
      regNo: "AP/GNT/PVT/2009/00342",
      financialYear: "26",
      createdAt: iso(new Date())
    },
    sequences: {
      patient: 240,
      opd: 25,
      pharmacy: 123,
      purchase: 46,
      return: 8,
      invoice: 200,
      audit: 1,
      stock: 1,
      importJob: 1
    },
    roles: {
      doctor: ["dashboard", "clinical", "reception", "reports"],
      reception: ["dashboard", "reception", "billing"],
      pharmacist: ["dashboard", "pharmacy", "billing"],
      admin: ["dashboard", "reception", "clinical", "pharmacy", "billing", "reports", "masters", "settings"]
    },
    users: [
      { id: "U01", name: "Dr. D. Rama Kotaiah", role: "doctor", pin: "1111", active: true },
      { id: "U02", name: "Reception", role: "reception", pin: "2222", active: true },
      { id: "U03", name: "Pharmacy", role: "pharmacist", pin: "3333", active: true },
      { id: "U04", name: "Admin", role: "admin", pin: "4444", active: true }
    ],
    doctors: [
      { id: "D01", name: "Dr. D. Rama Kotaiah", qualification: "MD Pediatrics", regNo: "APMC 12831", consultFee: 400, followUpFee: 200, active: true },
      { id: "D02", name: "Dr. S. Anusha", qualification: "DCH", regNo: "APMC 21444", consultFee: 350, followUpFee: 200, active: true }
    ],
    services: [
      { id: "S01", code: "CONS", name: "Consultation", category: "OPD", rate: 400, gst: 0, active: true },
      { id: "S02", code: "FUP", name: "Follow-up", category: "OPD", rate: 200, gst: 0, active: true },
      { id: "S03", code: "INJ", name: "Injection charges", category: "Procedure", rate: 150, gst: 0, active: true },
      { id: "S04", code: "NEB", name: "Nebulization", category: "Procedure", rate: 300, gst: 0, active: true },
      { id: "S05", code: "CERT", name: "Medical certificate", category: "Admin", rate: 100, gst: 0, active: true },
      { id: "S06", code: "VAC-PENTA", name: "Vaccination (Pentavalent)", category: "Vaccine", rate: 1800, gst: 0, active: true },
      { id: "S07", code: "VAC-MMR", name: "Vaccination (MMR)", category: "Vaccine", rate: 950, gst: 0, active: true }
    ],
    suppliers: [
      { id: "SUP01", name: "Apollo Pharma Distributors", gstin: "37ABCDE1234F1Z5", phone: "9848011122", city: "Guntur", active: true },
      { id: "SUP02", name: "MedPlus Wholesale", gstin: "37AABCM7788K1Z2", phone: "9848022233", city: "Vijayawada", active: true },
      { id: "SUP03", name: "Sai Medical Agencies", gstin: "37SMAAA9988P1Z8", phone: "9848033344", city: "Guntur", active: true }
    ],
    patients: [
      {
        id: "P001",
        uhid: "GCK/26/0001",
        firstName: "Aarav",
        lastName: "Kumar",
        gender: "M",
        dob: "2020-08-14",
        mobile: "9876543210",
        guardian: { rel: "S/o", name: "Suresh Kumar" },
        address: "Kothapet, Guntur",
        bloodGroup: "O+",
        allergies: "Nil known",
        weights: [{ date: iso(at(9, 0, -18)), w: 17.8 }, { date: iso(at(9, 0, -2)), w: 18.1 }]
      },
      {
        id: "P002",
        uhid: "GCK/26/0002",
        firstName: "Maya",
        lastName: "Reddy",
        gender: "F",
        dob: "2022-02-03",
        mobile: "9876501234",
        guardian: { rel: "D/o", name: "Prasad Reddy" },
        address: "Lakshmipuram, Guntur",
        bloodGroup: "B+",
        allergies: "Penicillin",
        weights: [{ date: iso(at(10, 0, -7)), w: 12.3 }]
      },
      {
        id: "P003",
        uhid: "GCK/26/0003",
        firstName: "Ishaan",
        lastName: "Naidu",
        gender: "M",
        dob: "2018-11-22",
        mobile: "9988776655",
        guardian: { rel: "S/o", name: "Ravi Naidu" },
        address: "Brodipet, Guntur",
        bloodGroup: "A+",
        allergies: "Nil known",
        weights: [{ date: iso(at(9, 15, -4)), w: 22.5 }]
      }
    ],
    drugs: [
      { id: "DR01", name: "Paracetamol Syrup", form: "Syrup", pack: "60 ml", hsn: "300490", mrp: 48, gst: 12, reorderLevel: 10, active: true },
      { id: "DR02", name: "Amoxicillin 250 Syrup", form: "Syrup", pack: "30 ml", hsn: "300410", mrp: 88, gst: 12, reorderLevel: 8, active: true },
      { id: "DR03", name: "ORS Sachet", form: "Sachet", pack: "21 g", hsn: "300490", mrp: 22, gst: 5, reorderLevel: 25, active: true },
      { id: "DR04", name: "Zincovit Syrup", form: "Syrup", pack: "200 ml", hsn: "300450", mrp: 175, gst: 12, reorderLevel: 8, active: true },
      { id: "DR05", name: "Cetirizine Drops", form: "Drops", pack: "15 ml", hsn: "300490", mrp: 56, gst: 12, reorderLevel: 8, active: true },
      { id: "DR06", name: "Saline Nasal Drops", form: "Drops", pack: "10 ml", hsn: "300490", mrp: 38, gst: 12, reorderLevel: 10, active: true }
    ],
    drugBatches: [
      { id: "B001", drugId: "DR01", batch: "PCS2410", expiry: iso(addDays(220)), qty: 38, purchaseRate: 38, mrp: 48 },
      { id: "B002", drugId: "DR02", batch: "AMX2503", expiry: iso(addDays(95)), qty: 14, purchaseRate: 66, mrp: 88 },
      { id: "B003", drugId: "DR03", batch: "ORS2403", expiry: iso(addDays(180)), qty: 120, purchaseRate: 16, mrp: 22 },
      { id: "B004", drugId: "DR04", batch: "ZNV2412", expiry: iso(addDays(310)), qty: 18, purchaseRate: 132, mrp: 175 },
      { id: "B005", drugId: "DR05", batch: "CTZ2503", expiry: iso(addDays(28)), qty: 7, purchaseRate: 44, mrp: 56 },
      { id: "B006", drugId: "DR06", batch: "SAL2504", expiry: iso(addDays(380)), qty: 20, purchaseRate: 28, mrp: 38 }
    ],
    visits: [
      {
        id: "V01019",
        voucherNo: "OPD/26/0019",
        patientId: "P001",
        doctorId: "D01",
        date: iso(at(9, 10)),
        status: "done",
        vitals: { wt: 18.1, ht: 110, temp: 99.1, pulse: 92 },
        items: [{ serviceId: "S01", name: "Consultation", rate: 400, qty: 1 }],
        subtotal: 400,
        discount: 0,
        total: 400,
        paid: { mode: "Cash", cash: 400, upi: 0 },
        notes: "Fever for two days. Hydration advised.",
        prescription: [{ drugId: "DR01", name: "Paracetamol Syrup", dose: "5 ml", frequency: "TID", days: 3, qty: 1 }]
      },
      {
        id: "V01020",
        voucherNo: "OPD/26/0020",
        patientId: "P002",
        doctorId: "D01",
        date: iso(at(10, 0)),
        status: "waiting",
        vitals: { wt: 12.3, temp: 98.6 },
        items: [{ serviceId: "S02", name: "Follow-up", rate: 200, qty: 1 }],
        subtotal: 200,
        discount: 0,
        total: 200,
        paid: { mode: "UPI", cash: 0, upi: 200 },
        notes: "",
        prescription: []
      }
    ],
    invoices: [
      { id: "INV001", kind: "OPD", refId: "V01019", voucherNo: "OPD/26/0019", partyId: "P001", date: iso(at(9, 10)), items: [{ name: "Consultation", qty: 1, rate: 400, gst: 0 }], paid: { mode: "Cash", cash: 400, upi: 0 }, total: 400, status: "paid" },
      { id: "INV002", kind: "OPD", refId: "V01020", voucherNo: "OPD/26/0020", partyId: "P002", date: iso(at(10, 0)), items: [{ name: "Follow-up", qty: 1, rate: 200, gst: 0 }], paid: { mode: "UPI", cash: 0, upi: 200 }, total: 200, status: "paid" }
    ],
    pharmacySales: [],
    purchases: [],
    returns: [],
    stockMovements: [
      { id: "SM001", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR01", batchId: "B001", qty: 38, note: "Opening stock" },
      { id: "SM002", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR02", batchId: "B002", qty: 14, note: "Opening stock" },
      { id: "SM003", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR03", batchId: "B003", qty: 120, note: "Opening stock" },
      { id: "SM004", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR04", batchId: "B004", qty: 18, note: "Opening stock" },
      { id: "SM005", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR05", batchId: "B005", qty: 7, note: "Opening stock" },
      { id: "SM006", date: iso(addDays(-1)), kind: "OPENING", refId: "seed", drugId: "DR06", batchId: "B006", qty: 20, note: "Opening stock" }
    ],
    importJobs: [],
    auditLogs: []
  };
}
