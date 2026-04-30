create table if not exists public.place_snapshots (
  cache_key text primary key,
  grid_key text not null,
  category text not null default 'alla',
  payload jsonb not null,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null,
  version integer not null default 1
);

create index if not exists place_snapshots_expires_at_idx
  on public.place_snapshots (expires_at);

create index if not exists place_snapshots_grid_category_idx
  on public.place_snapshots (grid_key, category);
