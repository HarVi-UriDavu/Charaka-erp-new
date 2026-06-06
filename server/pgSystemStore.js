import crypto from "node:crypto";
import { httpError } from "./store.js";

const pad = (n, w = 4) => String(n).padStart(w, "0");

export class PgSystemStore {
  constructor(db) {
    this.db = db;
  }

  async nextSeq(key) {
    const result = await this.db.query(
      `insert into sequences (key, value)
       values ($1, 1)
       on conflict (key) do update set value = sequences.value + 1
       returning value`,
      [key]
    );
    return Number(result.rows[0].value);
  }

  async audit(userId, action, entity, entityId, details = {}) {
    const id = `AUD${pad(await this.nextSeq("audit"), 6)}`;
    await this.db.query(
      `insert into audit_logs (id, user_id, action, entity, entity_id, details)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, userId, action, entity, entityId, JSON.stringify(details)]
    );
    return id;
  }

  async requireUser(userId) {
    const result = await this.db.query(
      `select id, name, role_id as role, active
       from users
       where id = $1 and active = true`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw httpError(401, "Unknown or inactive user");
    return user;
  }

  async requireAdmin(userId) {
    const user = await this.requireUser(userId);
    if (user.role !== "admin") throw httpError(403, "Only admin can change master data");
    return user;
  }

  async login(input) {
    const userId = required(input.userId, "userId");
    const pin = String(input.pin || "");
    const result = await this.db.query(
      `select id, name, role_id as role, pin_hash
       from users
       where id = $1 and active = true`,
      [userId]
    );
    const user = result.rows[0];
    if (!user || user.pin_hash !== hashPin(pin)) throw httpError(401, "Invalid account or PIN");
    await this.audit(user.id, "LOGIN", "user", user.id, {});
    return { userId: user.id, name: user.name, role: user.role };
  }

  async roles() {
    const result = await this.db.query(
      `select role_id, permission_id
       from role_permissions
       order by role_id, permission_id`
    );
    return result.rows.reduce((roles, row) => {
      roles[row.role_id] ||= [];
      roles[row.role_id].push(row.permission_id);
      return roles;
    }, {});
  }

  async users() {
    const result = await this.db.query(
      `select id, name, role_id as role, active
       from users
       order by id`
    );
    return result.rows;
  }

  async clinicSettings() {
    const result = await this.db.query(
      `select value
       from app_settings
       where key = 'clinic'`
    );
    return result.rows[0]?.value || {};
  }

  async updateClinicSettings(input, userId = "U04") {
    await this.requireAdmin(userId);
    const current = await this.clinicSettings();
    const next = { ...current };
    for (const key of clinicSettingKeys) {
      if (input[key] !== undefined) next[key] = String(input[key]).trim();
    }
    if (!next.clinicName) throw httpError(400, "Clinic name is required");
    if (!/^\d{2}$/.test(next.financialYear || "")) throw httpError(400, "Financial year must be two digits, like 26");
    await this.db.query(
      `insert into app_settings (key, value)
       values ('clinic', $1)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify(next)]
    );
    await this.audit(userId, "UPDATE", "settings", "clinic", {
      fields: Object.keys(input).filter((key) => clinicSettingKeys.includes(key))
    });
    return next;
  }

  async snapshotSystem() {
    return {
      meta: await this.clinicSettings(),
      roles: await this.roles(),
      users: await this.users()
    };
  }
}

export function hashPin(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
}

const clinicSettingKeys = [
  "clinicName",
  "clinicSubtitle",
  "address",
  "phone",
  "email",
  "gstin",
  "drugLicenseNo20",
  "drugLicenseNo21",
  "regNo",
  "financialYear"
];

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") throw httpError(400, `${field} is required`);
  return String(value).trim();
}
