-- PostgreSQL target schema for the clinic-server version.
-- The runnable MVP currently persists to data/clinic.json so it can run without installs.

create table roles (
  id text primary key,
  name text not null unique
);

create table users (
  id text primary key,
  name text not null,
  role_id text not null references roles(id),
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table patients (
  id text primary key,
  uhid text not null unique,
  first_name text not null,
  last_name text not null,
  gender text not null check (gender in ('M', 'F')),
  dob date not null,
  mobile text not null,
  guardian_rel text not null,
  guardian_name text not null,
  address text,
  blood_group text,
  allergies text,
  created_at timestamptz not null default now()
);

create table doctors (
  id text primary key,
  name text not null,
  qualification text,
  reg_no text,
  consult_fee numeric(12,2) not null default 0,
  follow_up_fee numeric(12,2) not null default 0,
  active boolean not null default true
);

create table services (
  id text primary key,
  code text not null unique,
  name text not null,
  category text not null,
  rate numeric(12,2) not null,
  gst numeric(5,2) not null default 0,
  active boolean not null default true
);

create table visits (
  id text primary key,
  voucher_no text not null unique,
  patient_id text not null references patients(id),
  doctor_id text not null references doctors(id),
  status text not null,
  visit_at timestamptz not null default now(),
  notes text,
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null
);

create table vitals (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  weight_kg numeric(8,2),
  height_cm numeric(8,2),
  temp_f numeric(8,2),
  pulse integer,
  recorded_at timestamptz not null default now()
);

create table visit_items (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  service_id text references services(id),
  name text not null,
  qty numeric(10,2) not null,
  rate numeric(12,2) not null
);

create table prescriptions (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  drug_id text,
  name text not null,
  dose text,
  frequency text,
  days integer,
  qty numeric(10,2)
);

create table suppliers (
  id text primary key,
  name text not null,
  gstin text,
  phone text,
  city text,
  active boolean not null default true
);

create table drugs (
  id text primary key,
  name text not null,
  form text,
  pack text,
  hsn text,
  mrp numeric(12,2) not null,
  gst numeric(5,2) not null default 0,
  reorder_level integer not null default 0,
  active boolean not null default true
);

create table drug_batches (
  id text primary key,
  drug_id text not null references drugs(id),
  batch text not null,
  expiry date not null,
  qty numeric(12,2) not null default 0,
  purchase_rate numeric(12,2) not null default 0,
  mrp numeric(12,2) not null default 0,
  unique (drug_id, batch)
);

create table purchases (
  id text primary key,
  voucher_no text not null unique,
  supplier_id text not null references suppliers(id),
  invoice_no text not null,
  purchase_at timestamptz not null default now(),
  total numeric(12,2) not null
);

create table purchase_items (
  id bigserial primary key,
  purchase_id text not null references purchases(id) on delete cascade,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  qty numeric(12,2) not null,
  rate numeric(12,2) not null,
  gst numeric(5,2) not null default 0
);

create table pharmacy_sales (
  id text primary key,
  voucher_no text not null unique,
  patient_id text references patients(id),
  linked_visit_id text references visits(id),
  sale_at timestamptz not null default now(),
  total numeric(12,2) not null,
  status text not null default 'paid'
);

create table sale_items (
  id bigserial primary key,
  sale_id text not null references pharmacy_sales(id) on delete cascade,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  name text not null,
  qty numeric(12,2) not null,
  rate numeric(12,2) not null,
  gst numeric(5,2) not null default 0
);

create table invoices (
  id text primary key,
  kind text not null,
  ref_id text not null,
  voucher_no text not null,
  party_id text,
  invoice_at timestamptz not null default now(),
  total numeric(12,2) not null,
  cash numeric(12,2) not null default 0,
  upi numeric(12,2) not null default 0,
  status text not null default 'paid'
);

create table returns (
  id text primary key,
  voucher_no text not null unique,
  sale_id text references pharmacy_sales(id),
  reason text,
  return_at timestamptz not null default now(),
  amount numeric(12,2) not null
);

create table stock_movements (
  id text primary key,
  movement_at timestamptz not null default now(),
  kind text not null,
  ref_id text not null,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  qty numeric(12,2) not null,
  note text
);

create table import_jobs (
  id text primary key,
  entity text not null,
  imported integer not null default 0,
  failed integer not null default 0,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table audit_logs (
  id text primary key,
  at timestamptz not null default now(),
  user_id text references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  details jsonb not null default '{}'
);

create index patients_search_idx on patients using gin (to_tsvector('simple', first_name || ' ' || last_name || ' ' || uhid || ' ' || mobile || ' ' || guardian_name));
create index visits_day_idx on visits (visit_at);
create index invoices_day_idx on invoices (invoice_at);
create index stock_movements_batch_idx on stock_movements (batch_id, movement_at);
