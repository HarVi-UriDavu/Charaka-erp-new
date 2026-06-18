import { PgSystemStore } from "./pgSystemStore.js";
import { httpError } from "./store.js";

const pad = (n, width = 6) => String(n).padStart(width, "0");

export class PgMessagingStore {
  constructor(db, system = new PgSystemStore(db)) {
    this.db = db;
    this.system = system;
  }

  async queueDocument(documentKind, refId, patientId, userId = "U04") {
    if (!patientId) return null;
    const patient = await this.patientMessaging(patientId);
    const templateName = "charaka_document";
    const idempotencyKey = `document:${documentKind}:${refId}:v1`;
    return this.insertOutbox({
      patient,
      kind: "document",
      templateName,
      refType: documentKind === "pharmacy_invoice" ? "pharmacy_sale" : "visit",
      refId,
      documentKind,
      idempotencyKey,
      payload: { documentKind, refId },
      scheduledFor: new Date().toISOString(),
      userId
    });
  }

  async scheduleFollowUp(visitId, patientId, dueDate, reason, userId = "U01") {
    await this.db.query(`delete from reminder_jobs where ref_type = 'visit' and ref_id = $1 and kind = 'followup' and status = 'pending'`, [visitId]);
    if (!dueDate) return [];
    return [await this.insertReminder({
      patientId,
      kind: "followup",
      refType: "visit",
      refId: visitId,
      dueDate,
      offsetDays: 1,
      payload: { reason: reason || "" },
      userId
    })];
  }

  async scheduleVaccination(vaccinationId, patientId, nextDueDate, nextVaccineId, userId = "U04") {
    if (!nextDueDate || !nextVaccineId) return [];
    const jobs = [];
    for (const offsetDays of [7, 1]) {
      jobs.push(await this.insertReminder({
        patientId,
        kind: "vaccine",
        refType: "vaccination",
        refId: vaccinationId,
        dueDate: nextDueDate,
        offsetDays,
        payload: { nextVaccineId },
        userId
      }));
    }
    return jobs;
  }

  async processDueReminders(limit = 50) {
    const result = await this.db.query(
      `select id, patient_id as "patientId", kind, ref_type as "refType", ref_id as "refId",
              due_date as "dueDate", offset_days as "offsetDays"
       from reminder_jobs
       where status = 'pending' and remind_at <= now()
       order by remind_at
       limit $1`,
      [limit]
    );
    const queued = [];
    for (const job of result.rows) {
      const patient = await this.patientMessaging(job.patientId);
      const outbox = await this.insertOutbox({
        patient,
        kind: job.kind === "followup" ? "followup_reminder" : "vaccine_reminder",
        templateName: job.kind === "followup" ? "charaka_followup_reminder" : "charaka_vaccine_reminder",
        refType: job.refType,
        refId: job.refId,
        documentKind: null,
        idempotencyKey: `reminder:${job.kind}:${job.refId}:${job.offsetDays}`,
        payload: { dueDate: dateOnly(job.dueDate), offsetDays: Number(job.offsetDays) },
        scheduledFor: new Date().toISOString(),
        userId: null
      });
      await this.db.query(
        `update reminder_jobs
         set status = $2, outbox_id = $3, updated_at = now()
         where id = $1`,
        [job.id, outbox.status === "queued" ? "queued" : "failed", outbox.id]
      );
      queued.push(outbox);
    }
    return queued;
  }

  async listOutbox(limit = 100) {
    const result = await this.db.query(
      `select id, patient_id as "patientId", phone, language, kind, template_name as "templateName",
              ref_type as "refType", ref_id as "refId", document_kind as "documentKind",
              idempotency_key as "idempotencyKey", payload, scheduled_for as "scheduledFor",
              status, attempts, external_id as "externalId", last_error as "lastError",
              created_at as "createdAt", updated_at as "updatedAt"
       from whatsapp_outbox
       order by created_at desc
       limit $1`,
      [limit]
    );
    return result.rows;
  }

  async pendingOutbound(limit = 20) {
    const result = await this.db.query(
      `select id, patient_id as "patientId", phone, language, kind, template_name as "templateName",
              ref_type as "refType", ref_id as "refId", document_kind as "documentKind",
              payload, scheduled_for as "scheduledFor", attempts
       from whatsapp_outbox
       where status in ('queued', 'failed')
         and scheduled_for <= now()
         and attempts < 5
       order by scheduled_for, created_at
       limit $1`,
      [limit]
    );
    return result.rows;
  }

