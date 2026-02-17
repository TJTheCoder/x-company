-- Combat schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create table if not exists public.combat_state (
  id int primary key check (id = 1),
  map_url text null,
  zone_lines jsonb not null default '[]'::jsonb,
  initiative_monsters jsonb not null default '[]'::jsonb,
  initiative_entries jsonb not null default '[]'::jsonb,
  initiative_current_index int null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

alter table public.combat_state add column if not exists zone_lines jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_monsters jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_entries jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_current_index int null;

create or replace function public.combat_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_combat_state_updated_at on public.combat_state;
create trigger trg_combat_state_updated_at
before update on public.combat_state
for each row execute function public.combat_set_updated_at();

alter table public.combat_state enable row level security;

drop policy if exists combat_state_select on public.combat_state;
create policy combat_state_select on public.combat_state
for select to authenticated using (true);

drop policy if exists combat_state_insert_dm on public.combat_state;
create policy combat_state_insert_dm on public.combat_state
for insert to authenticated
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

drop policy if exists combat_state_update_dm on public.combat_state;
create policy combat_state_update_dm on public.combat_state
for update to authenticated
using (auth.jwt() ->> 'email' = 'drocasma9@gmail.com')
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

insert into public.combat_state (
  id, map_url, zone_lines, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email
)
values (1, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
on conflict (id) do nothing;

create or replace function public.combat_pass_turn()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_entries jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_current_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  select initiative_entries, initiative_current_index
  into v_entries, v_idx
  from public.combat_state
  where id = 1
  for update;

  if v_entries is null then
    v_entries := '[]'::jsonb;
  end if;

  v_count := jsonb_array_length(v_entries);
  if v_count = 0 then
    raise exception 'No initiative entries';
  end if;

  if v_idx is null or v_idx < 0 or v_idx >= v_count then
    v_idx := 0;
  end if;

  v_current := v_entries -> v_idx;
  v_current_email := nullif(coalesce(v_current ->> 'user_email', ''), '');

  if v_email <> 'drocasma9@gmail.com' and (v_current_email is null or v_current_email <> v_email) then
    raise exception 'Only the active player can pass';
  end if;

  update public.combat_state
  set initiative_current_index = case when v_idx + 1 >= v_count then 0 else v_idx + 1 end,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_pass_turn() to authenticated;

insert into storage.buckets (id, name, public)
values ('combat-assets', 'combat-assets', true)
on conflict (id) do nothing;

drop policy if exists combat_assets_public_read on storage.objects;
create policy combat_assets_public_read on storage.objects
for select to authenticated
using (bucket_id = 'combat-assets');

drop policy if exists combat_assets_dm_insert on storage.objects;
create policy combat_assets_dm_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'combat-assets'
  and auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
);

drop policy if exists combat_assets_dm_update on storage.objects;
create policy combat_assets_dm_update on storage.objects
for update to authenticated
using (
  bucket_id = 'combat-assets'
  and auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
)
with check (
  bucket_id = 'combat-assets'
  and auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
);

drop policy if exists combat_assets_dm_delete on storage.objects;
create policy combat_assets_dm_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'combat-assets'
  and auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'combat_state'
  ) then
    alter publication supabase_realtime add table public.combat_state;
  end if;
end
$$;
