create table if not exists outbound_jobs (
  id text primary key,
  phone_enc text not null,
  language text not null,
  kind text not null,
  template_name text not null,
  ref_type text not null,
  ref_id text not null,
  payload_enc text not null,
  document_key text,
  document_filename text,
  status text not null default 'queued',
  attempts integer not null default 0,
  external_id text,
  last_error text not null default '',
  created_at text not null,
  updated_at text not null,
  expires_at text
);

create table if not exists relay_events (
  id integer primary key autoincrement,
  event_type text not null,
  outbox_id text,
  external_id text,
  payload_enc text not null,
  created_at text not null
);

create table if not exists processed_webhooks (
  id text primary key,
  created_at text not null
);

create index if not exists outbound_jobs_status_idx on outbound_jobs(status, updated_at);
create index if not exists relay_events_id_idx on relay_events(id);
create index if not exists relay_events_created_idx on relay_events(created_at);