  async markRelaySubmitted(id, externalId) {
    const result = await this.db.query(
      `update whatsapp_outbox
       set status = 'sent', external_id = $2, attempts = attempts + 1, last_error = '', updated_at = now()
       where id = $1
       returning *`,
      [id, externalId || null]
    );
    return result.rows[0] || null;
  }

  async markRelayFailure(id, message) {
    const result = await this.db.query(
      `update whatsapp_outbox
       set status = 'failed', attempts = attempts + 1, last_error = $2,
           scheduled_for = now() + make_interval(mins => least(60, power(2, attempts + 1)::int)),
           updated_at = now()
       where id = $1
       returning *`,
      [id, String(message || "Relay request failed").slice(0, 1000)]
    );
    return result.rows[0] || null;
  }

  async applyRelayEvent(event) {
    const type = String(event.type || "");
    if (type === "callback_requested") return this.createCallback(event);
    if (type === "opt_out" || type === "opt_in") return this.setOptOut(event.phone, type === "opt_out");
    if (type === "document_requested" || type === "child_document_requested") return this.handleDocumentRequest(event);
    const allowed = new Set(["sent", "delivered", "read", "failed"]);
    if (!allowed.has(type)) return null;
    const outbox = await this.findOutbox(event);
    if (!outbox) return null;
    await this.db.query(
      `insert into whatsapp_delivery_events (outbox_id, external_id, event_type, event_at, payload)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [outbox.id, event.externalId || outbox.external_id || null, type, event.at || new Date().toISOString(), JSON.stringify(event)]
    );
    await this.db.query(
      `update whatsapp_outbox
       set status = $2, external_id = coalesce($3, external_id), last_error = $4, updated_at = now()
       where id = $1`,
      [outbox.id, type, event.externalId || null, type === "failed" ? String(event.error || "Delivery failed") : ""]
    );
    return { id: outbox.id, status: type };
  }

  async relayCursor() {
    const result = await this.db.query(`select value from app_settings where key = 'whatsapp_relay_cursor'`);
    return String(result.rows[0]?.value?.cursor || "0");
  }

  async setRelayCursor(cursor) {
    await this.db.query(
      `insert into app_settings (key, value)
       values ('whatsapp_relay_cursor', $1)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [JSON.stringify({ cursor: String(cursor || "0") })]
    );
  }

  async resend(id, userId = "U04") {
    await this.system.requireUser(userId);
    const result = await this.db.query(`select * from whatsapp_outbox where id = $1`, [id]);
    const source = result.rows[0];
    if (!source) throw httpError(404, "WhatsApp message not found");
    const patient = source.patient_id ? await this.patientMessaging(source.patient_id) : {
      id: null,
      mobile: source.phone,
      whatsapp_language: source.language,
      whatsapp_consent: true,
      whatsapp_opted_out: false,
      whatsapp_number_confirmed: true
    };
    const seq = await this.system.nextSeq("whatsapp");
    return this.insertOutbox({
      patient,
      kind: source.kind,
      templateName: source.template_name,
      refType: source.ref_type,
      refId: source.ref_id,
      documentKind: source.document_kind,
      idempotencyKey: `${source.idempotency_key}:resend:${seq}`,
      payload: { ...(source.payload || {}), resendOf: source.id },
      scheduledFor: new Date().toISOString(),
      userId,
      fixedId: `WA${pad(seq)}`
    });
  }

  async callbacks(limit = 100) {
    const result = await this.db.query(
      `select id, patient_id as "patientId", phone, language, status, source_message_id as "sourceMessageId",
              notes, requested_at as "requestedAt", handled_by as "handledBy", handled_at as "handledAt"
       from callback_requests
       order by requested_at desc
       limit $1`,
      [limit]
    );
    return result.rows;
  }

  async closeCallback(id, userId = "U02") {
    await this.system.requireUser(userId);
    const result = await this.db.query(
      `update callback_requests
       set status = 'closed', handled_by = $2, handled_at = now()
       where id = $1
       returning id, status`,
      [id, userId]
    );
    if (!result.rows[0]) throw httpError(404, "Callback request not found");
    await this.system.audit(userId, "UPDATE", "callback_request", id, { status: "closed" });
    return result.rows[0];
  }

