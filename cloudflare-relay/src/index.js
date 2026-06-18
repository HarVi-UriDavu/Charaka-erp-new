export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/meta/webhook") return metaWebhook(request, env);
      if (url.pathname.startsWith("/v1/erp/")) {
        requireErpAuth(request, env);
        if (request.method === "POST" && url.pathname === "/v1/erp/outbound") return acceptOutbound(request, env);
        if (request.method === "GET" && url.pathname === "/v1/erp/events") return listEvents(url, env);
      }
      if (request.method === "GET" && url.pathname === "/privacy") return htmlPage("Privacy policy", privacyText());
      if (request.method === "GET" && url.pathname === "/whatsapp-consent") return htmlPage("WhatsApp consent", consentText());
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Relay error" }, error.status || 500);
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await deliverJob(message.body.id, env);
        message.ack();
      } catch (error) {
        await env.DB.prepare(
          `update outbound_jobs set status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? where id = ?`
        ).bind(String(error.message).slice(0, 1000), now(), message.body.id).run();
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      }
    }
  },

  async scheduled(controller, env) {
    if (controller.cron === "15 2 * * *") await cleanup(env);
    else await requeueFailures(env);
  }
};

async function acceptOutbound(request, env) {
  const input = await request.json();
  required(input.id, "id");
  required(input.phone, "phone");
  required(input.templateName, "templateName");
  const existing = await env.DB.prepare(`select id, external_id, status from outbound_jobs where id = ?`).bind(input.id).first();
  if (existing) return json({ id: existing.id, externalId: existing.external_id, status: existing.status });

  let documentKey = null;
  let filename = null;
  if (input.document?.base64) {
    documentKey = `documents/${input.id}.bin`;
    filename = input.document.filename || `${input.id}.pdf`;
    const encrypted = await encryptBytes(base64ToBytes(input.document.base64), env.DATA_ENCRYPTION_KEY);
    await env.DOCUMENTS.put(documentKey, encrypted, {
      customMetadata: { expiresAt: new Date(Date.now() + 86400000).toISOString(), contentType: "application/pdf" }
    });
  }
  await env.DB.prepare(
    `insert into outbound_jobs
       (id, phone_enc, language, kind, template_name, ref_type, ref_id, payload_enc,
        document_key, document_filename, status, created_at, updated_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
  ).bind(
    input.id,
    await encryptJson({ phone: input.phone }, env.DATA_ENCRYPTION_KEY),
    input.language === "te" ? "te" : "en",
    input.kind,
    input.templateName,
    input.refType || "",
    input.refId || "",
    await encryptJson(input.payload || {}, env.DATA_ENCRYPTION_KEY),
    documentKey,
    filename,
    now(),
    now(),
    documentKey ? new Date(Date.now() + 86400000).toISOString() : null
  ).run();
  await env.OUTBOUND_QUEUE.send({ id: input.id });
  return json({ id: input.id, externalId: input.id, status: "queued" }, 201);
}

async function deliverJob(id, env) {
  const job = await env.DB.prepare(`select * from outbound_jobs where id = ?`).bind(id).first();
  if (!job || ["sent", "delivered", "read"].includes(job.status)) return;
  const { phone } = await decryptJson(job.phone_enc, env.DATA_ENCRYPTION_KEY);
  const payload = await decryptJson(job.payload_enc, env.DATA_ENCRYPTION_KEY);
  let mediaId = null;
  if (job.document_key) {
    const object = await env.DOCUMENTS.get(job.document_key);
    if (!object) throw new Error("Temporary PDF not found");
    const pdf = await decryptBytes(await object.arrayBuffer(), env.DATA_ENCRYPTION_KEY);
    mediaId = await uploadMedia(pdf, job.document_filename, env);
  }
  const response = job.kind === "menu_reply"
    ? await sendChildSelector(phone, payload, env)
    : await sendTemplate(phone, job, payload, mediaId, env);
  await env.DB.prepare(
    `update outbound_jobs set status = 'sent', attempts = attempts + 1, external_id = ?, last_error = '', updated_at = ? where id = ?`
  ).bind(response.messages?.[0]?.id || null, now(), id).run();
  await addEvent(env, "sent", { outboxId: id, externalId: response.messages?.[0]?.id || null, at: now() });
}

async function uploadMedia(bytes, filename, env) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);
  const response = await metaFetch(`/${env.WHATSAPP_PHONE_NUMBER_ID}/media`, env, { method: "POST", body: form });
  return response.id;
}

async function sendTemplate(phone, job, payload, mediaId, env) {
  const components = [];
  if (mediaId) components.push({ type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: job.document_filename } }] });
  if (job.kind === "followup_reminder" || job.kind === "vaccine_reminder") {
    components.push({ type: "body", parameters: [{ type: "text", text: String(payload.dueDate || "") }] });
  }
  return metaFetch(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, env, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: job.template_name,
        language: { code: job.language === "te" ? "te" : "en" },
        components
      }
    })
  });
}

async function metaWebhook(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.get("hub.verify_token") !== env.META_VERIFY_TOKEN) return new Response("Forbidden", { status: 403 });
    return new Response(url.searchParams.get("hub.challenge") || "");
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await request.arrayBuffer();
  await verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET);
  const body = JSON.parse(new TextDecoder().decode(raw));
  const webhookId = await sha256Hex(raw);
  const duplicate = await env.DB.prepare(`select id from processed_webhooks where id = ?`).bind(webhookId).first();
  if (duplicate) return json({ ok: true, duplicate: true });
  await env.DB.prepare(`insert into processed_webhooks (id, created_at) values (?, ?)`).bind(webhookId, now()).run();

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const status of change.value?.statuses || []) await handleStatus(status, env);
      for (const message of change.value?.messages || []) await handleInbound(message, env);
    }
  }
  return json({ ok: true });
}

async function handleStatus(status, env) {
  const job = await env.DB.prepare(`select id from outbound_jobs where external_id = ?`).bind(status.id).first();
  const type = status.status === "failed" ? "failed" : status.status;
  if (job) {
    await env.DB.prepare(`update outbound_jobs set status = ?, last_error = ?, updated_at = ? where id = ?`)
      .bind(type, status.errors?.[0]?.title || "", now(), job.id).run();
  }
  await addEvent(env, type, {
    outboxId: job?.id || null,
    externalId: status.id,
    at: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : now(),
    error: status.errors?.[0]?.title || ""
  });
}

async function handleInbound(message, env) {
  const phone = message.from;
  const text = inboundText(message).trim();
  const normalized = text.toUpperCase();
  if (normalized === "STOP") {
    await addEvent(env, "opt_out", { phone, externalId: message.id, at: now() });
    return sendText(phone, "You will no longer receive Charaka Clinic WhatsApp messages. Send START to opt in again.", env);
  }
  if (normalized === "START") {
    await addEvent(env, "opt_in", { phone, externalId: message.id, at: now() });
    return sendMenu(phone, env);
  }
  const action = inboundAction(message, normalized);
  if (action === "callback") {
    await addEvent(env, "callback_requested", { phone, externalId: message.id, at: now(), notes: "Requested from WhatsApp menu" });
    return sendText(phone, "Reception will call you back during clinic hours.", env);
  }
  if (action?.startsWith("document:")) {
    await addEvent(env, "document_requested", { phone, externalId: message.id, at: now(), documentKind: action.split(":")[1] });
    return sendText(phone, "Your request was received. The clinic server will send the document shortly.", env);
  }
  if (action?.startsWith("child:")) {
    const [, patientId, documentKind] = action.split(":");
    await addEvent(env, "child_document_requested", { phone, patientId, documentKind, externalId: message.id, at: now() });
    return sendText(phone, "Your request was received. The document will be sent shortly.", env);
  }
  if (action === "hours") return sendText(phone, env.CLINIC_HOURS || "Please call the clinic for current opening hours.", env);
  if (action === "location") return sendText(phone, env.CLINIC_MAP_URL || "Please call the clinic for directions.", env);
  return sendMenu(phone, env);
}

async function sendMenu(phone, env) {
  return metaFetch(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, env, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: "Charaka Clinic" },
        body: { text: "Choose an option" },
        action: {
          button: "Clinic services",
          sections: [{
            title: "Documents and help",
            rows: [
              { id: "document:opd_receipt", title: "Latest OPD receipt" },
              { id: "document:prescription", title: "Latest prescription" },
              { id: "document:pharmacy_invoice", title: "Latest pharmacy bill" },
              { id: "hours", title: "Clinic hours" },
              { id: "location", title: "Clinic location" },
              { id: "callback", title: "Request a callback" }
            ]
          }]
        }
      }
    })
  });
}

async function sendChildSelector(phone, payload, env) {
  const rows = (payload.children || []).slice(0, 10).map((child) => ({
    id: `child:${child.patientId}:${payload.documentKind}`,
    title: String(child.firstName || "Child").slice(0, 24),
    description: `UHID ${child.maskedUhid}`.slice(0, 72)
  }));
  return metaFetch(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, env, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Select the child whose document you need." },
        action: { button: "Select child", sections: [{ title: "Children", rows }] }
      }
    })
  });
}

async function sendText(phone, text, env) {
  return metaFetch(`/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, env, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "text", text: { body: text } })
  });
}

