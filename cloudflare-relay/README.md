# Charaka WhatsApp Relay

This Worker is the only public component. The clinic ERP and PostgreSQL server remain private on the LAN.

## Create Cloudflare Resources

```bash
npm install
npx wrangler login
npx wrangler d1 create charaka-whatsapp-relay
npx wrangler r2 bucket create charaka-whatsapp-documents
npx wrangler queues create charaka-whatsapp-outbound
```

Put the returned D1 ID into `wrangler.toml`, then initialise it:

```bash
npm run db:init
```

## Secrets

```bash
npx wrangler secret put ERP_SYNC_TOKEN
npx wrangler secret put DATA_ENCRYPTION_KEY
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put CLINIC_HOURS
npx wrangler secret put CLINIC_MAP_URL
```

Use a random value of at least 32 characters for `ERP_SYNC_TOKEN` and `DATA_ENCRYPTION_KEY`.

## Meta Templates

Create and obtain approval for:

- `charaka_document` in English and Telugu, with a document header and static utility body.
- `charaka_followup_reminder` in English and Telugu, with one body variable for the due date.
- `charaka_vaccine_reminder` in English and Telugu, with one body variable for the due date.

Configure the Meta webhook URL as:

```text
https://YOUR-WORKER.workers.dev/meta/webhook
```

Use the same value supplied as `META_VERIFY_TOKEN`.

## Deploy

```bash
npm run deploy
```

On the clinic ERP set:

```text
WHATSAPP_RELAY_URL=https://YOUR-WORKER.workers.dev
WHATSAPP_RELAY_TOKEN=the-same-value-as-ERP_SYNC_TOKEN
```

The ERP polls the relay. No inbound firewall port or public tunnel to the clinic is required.
