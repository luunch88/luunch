create extension if not exists pgcrypto;

create table if not exists public.place_snapshots (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  grid_key text not null,
  category text not null,
  payload_json jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists place_snapshots_cache_key_idx
  on public.place_snapshots (cache_key);

create index if not exists place_snapshots_expires_at_idx
  on public.place_snapshots (expires_at);

create index if not exists place_snapshots_grid_key_idx
  on public.place_snapshots (grid_key);
