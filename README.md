# Charaka Clinic ERP

Operations-first local clinic ERP MVP built from the prototype plan.

## Included Workflows

- Reception patient registry, search, OPD visit billing, receipts.
- Doctor queue, vitals, prescriptions, printable prescription.
- Pharmacy sales, purchases, batch stock, expiry/low-stock alerts, sales returns.
- Unified billing daybook, CSV export, reports, audit log.
- CSV imports for patients, services, drugs, suppliers, and opening stock.
- Admin-reviewed pediatric dosing rules with doctor-side dose suggestions.
- Local backup action and Docker deployment files.

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

## Pediatric Dosing Rules

The ERP can suggest pediatric doses only from local rules that Admin has entered
and the doctor has approved. In the doctor screen, enter the child's current
weight, select a medicine, and click `Suggest dose`; the doctor must still
review/edit the final prescription before saving.

If you have licensed permission to use a pediatric dosage PDF, create a private
review CSV with:

```bash
/Users/v/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 tools/extract_dosing_candidates.py "/path/to/licensed-dosage-book.pdf" --out data/dosing-candidates.csv
```

The CSV is written under ignored `data/` storage. Review rows manually before
adding active rules in `Masters -> Dosing -> Add dosing rule`.
