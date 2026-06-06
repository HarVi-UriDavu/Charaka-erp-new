# PostgreSQL Backend

`schema.sql` is the target PostgreSQL schema for the full clinic ERP backend.
It covers reception, clinical visits, prescriptions, OPD billing, pharmacy
stock/batches, purchases, sales, returns, invoices, payments, imports, backups,
settings, roles, permissions, and audit logs.

## Local Docker Start

```bash
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d postgres
POSTGRES_PASSWORD=change-this-at-clinic docker compose run --rm erp npm run db:seed
POSTGRES_PASSWORD=change-this-at-clinic docker compose up -d erp
```

On first startup, Docker runs `database/schema.sql` automatically because it is
mounted into `/docker-entrypoint-initdb.d/`.

The seed command loads the starter clinic users, services, patients, drugs, and
opening stock. Run it once for a fresh test database. After the clinic starts
entering real data, do not re-seed unless you intentionally want to refresh the
starter rows.

For a non-Docker Postgres instance, run:

```bash
npm install
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:migrate
DATABASE_URL=postgresql://charaka:change-this-at-clinic@localhost:5432/charaka npm run db:seed
```

`db:migrate` applies `schema.sql`; `db:seed` loads the same starter clinic data
currently used by the JSON MVP.

## Current Status

The app uses the JSON file backend when `DATABASE_URL` is not set. When
`DATABASE_URL` is set, `server/index.js` starts the PostgreSQL app store instead.
Docker Compose sets `DATABASE_URL` for the `erp` service automatically.

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
6. API wiring and app snapshots.
   `server/pgAppStore.js` now connects the running HTTP API to PostgreSQL.
