import assert from "node:assert/strict";
import test from "node:test";
import { PgMessagingStore } from "../server/pgMessagingStore.js";
import { fakeDb, fakePgState } from "./fakePg.js";

test("Postgres messaging queues one idempotent document for a consented patient", async () => {
  const state = fakePgState({ sequences: { audit: 1, whatsapp: 0 } });
  const store = new PgMessagingStore(fakeDb(state));

  const first = await store.queueDocument("opd_receipt", "V10026", "P001", "U02");
  const second = await store.queueDocument("opd_receipt", "V10026", "P001", "U02");

  assert.equal(first.status, "queued");
  assert.equal(second.id, first.id);
  assert.equal(state.whatsappOutbox.length, 1);
});

test("Postgres messaging blocks automatic documents without confirmed consent", async () => {
  const state = fakePgState({
    sequences: { audit: 1, whatsapp: 0 },
    patients: [{
      ...fakePgState().patients[0],
      whatsapp_consent: false,
      whatsapp_number_confirmed: false
    }]
  });
  const store = new PgMessagingStore(fakeDb(state));

  const message = await store.queueDocument("prescription", "V10026", "P001", "U01");

  assert.equal(message.status, "blocked_no_consent");
});

test("Postgres messaging schedules follow-up and vaccine reminder offsets", async () => {
  const state = fakePgState({ sequences: { audit: 1, reminder: 0, whatsapp: 0 } });
  const store = new PgMessagingStore(fakeDb(state));

  const followUps = await store.scheduleFollowUp("V10026", "P001", "2026-07-10", "Review", "U01");
  const vaccines = await store.scheduleVaccination("VX000001", "P001", "2026-08-01", "VAC002", "U01");

  assert.equal(followUps.length, 1);
  assert.equal(vaccines.length, 2);
  assert.deepEqual(state.reminderJobs.map((row) => row.offset_days).sort((a, b) => a - b), [1, 1, 7]);
});

test("Postgres messaging applies delivery events and callback requests", async () => {
  const state = fakePgState({ sequences: { audit: 1, whatsapp: 0, callback: 0 } });
  const store = new PgMessagingStore(fakeDb(state));
  const message = await store.queueDocument("opd_receipt", "V10026", "P001", "U02");
  await store.markRelaySubmitted(message.id, "wamid.123");

  await store.applyRelayEvent({ type: "delivered", outboxId: message.id, externalId: "wamid.123", at: "2026-06-18T10:00:00.000Z" });
  const callback = await store.applyRelayEvent({ type: "callback_requested", phone: "919876543210", externalId: "wamid.inbound", at: "2026-06-18T10:01:00.000Z" });

  assert.equal(state.whatsappOutbox[0].status, "delivered");
  assert.equal(state.deliveryEvents[0].event_type, "delivered");
  assert.equal(callback.patientId, "P001");
});
