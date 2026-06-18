# Charaka Clinic ERP

Operations-first local clinic ERP MVP built from the prototype plan.

## Included Workflows

- Reception patient registry, search, OPD visit billing, receipts.
- Doctor queue, vitals, prescriptions, printable prescription.
- Pharmacy sales, purchases, batch stock, expiry/low-stock alerts, sales returns.
- Unified billing daybook, CSV export, reports, audit log.
- CSV imports for patients, services, drugs, suppliers, and opening stock.
- Local backup action and Docker deployment files.
- PostgreSQL target schema and Docker database service.
- WhatsApp outbox, server-generated PDF documents, consent controls, follow-up and vaccine reminders.

## Start

```bash
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

Without `DATABASE_URL`, this uses the local JSON file backend for quick demos.

## Test

```bash
npm test
```

## Demo Users

- Doctor: `U01`
- Reception: `U02`
- Pharmacy: `U03`
- Admin: `U04`

Default demo PINs:

- Doctor: `1111`
- Reception: `2222`
- Pharmacy: `3333`
- Admin: `4444`

Admin can add more accounts from `Masters -> Users -> Add account`.

## PostgreSQL Backend

When `DATABASE_URL` is set, the same browser app runs through the PostgreSQL
backend. Docker Compose sets this automatically for the `erp` service.

```bash
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d postgres
POSTGRES_PASSWORD=change-this-at-clinic docker compose run --rm erp npm run db:seed
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d erp
```

Run the seed command once for a fresh test database. After real clinic data is
entered, do not re-seed unless you intentionally want to refresh starter rows.

Direct migration/seed commands:

```bash
npm install
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:migrate
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:seed
```

See `database/README.md` for the backend migration sequence.

## WhatsApp Messaging

The ERP includes the local WhatsApp messaging workflow and a deployable Cloudflare relay in `cloudflare-relay/`.

It does not send real messages until Meta templates, a WhatsApp number, Cloudflare resources, and secrets are configured. Follow [`docs/WHATSAPP_SETUP.md`](docs/WHATSAPP_SETUP.md).
