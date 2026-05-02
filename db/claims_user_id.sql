alter table public.claims
  add column if not exists user_id uuid;

create index if not exists claims_user_id_idx
  on public.claims (user_id);
