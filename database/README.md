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

## Current Status

The browser app still runs against `data/clinic.json`. The PostgreSQL backend
foundation is now in place; the next implementation step is to replace
`ClinicStore` methods with Postgres-backed queries one workflow at a time:

1. Auth, roles, settings, and sequence generation.
2. Patients, visits, vitals, OPD invoices, and payments.
3. Clinical prescriptions and visit completion.
4. Pharmacy purchases, batches, stock movements, sales, and returns.
5. Imports, reports, audit logs, and backups.
