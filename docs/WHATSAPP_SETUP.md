# WhatsApp Messaging Setup

The ERP implementation is complete, but real messages cannot be sent until Meta and Cloudflare accounts are configured.

## Architecture

```text
Clinic browsers
      |
Local Charaka ERP + PostgreSQL
      |
Outbound HTTPS polling only
      |
Cloudflare Worker + Queue + D1 + temporary R2
      |
Meta WhatsApp Cloud API
```

The clinic server is not exposed to the public internet.

## 1. Update The Clinic Database

For an existing Docker installation:

```bash
git pull
docker compose build erp
docker compose run --rm erp npm run db:migrate
docker compose up -d
```

Do not run `db:seed` again after entering real clinic data.

## 2. Create The WhatsApp Number

You need:

- A new clinic-controlled SIM/phone number.
- A Meta Business Portfolio administrator account with 2FA.
- Clinic business-verification documents.
- A payment method for WhatsApp Business Platform charges.
- A permanent Meta system-user access token.
- The WhatsApp phone-number ID and Meta app secret.

Use Meta's temporary test number first. Move to the clinic number only after the full workflow passes.

## 3. Create Message Templates

Create English and Telugu versions of these utility templates:

### `charaka_document`

- Category: Utility.
- Header: Document.
- Body: Static wording confirming that the attached file is a clinic document requested or generated during care.
- No diagnosis, medicine, or child name in the message body.

Suggested English:

```text
Your document from Charaka Clinic is attached. Please keep it private and contact the clinic if it was sent to the wrong number.
```

Suggested Telugu draft for clinic review:

```text
చరక క్లినిక్ నుండి మీ పత్రం జత చేయబడింది. దయచేసి దీన్ని గోప్యంగా ఉంచండి. తప్పు నంబర్‌కు వచ్చినట్లయితే క్లినిక్‌ను సంప్రదించండి.
```

### `charaka_followup_reminder`

- Category: Utility.
- One body variable: follow-up due date.

Suggested English:

```text
Reminder from Charaka Clinic: your child's follow-up is due on {{1}}. Please visit during clinic hours or call reception if the plan has changed.
```

### `charaka_vaccine_reminder`

- Category: Utility.
- One body variable: vaccine due date.

Suggested English:

```text
Reminder from Charaka Clinic: a vaccination is due on {{1}}. Please bring the child's vaccination record and call reception if the date needs to change.
```

The Telugu wording must be reviewed by clinic staff before Meta submission.

## 4. Deploy Cloudflare Relay

Follow [`cloudflare-relay/README.md`](../cloudflare-relay/README.md).

The relay requires:

- Worker
- D1 database
- R2 bucket
- Queue
- Cron triggers

Configure these Worker secrets:

```text
ERP_SYNC_TOKEN
DATA_ENCRYPTION_KEY
META_VERIFY_TOKEN
META_APP_SECRET
META_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
CLINIC_HOURS
CLINIC_MAP_URL
```

`ERP_SYNC_TOKEN` and `DATA_ENCRYPTION_KEY` should each be independently generated random values of at least 32 characters.

## 5. Connect The Clinic Server

Create `.env` beside `docker-compose.yml`:

```text
POSTGRES_PASSWORD=your-existing-database-password
WHATSAPP_RELAY_URL=https://YOUR-WORKER.workers.dev
WHATSAPP_RELAY_TOKEN=the-same-value-as-ERP_SYNC_TOKEN
WHATSAPP_SYNC_INTERVAL_MS=30000
```

Restart:

```bash
docker compose up -d --build erp
docker compose logs -f erp
```

The ERP will keep working if Cloudflare or Meta is unavailable. Messages become `failed` and can be resent from the Messages screen.

## 6. Clinic Workflow

Reception must:

1. Confirm that the mobile number belongs to the guardian.
2. Record WhatsApp consent.
3. Select English or Telugu.
4. Correct the number immediately if the guardian reports a wrong delivery.

The ERP automatically queues:

- OPD receipt after paid visit creation.
- Prescription after clinical save.
- Pharmacy invoice after paid pharmacy sale.
- Follow-up reminder one day before the doctor-entered date.
- Vaccine reminders seven days and one day before the staff-entered due date.

Replying `STOP` opts the number out. Replying `START` opts it back in.

## Privacy Limitation

The chosen identity check is phone-number matching only. This is weaker than a DOB or UHID challenge. A recycled, shared, or incorrectly entered phone number could expose a child's document. Reception must confirm the number and consent carefully.

For shared family numbers, the chat displays first name plus masked UHID before sending a requested document.

## Pilot Order

1. Meta test number and staff phones.
2. OPD receipts.
3. Prescriptions.
4. Pharmacy invoices.
5. Follow-up reminders.
6. Vaccine reminders.
7. Incoming menus and callbacks.

Check the Messages screen daily during the pilot for failures, blocks, opt-outs, and callbacks.
