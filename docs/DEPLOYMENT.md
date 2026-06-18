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

## PostgreSQL

Docker Compose runs the production app against PostgreSQL. After pulling schema changes:

```bash
docker compose build erp
docker compose run --rm erp npm run db:migrate
docker compose up -d
```

The app uses JSON persistence only when started without `DATABASE_URL`.

## WhatsApp

WhatsApp uses an outbound-only connection from the clinic server to a Cloudflare relay. Do not expose port `4173` to the internet.

Follow `docs/WHATSAPP_SETUP.md` after the normal LAN deployment is working.

## Clinic Hardening Checklist

- Change demo user PINs before real use.
- Put the server on a UPS.
- Reserve a static LAN IP for the server.
- Add Windows startup task or Docker restart policy.
- Schedule a nightly backup.
- Test printing from each clinic computer.
- Run one week in parallel with the current paper/software process before fully switching.
