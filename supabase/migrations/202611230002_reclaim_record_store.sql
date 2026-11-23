create table if not exists public.reclaim_record_store (
  id text primary key check (id = 'workspace'),
  revision bigint not null default 1,
  payload jsonb not null
);

alter table public.reclaim_record_store enable row level security;
revoke all on public.reclaim_record_store from public, anon, authenticated;
grant select, insert, update on public.reclaim_record_store to service_role;