async function listEvents(url, env) {
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") || 0));
  const result = await env.DB.prepare(
    `select id, payload_enc from relay_events where id > ? order by id limit 100`
  ).bind(cursor).all();
  const events = [];
  let nextCursor = cursor;
  for (const row of result.results || []) {
    events.push(await decryptJson(row.payload_enc, env.DATA_ENCRYPTION_KEY));
    nextCursor = row.id;
  }
  return json({ cursor: String(nextCursor), events });
}

async function addEvent(env, type, payload) {
  await env.DB.prepare(
    `insert into relay_events (event_type, outbox_id, external_id, payload_enc, created_at)
     values (?, ?, ?, ?, ?)`
  ).bind(type, payload.outboxId || null, payload.externalId || null, await encryptJson({ type, ...payload }, env.DATA_ENCRYPTION_KEY), now()).run();
}

async function requeueFailures(env) {
  const result = await env.DB.prepare(
    `select id from outbound_jobs where status = 'failed' and attempts < 5 and updated_at < ? limit 50`
  ).bind(new Date(Date.now() - 300000).toISOString()).all();
  for (const row of result.results || []) await env.OUTBOUND_QUEUE.send({ id: row.id });
}

async function cleanup(env) {
  const expired = await env.DB.prepare(`select document_key from outbound_jobs where document_key is not null and expires_at < ?`).bind(now()).all();
  for (const row of expired.results || []) await env.DOCUMENTS.delete(row.document_key);
  await env.DB.prepare(`update outbound_jobs set document_key = null where expires_at < ?`).bind(now()).run();
  await env.DB.prepare(`delete from relay_events where created_at < ? and event_type in ('document_requested', 'child_document_requested', 'callback_requested', 'opt_in', 'opt_out')`).bind(daysAgo(7)).run();
  await env.DB.prepare(`delete from relay_events where created_at < ?`).bind(daysAgo(90)).run();
  await env.DB.prepare(`delete from outbound_jobs where created_at < ?`).bind(daysAgo(90)).run();
  await env.DB.prepare(`delete from processed_webhooks where created_at < ?`).bind(daysAgo(7)).run();
}

