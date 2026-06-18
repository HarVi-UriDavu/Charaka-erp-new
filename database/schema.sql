-- Charaka Clinic ERP PostgreSQL core schema.
-- This is the target database backend for the local clinic-server deployment.

begin;

create extension if not exists pg_trgm;

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists sequences (
  key text primary key,
  value bigint not null default 0
);

create table if not exists roles (
  id text primary key,
  name text not null unique,
  description text not null default ''
);

create table if not exists permissions (
  id text primary key,
  name text not null unique,
  description text not null default ''
);

create table if not exists role_permissions (
  role_id text not null references roles(id) on delete cascade,
  permission_id text not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists users (
  id text primary key,
  name text not null,
  role_id text not null references roles(id),
  pin_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists doctors (
  id text primary key,
  user_id text references users(id),
  name text not null,
  qualification text not null default '',
  reg_no text not null default '',
  consult_fee numeric(12,2) not null default 0,
  follow_up_fee numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patients (
  id text primary key,
  uhid text not null unique,
  first_name text not null,
  last_name text not null,
  gender text not null check (gender in ('M', 'F', 'O')),
  dob date not null,
  mobile text not null,
  guardian_rel text not null default 'C/o',
  guardian_name text not null,
  address text not null default '',
  blood_group text not null default '',
  allergies text not null default 'Nil known',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table patients add column if not exists whatsapp_consent boolean not null default false;
alter table patients add column if not exists whatsapp_consent_at timestamptz;
alter table patients add column if not exists whatsapp_consent_by text references users(id);
alter table patients add column if not exists whatsapp_language text not null default 'en' check (whatsapp_language in ('en', 'te'));
alter table patients add column if not exists whatsapp_opted_out boolean not null default false;
alter table patients add column if not exists whatsapp_number_confirmed boolean not null default false;

create table if not exists patient_weight_history (
  id bigserial primary key,
  patient_id text not null references patients(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  weight_kg numeric(8,2) not null check (weight_kg > 0)
);

create table if not exists services (
  id text primary key,
  code text not null unique,
  name text not null,
  category text not null default 'OPD',
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists visits (
  id text primary key,
  voucher_no text not null unique,
  patient_id text not null references patients(id),
  doctor_id text not null references doctors(id),
  visit_at timestamptz not null default now(),
  status text not null check (status in ('waiting', 'in-consult', 'done', 'cancelled')),
  notes text not null default '',
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_by text references users(id),
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table visits add column if not exists follow_up_date date;
alter table visits add column if not exists follow_up_reason text not null default '';

create table if not exists vitals (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  weight_kg numeric(8,2),
  height_cm numeric(8,2),
  temp_f numeric(8,2),
  pulse integer,
  recorded_at timestamptz not null default now(),
  recorded_by text references users(id)
);

create table if not exists visit_items (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  service_id text references services(id),
  name text not null,
  qty numeric(10,2) not null default 1,
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0
);

create table if not exists prescriptions (
  id bigserial primary key,
  visit_id text not null references visits(id) on delete cascade,
  drug_id text,
  name text not null,
  dose text not null default '',
  frequency text not null default '',
  days integer not null default 0,
  qty numeric(10,2) not null default 1,
  notes text not null default ''
);

create table if not exists suppliers (
  id text primary key,
  name text not null,
  gstin text not null default '',
  phone text not null default '',
  city text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drugs (
  id text primary key,
  name text not null unique,
  form text not null default '',
  pack text not null default '',
  hsn text not null default '',
  mrp numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0,
  reorder_level integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drug_batches (
  id text primary key,
  drug_id text not null references drugs(id),
  batch text not null,
  expiry date not null,
  qty numeric(12,2) not null default 0,
  purchase_rate numeric(12,2) not null default 0,
  mrp numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drug_id, batch)
);

create table if not exists purchases (
  id text primary key,
  voucher_no text not null unique,
  supplier_id text not null references suppliers(id),
  invoice_no text not null,
  purchase_at timestamptz not null default now(),
  total numeric(12,2) not null default 0,
  created_by text references users(id),
  status text not null default 'posted' check (status in ('draft', 'posted', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists purchase_items (
  id bigserial primary key,
  purchase_id text not null references purchases(id) on delete cascade,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  qty numeric(12,2) not null check (qty > 0),
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0,
  mrp numeric(12,2) not null default 0
);

create table if not exists pharmacy_sales (
  id text primary key,
  voucher_no text not null unique,
  patient_id text references patients(id),
  linked_visit_id text references visits(id),
  sale_at timestamptz not null default now(),
  total numeric(12,2) not null default 0,
  status text not null default 'paid' check (status in ('paid', 'cancelled')),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists sale_items (
  id bigserial primary key,
  sale_id text not null references pharmacy_sales(id) on delete cascade,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  name text not null,
  qty numeric(12,2) not null check (qty > 0),
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0
);

create table if not exists sales_returns (
  id text primary key,
  voucher_no text not null unique,
  sale_id text not null references pharmacy_sales(id),
  reason text not null default '',
  return_at timestamptz not null default now(),
  amount numeric(12,2) not null default 0,
  created_by text references users(id),
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists return_items (
  id bigserial primary key,
  return_id text not null references sales_returns(id) on delete cascade,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  qty numeric(12,2) not null check (qty > 0),
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0
);

create table if not exists invoices (
  id text primary key,
  kind text not null check (kind in ('OPD', 'PHARMACY')),
  ref_id text not null,
  voucher_no text not null,
  party_id text,
  invoice_at timestamptz not null default now(),
  total numeric(12,2) not null default 0,
  status text not null default 'paid' check (status in ('paid', 'cancelled')),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id bigserial primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  name text not null,
  qty numeric(12,2) not null default 1,
  rate numeric(12,2) not null default 0,
  gst numeric(5,2) not null default 0
);

create table if not exists payments (
  id bigserial primary key,
  invoice_id text not null references invoices(id) on delete cascade,
  mode text not null check (mode in ('Cash', 'UPI')),
  amount numeric(12,2) not null check (amount >= 0),
  paid_at timestamptz not null default now()
);

create table if not exists stock_movements (
  id text primary key,
  movement_at timestamptz not null default now(),
  kind text not null check (kind in ('OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT')),
  ref_id text not null,
  drug_id text not null references drugs(id),
  batch_id text not null references drug_batches(id),
  qty numeric(12,2) not null,
  note text not null default '',
  created_by text references users(id)
);

create table if not exists import_jobs (
  id text primary key,
  entity text not null,
  imported integer not null default 0,
  failed integer not null default 0,
  errors jsonb not null default '[]',
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists backup_jobs (
  id bigserial primary key,
  kind text not null check (kind in ('manual', 'scheduled')),
  file_path text not null,
  status text not null default 'created' check (status in ('created', 'failed', 'restored')),
  details jsonb not null default '{}',
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists vaccines (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vaccinations (
  id text primary key,
  patient_id text not null references patients(id),
  vaccine_id text not null references vaccines(id),
  administered_at date not null,
  batch_no text not null default '',
  administered_by text references users(id),
  next_vaccine_id text references vaccines(id),
  next_due_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_outbox (
  id text primary key,
  patient_id text references patients(id),
  phone text not null,
  language text not null default 'en' check (language in ('en', 'te')),
  kind text not null check (kind in ('document', 'followup_reminder', 'vaccine_reminder', 'menu_reply')),
  template_name text not null,
  ref_type text not null,
  ref_id text not null,
  document_kind text check (document_kind in ('opd_receipt', 'prescription', 'pharmacy_invoice')),
  idempotency_key text not null unique,
  payload jsonb not null default '{}',
  scheduled_for timestamptz not null default now(),
  status text not null check (status in ('blocked_no_consent', 'queued', 'sent', 'delivered', 'read', 'failed', 'opted_out')),
  attempts integer not null default 0,
  external_id text,
  last_error text not null default '',
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_delivery_events (
  id bigserial primary key,
  outbox_id text references whatsapp_outbox(id) on delete set null,
  external_id text,
  event_type text not null,
  event_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  unique (external_id, event_type, event_at)
);

create table if not exists reminder_jobs (
  id text primary key,
  patient_id text not null references patients(id),
  kind text not null check (kind in ('followup', 'vaccine')),
  ref_type text not null,
  ref_id text not null,
  due_date date not null,
  remind_at timestamptz not null,
  offset_days integer not null,
  status text not null default 'pending' check (status in ('pending', 'queued', 'sent', 'cancelled', 'failed')),
  outbox_id text references whatsapp_outbox(id),
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists callback_requests (
  id text primary key,
  patient_id text references patients(id),
  phone text not null,
  language text not null default 'en' check (language in ('en', 'te')),
  status text not null default 'open' check (status in ('open', 'contacted', 'closed')),
  source_message_id text,
  notes text not null default '',
  requested_at timestamptz not null default now(),
  handled_by text references users(id),
  handled_at timestamptz
);

create table if not exists audit_logs (
  id text primary key,
  at timestamptz not null default now(),
  user_id text references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  details jsonb not null default '{}'
);

create index if not exists patients_name_trgm_idx on patients using gin ((first_name || ' ' || last_name) gin_trgm_ops);
create index if not exists patients_uhid_idx on patients (uhid);
create index if not exists patients_mobile_idx on patients (mobile);
create index if not exists visits_patient_day_idx on visits (patient_id, visit_at desc);
create index if not exists visits_status_day_idx on visits (status, visit_at desc);
create index if not exists invoices_day_idx on invoices (invoice_at desc);
create index if not exists invoices_kind_day_idx on invoices (kind, invoice_at desc);
create index if not exists drug_batches_drug_expiry_idx on drug_batches (drug_id, expiry);
create index if not exists stock_movements_batch_idx on stock_movements (batch_id, movement_at desc);
create index if not exists audit_logs_at_idx on audit_logs (at desc);
create index if not exists whatsapp_outbox_status_due_idx on whatsapp_outbox (status, scheduled_for);
create index if not exists whatsapp_outbox_patient_idx on whatsapp_outbox (patient_id, created_at desc);
create index if not exists reminder_jobs_due_idx on reminder_jobs (status, remind_at);
create index if not exists vaccinations_patient_idx on vaccinations (patient_id, administered_at desc);
create index if not exists callback_requests_status_idx on callback_requests (status, requested_at desc);

insert into permissions (id, name, description) values
  ('dashboard', 'Dashboard', 'View operational dashboard'),
  ('reception', 'Reception', 'Register patients and create OPD visits'),
  ('clinical', 'Clinical', 'View doctor queue and save clinical notes'),
  ('pharmacy', 'Pharmacy', 'Manage pharmacy sales, purchases, stock, and returns'),
  ('billing', 'Billing', 'View daybook and collections'),
  ('messages', 'Messages', 'Manage WhatsApp delivery and callback requests'),
  ('reports', 'Reports', 'View reports and audit data'),
  ('masters', 'Masters', 'Manage master data and imports'),
  ('settings', 'Settings', 'Manage clinic settings and backups')
on conflict (id) do nothing;

insert into roles (id, name, description) values
  ('doctor', 'Doctor', 'Doctor room user'),
  ('reception', 'Reception', 'Reception desk user'),
  ('pharmacist', 'Pharmacy', 'Pharmacy counter user'),
  ('admin', 'Admin', 'Clinic administrator')
on conflict (id) do nothing;

insert into role_permissions (role_id, permission_id)
select role_id, permission_id
from (values
  ('doctor', 'dashboard'), ('doctor', 'clinical'), ('doctor', 'reception'), ('doctor', 'reports'),
  ('reception', 'dashboard'), ('reception', 'reception'), ('reception', 'billing'), ('reception', 'messages'),
  ('pharmacist', 'dashboard'), ('pharmacist', 'pharmacy'), ('pharmacist', 'billing'), ('pharmacist', 'messages'),
  ('admin', 'dashboard'), ('admin', 'reception'), ('admin', 'clinical'), ('admin', 'pharmacy'),
  ('admin', 'billing'), ('admin', 'messages'), ('admin', 'reports'), ('admin', 'masters'), ('admin', 'settings')
) as rp(role_id, permission_id)
on conflict do nothing;

insert into sequences (key, value) values
  ('patient', 240),
  ('opd', 25),
  ('pharmacy', 123),
  ('purchase', 46),
  ('return', 8),
  ('invoice', 200),
  ('audit', 1),
  ('stock', 1),
  ('importJob', 1),
  ('whatsapp', 0),
  ('reminder', 0),
  ('vaccine', 0),
  ('vaccination', 0),
  ('callback', 0)
on conflict (key) do nothing;

commit;
