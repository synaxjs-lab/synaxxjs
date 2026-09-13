-- SYNAX persistent state store
-- Run this once in the Supabase SQL Editor.
create table if not exists public.synax_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- The SYNAX server uses the service-role key server-side, so public clients do not need direct table access.
alter table public.synax_state enable row level security;