async function metaFetch(path, env, options) {
  const response = await fetch(`https://graph.facebook.com/${env.META_API_VERSION || "v23.0"}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Meta API returned HTTP ${response.status}`);
  return data;
}

function inboundText(message) {
  return message.text?.body || message.button?.payload || message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || "";
}

function inboundAction(message, normalized) {
  const id = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || message.button?.payload;
  if (id) return id;
  return { "1": "document:opd_receipt", "2": "document:prescription", "3": "document:pharmacy_invoice", "4": "hours", "5": "callback" }[normalized] || "";
}

function requireErpAuth(request, env) {
  if (request.headers.get("authorization") !== `Bearer ${env.ERP_SYNC_TOKEN}`) throw httpError(401, "Unauthorized");
}

async function verifyMetaSignature(raw, signature, secret) {
  if (!signature || !secret) throw httpError(401, "Missing webhook signature");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, raw)));
  if (`sha256=${digest}` !== signature) throw httpError(401, "Invalid webhook signature");
}

async function encryptJson(value, secret) {
  return bytesToBase64(await encryptBytes(new TextEncoder().encode(JSON.stringify(value)), secret));
}

async function decryptJson(value, secret) {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(base64ToBytes(value), secret)));
}

async function encryptBytes(bytes, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const output = new Uint8Array(iv.length + encrypted.length);
  output.set(iv);
  output.set(encrypted, iv.length);
  return output;
}

async function decryptBytes(value, secret) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const key = await encryptionKey(secret);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256Hex(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bytesToBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function retryDelay(attempts) {
  return Math.min(3600, 30 * (2 ** Math.max(0, Number(attempts) || 0)));
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function now() {
  return new Date().toISOString();
}

function required(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") throw httpError(400, `${field} is required`);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function htmlPage(title, body) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#172536}h1{font-size:28px}</style></head><body><h1>${title}</h1>${body}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function privacyText() {
  return "<p>Charaka Clinic uses WhatsApp to deliver requested clinic documents and healthcare reminders to guardians who have opted in. We do not use this channel for advertising. Contact the clinic to correct data or withdraw consent.</p><p>Medical documents are retained temporarily by the messaging relay and deleted within 24 hours after upload.</p>";
}

function consentText() {
  return "<p>By opting in at reception, a guardian authorises Charaka Clinic to send bills, prescriptions, follow-up reminders, and vaccination reminders to the confirmed WhatsApp number. Reply STOP at any time to stop messages and START to resume.</p>";
}
