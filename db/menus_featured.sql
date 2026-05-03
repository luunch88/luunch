alter table public.menus
add column if not exists is_featured boolean default false;

alter table public.menus
alter column is_featured set default false;

update public.menus
set is_featured = false
where is_featured is null;

create index if not exists menus_restaurant_featured_idx
on public.menus (restaurant_id, is_featured);

notify pgrst, 'reload schema';
