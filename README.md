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

## Start

```bash
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

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

The current browser app still runs from `data/clinic.json` while the database
backend is being built. PostgreSQL now starts through Docker Compose and
initializes from `database/schema.sql`.

```bash
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d postgres
```

See `database/README.md` for the backend migration sequence.
