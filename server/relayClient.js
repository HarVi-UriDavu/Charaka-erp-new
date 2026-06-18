export function startRelayClient(store, options = {}) {
  const relayUrl = String(options.relayUrl || process.env.WHATSAPP_RELAY_URL || "").replace(/\/$/, "");
  const relayToken = options.relayToken || process.env.WHATSAPP_RELAY_TOKEN || "";
  if (typeof store.processDueReminders !== "function") return null;
  const relayEnabled = Boolean(relayUrl && relayToken && typeof store.pendingWhatsApp === "function");

  const intervalMs = Number(options.intervalMs || process.env.WHATSAPP_SYNC_INTERVAL_MS || 30000);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await store.processDueReminders();
      if (relayEnabled) {
        await pushOutbound(store, relayUrl, relayToken);
        await pullEvents(store, relayUrl, relayToken);
      }
    } catch (error) {
      console.error("WhatsApp relay sync error:", error.message);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

async function pushOutbound(store, relayUrl, relayToken) {
  const messages = await store.pendingWhatsApp();
  for (const message of messages) {
    try {
      const payload = {
        id: message.id,
        phone: normalizeIndianPhone(message.phone),
        language: message.language,
        kind: message.kind,
        templateName: message.templateName,
        refType: message.refType,
        refId: message.refId,
        payload: message.payload || {}
      };
      if (message.documentKind) {
        const pdf = await store.whatsappDocument(message.id);
        payload.document = {
          kind: message.documentKind,
          filename: documentFilename(message),
          contentType: "application/pdf",
          base64: pdf.toString("base64")
        };
      }
      const response = await relayFetch(relayUrl, relayToken, "/v1/erp/outbound", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await store.markWhatsAppSubmitted(message.id, response.externalId || response.id);
    } catch (error) {
      await store.markWhatsAppFailure(message.id, error.message);
    }
  }
}

async function pullEvents(store, relayUrl, relayToken) {
  const cursor = await store.relayCursor();
  const result = await relayFetch(relayUrl, relayToken, `/v1/erp/events?cursor=${encodeURIComponent(cursor)}`);
  for (const event of result.events || []) await store.applyRelayEvent(event);
  if (result.cursor && result.cursor !== cursor) await store.setRelayCursor(result.cursor);
}

async function relayFetch(relayUrl, relayToken, pathname, options = {}) {
  const response = await fetch(`${relayUrl}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${relayToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Relay returned HTTP ${response.status}`);
  return data;
}

function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits;
  return `91${digits.slice(-10)}`;
}

function documentFilename(message) {
  const names = {
    opd_receipt: "opd-receipt",
    prescription: "prescription",
    pharmacy_invoice: "pharmacy-invoice"
  };
  return `${names[message.documentKind] || "clinic-document"}-${message.refId}.pdf`;
}