  async updatePatientConsent(patientId, input, userId = "U02") {
    await this.system.requireUser(userId);
    const consent = Boolean(input.whatsappConsent);
    const language = input.whatsappLanguage === "te" ? "te" : "en";
    const confirmed = Boolean(input.whatsappNumberConfirmed);
    const result = await this.db.query(
      `update patients
       set whatsapp_consent = $2,
           whatsapp_consent_at = case when $2 then coalesce(whatsapp_consent_at, now()) else null end,
           whatsapp_consent_by = case when $2 then $3 else null end,
           whatsapp_language = $4,
           whatsapp_number_confirmed = $5,
           updated_at = now()
       where id = $1
       returning id, whatsapp_consent as "whatsappConsent", whatsapp_consent_at as "whatsappConsentAt",
                 whatsapp_language as "whatsappLanguage", whatsapp_opted_out as "whatsappOptedOut",
                 whatsapp_number_confirmed as "whatsappNumberConfirmed"`,
      [patientId, consent, userId, language, confirmed]
    );
    if (!result.rows[0]) throw httpError(404, "Patient not found");
    if (consent && confirmed && !result.rows[0].whatsappOptedOut) {
      await this.db.query(
        `update whatsapp_outbox
         set status = 'queued', scheduled_for = now(), updated_at = now()
         where patient_id = $1 and status = 'blocked_no_consent'`,
        [patientId]
      );
    }
    await this.system.audit(userId, "UPDATE", "patient_whatsapp", patientId, { consent, language, confirmed });
    return result.rows[0];
  }

  async patientMessaging(patientId) {
    const result = await this.db.query(
      `select id, mobile, whatsapp_consent, whatsapp_language, whatsapp_opted_out, whatsapp_number_confirmed
       from patients
       where id = $1 and active = true`,
      [patientId]
    );
    const patient = result.rows[0];
    if (!patient) throw httpError(404, "Patient not found");
    return patient;
  }

