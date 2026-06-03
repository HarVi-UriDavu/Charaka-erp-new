# Charaka Clinic ERP Local Deployment

This MVP is designed to run on one clinic LAN server and be opened from reception, pharmacy, and doctor-room browsers.

## Run Locally

```bash
cd "charaka-clinic-erp"
npm start
```

Open:

```text
http://localhost:4173
```

On other clinic computers, replace `localhost` with the server computer name or LAN IP, for example:

```text
http://clinic-server:4173
http://192.168.1.25:4173
```

## Data And Backups

- Runtime data is stored in `data/clinic.json`.
- Manual backups are created from Settings into `backups/`.
- For clinic use, copy the `backups/` folder to an external drive daily.

## Docker

```bash
docker compose up --build
```

This exposes the app on port `4173` and persists `data/` plus `backups/` on the host.

## PostgreSQL Graduation

The current runnable MVP uses JSON persistence so it works without installing dependencies. The target production schema is in `database/schema.sql`.

When moving to PostgreSQL:

1. Start the optional Postgres service:

   ```bash
   docker compose --profile postgres-target up -d postgres
   ```

2. Replace the JSON store with a database-backed repository using the tables in `database/schema.sql`.
3. Keep the existing API contracts unchanged so the UI does not need to be rewritten.

## Clinic Hardening Checklist

- Change demo user PINs before real use.
- Put the server on a UPS.
- Reserve a static LAN IP for the server.
- Add Windows startup task or Docker restart policy.
- Schedule a nightly backup.
- Test printing from each clinic computer.
- Run one week in parallel with the current paper/software process before fully switching.
