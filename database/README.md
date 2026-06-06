# PostgreSQL Backend

`schema.sql` is the target PostgreSQL schema for the full clinic ERP backend.
It covers reception, clinical visits, prescriptions, OPD billing, pharmacy
stock/batches, purchases, sales, returns, invoices, payments, imports, backups,
settings, roles, permissions, and audit logs.

## Local Docker Start

```bash
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d postgres
```

On first startup, Docker runs `database/schema.sql` automatically because it is
mounted into `/docker-entrypoint-initdb.d/`.

For a non-Docker Postgres instance, run:

```bash
npm install
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:migrate
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:seed
```

`db:migrate` applies `schema.sql`; `db:seed` loads the same starter clinic data
currently used by the JSON MVP.

## Current Status

The browser app still runs against `data/clinic.json`. The PostgreSQL backend
foundation is now in place; the next implementation step is to replace
`ClinicStore` methods with Postgres-backed queries one workflow at a time:

1. Auth, roles, settings, sequence generation, and audit logs.
   `server/pgSystemStore.js` now contains this first backend slice.
2. Patients, visits, vitals, OPD invoices, and payments.
   `server/pgReceptionStore.js` now contains this second backend slice.
3. Clinical prescriptions and visit completion.
   `server/pgClinicalStore.js` now contains this third backend slice.
4. Pharmacy purchases, batches, stock movements, sales, and returns.
   `server/pgPharmacyStore.js` now contains this fourth backend slice.
5. Imports, reports, and backups.
   `server/pgReportsStore.js` now contains reports plus import/backup job tracking.