  async insertOutbox({ patient, kind, templateName, refType, refId, documentKind, idempotencyKey, payload, scheduledFor, userId, fixedId }) {
    const status = messageStatus(patient);
    const id = fixedId || `WA${pad(await this.system.nextSeq("whatsapp"))}`;
    const result = await this.db.query(
      `insert into whatsapp_outbox
         (id, patient_id, phone, language, kind, template_name, ref_type, ref_id, document_kind,
          idempotency_key, payload, scheduled_for, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (idempotency_key) do update set updated_at = whatsapp_outbox.updated_at
       returning id, patient_id as "patientId", phone, language, kind, template_name as "templateName",
                 ref_type as "refType", ref_id as "refId", document_kind as "documentKind",
                 idempotency_key as "idempotencyKey", payload, scheduled_for as "scheduledFor",
                 status, attempts, external_id as "externalId", last_error as "lastError",
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [id, patient.id || null, patient.mobile, patient.whatsapp_language || "en", kind, templateName, refType, refId, documentKind || null, idempotencyKey, JSON.stringify(payload || {}), scheduledFor, status, userId]
    );
    return result.rows[0];
  }

  async insertReminder({ patientId, kind, refType, refId, dueDate, offsetDays, payload, userId }) {
    const idempotencyKey = `schedule:${kind}:${refId}:${offsetDays}:${dateOnly(dueDate)}`;
    const id = `REM${pad(await this.system.nextSeq("reminder"))}`;
    const remindAt = reminderTime(dueDate, offsetDays);
    const result = await this.db.query(
      `insert into reminder_jobs
         (id, patient_id, kind, ref_type, ref_id, due_date, remind_at, offset_days, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (idempotency_key) do update set remind_at = excluded.remind_at, due_date = excluded.due_date, updated_at = now()
       returning id, patient_id as "patientId", kind, ref_type as "refType", ref_id as "refId",
                 due_date as "dueDate", remind_at as "remindAt", offset_days as "offsetDays", status`,
      [id, patientId, kind, refType, refId, dueDate, remindAt, offsetDays, idempotencyKey]
    );
    await this.system.audit(userId, "CREATE", "reminder_job", result.rows[0].id, { kind, dueDate: dateOnly(dueDate), offsetDays, ...payload });
    return result.rows[0];
  }

  async findOutbox(event) {
    const result = event.outboxId
      ? await this.db.query(`select * from whatsapp_outbox where id = $1`, [event.outboxId])
      : await this.db.query(`select * from whatsapp_outbox where external_id = $1`, [event.externalId]);
    return result.rows[0] || null;
  }

  async createCallback(event) {
    const phone = digits(event.phone);
    const patient = await this.db.query(
      `select id, whatsapp_language
       from patients
       where mobile = $1 and active = true
       order by created_at desc
       limit 1`,
      [phone]
    );
    const id = `CB${pad(await this.system.nextSeq("callback"))}`;
    const result = await this.db.query(
      `insert into callback_requests (id, patient_id, phone, language, source_message_id, notes, requested_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, patient_id as "patientId", phone, language, status, requested_at as "requestedAt"`,
      [id, patient.rows[0]?.id || null, phone, patient.rows[0]?.whatsapp_language || event.language || "en", event.externalId || null, event.notes || "", event.at || new Date().toISOString()]
    );
    return result.rows[0];
  }

  async handleDocumentRequest(event) {
    const phone = digits(event.phone);
    const matches = await this.db.query(
      `select id, first_name, uhid, mobile, whatsapp_consent, whatsapp_language, whatsapp_opted_out, whatsapp_number_confirmed
       from patients
       where mobile = $1 and active = true
       order by created_at`,
      [phone]
    );
    if (!matches.rows.length) return null;
    if (!event.patientId && matches.rows.length > 1) {
      const patient = matches.rows[0];
      return this.insertOutbox({
        patient,
        kind: "menu_reply",
        templateName: "service_window_menu",
        refType: "patient_selector",
        refId: event.externalId || `selector-${Date.now()}`,
        documentKind: null,
        idempotencyKey: `selector:${event.externalId}`,
        payload: {
          documentKind: event.documentKind,
          children: matches.rows.map((row) => ({ patientId: row.id, firstName: row.first_name, maskedUhid: maskUhid(row.uhid) }))
        },
        scheduledFor: new Date().toISOString(),
        userId: null
      });
    }
    const patient = event.patientId
      ? matches.rows.find((row) => row.id === event.patientId)
      : matches.rows[0];
    if (!patient) return null;
    const refId = await this.latestDocumentRef(patient.id, event.documentKind);
    if (!refId) return null;
    return this.insertOutbox({
      patient,
      kind: "document",
      templateName: "charaka_document",
      refType: event.documentKind === "pharmacy_invoice" ? "pharmacy_sale" : "visit",
      refId,
      documentKind: event.documentKind,
      idempotencyKey: `request:${event.externalId}:${patient.id}:${event.documentKind}`,
      payload: { documentKind: event.documentKind, refId, requestedFromChat: true },
      scheduledFor: new Date().toISOString(),
      userId: null
    });
  }

  async latestDocumentRef(patientId, documentKind) {
    if (documentKind === "pharmacy_invoice") {
      const result = await this.db.query(
        `select id from pharmacy_sales where patient_id = $1 and status = 'paid' order by sale_at desc limit 1`,
        [patientId]
      );
      return result.rows[0]?.id || null;
    }
    if (documentKind === "prescription") {
      const result = await this.db.query(
        `select v.id
         from visits v
         where v.patient_id = $1
           and exists (select 1 from prescriptions p where p.visit_id = v.id)
         order by v.visit_at desc
         limit 1`,
        [patientId]
      );
      return result.rows[0]?.id || null;
    }
    const result = await this.db.query(
      `select id from visits where patient_id = $1 and status <> 'cancelled' order by visit_at desc limit 1`,
      [patientId]
    );
    return result.rows[0]?.id || null;
  }

  async setOptOut(phone, optedOut) {
    const normalized = digits(phone);
    await this.db.query(
      `update patients
       set whatsapp_opted_out = $2, updated_at = now()
       where mobile = $1`,
      [normalized, optedOut]
    );
    if (optedOut) {
      await this.db.query(
        `update whatsapp_outbox
         set status = 'opted_out', updated_at = now()
         where phone = $1 and status in ('queued', 'failed')`,
        [normalized]
      );
    } else {
      await this.db.query(
        `update whatsapp_outbox o
         set status = 'queued', scheduled_for = now(), updated_at = now()
         where o.phone = $1
           and o.status = 'opted_out'
           and exists (
             select 1 from patients p
             where p.id = o.patient_id
               and p.whatsapp_consent = true
               and p.whatsapp_number_confirmed = true
               and p.whatsapp_opted_out = false
           )`,
        [normalized]
      );
    }
    return { phone: normalized, optedOut };
  }
}

function messageStatus(patient) {
  if (patient.whatsapp_opted_out) return "opted_out";
  if (!patient.whatsapp_consent || !patient.whatsapp_number_confirmed) return "blocked_no_consent";
  return "queued";
}

function reminderTime(dueDate, offsetDays) {
  const date = new Date(`${dateOnly(dueDate)}T09:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() - Number(offsetDays));
  return date.toISOString();
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function digits(value) {
  const normalized = String(value || "").replace(/\D/g, "");
  return normalized.length > 10 && normalized.startsWith("91") ? normalized.slice(-10) : normalized;
}

function maskUhid(value) {
  const text = String(value || "");
  return text.length <= 4 ? text : `${"*".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}
