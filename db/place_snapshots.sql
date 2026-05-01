alter table public.restaurants
  add column if not exists claimed boolean not null default false,
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claim_email text,
  add column if not exists claimed_at timestamptz;

create index if not exists restaurants_claimed_by_user_id_idx
  on public.restaurants (claimed_by_user_id);

create unique index if not exists restaurants_osm_id_unique_idx
  on public.restaurants (osm_id);

-- Recommended RLS baseline for dashboard writes.
-- Enable only after checking existing policies in Supabase.
alter table public.restaurants enable row level security;
alter table public.menus enable row level security;
alter table public.opening_hours enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'restaurants'
    and policyname = 'owners can read their restaurants'
  ) then
    create policy "owners can read their restaurants"
      on public.restaurants for select
      using (claimed_by_user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'restaurants'
    and policyname = 'owners can update their restaurants'
  ) then
    create policy "owners can update their restaurants"
      on public.restaurants for update
      using (claimed_by_user_id = auth.uid())
      with check (claimed_by_user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'menus'
    and policyname = 'owners can manage menus'
  ) then
    create policy "owners can manage menus"
      on public.menus for all
      using (
        exists (
          select 1 from public.restaurants r
          where r.id = menus.restaurant_id
          and r.claimed_by_user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.restaurants r
          where r.id = menus.restaurant_id
          and r.claimed_by_user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'opening_hours'
    and policyname = 'owners can manage opening hours'
  ) then
    create policy "owners can manage opening hours"
      on public.opening_hours for all
      using (
        exists (
          select 1 from public.restaurants r
          where r.id = opening_hours.restaurant_id
          and r.claimed_by_user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1 from public.restaurants r
          where r.id = opening_hours.restaurant_id
          and r.claimed_by_user_id = auth.uid()
        )
      );
  end if;
end $$;
