-- Combat schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create table if not exists public.combat_state (
  id int primary key check (id = 1),
  map_url text null,
  zone_lines jsonb not null default '[]'::jsonb,
  token_positions jsonb not null default '[]'::jsonb,
  initiative_monsters jsonb not null default '[]'::jsonb,
  initiative_entries jsonb not null default '[]'::jsonb,
  initiative_current_index int null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

alter table public.combat_state add column if not exists zone_lines jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists token_positions jsonb not null default '[]'::jsonb;
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
  id, map_url, zone_lines, token_positions, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email
)
values (1, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null, null)
on conflict (id) do nothing;

create or replace function public.combat_upsert_player_token(
  p_character_id uuid,
  p_x double precision,
  p_y double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_owner_email text;
  v_tokens jsonb;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_x < 0 or p_x > 1 or p_y < 0 or p_y > 1 then
    raise exception 'Token position must be normalized between 0 and 1';
  end if;

  select email into v_owner_email
  from public.characters
  where id = p_character_id
  limit 1;

  if v_owner_email is null then
    raise exception 'Character not found';
  end if;

  if not v_is_dm and v_owner_email <> v_email then
    raise exception 'You can only place your own token';
  end if;

  select coalesce(token_positions, '[]'::jsonb)
  into v_tokens
  from public.combat_state
  where id = 1
  for update;

  v_tokens := coalesce(
    (
      select jsonb_agg(t.value)
      from jsonb_array_elements(v_tokens) as t(value)
      where coalesce(t.value->>'character_id', '') <> p_character_id::text
    ),
    '[]'::jsonb
  );

  v_tokens := v_tokens || jsonb_build_array(
    jsonb_build_object(
      'character_id', p_character_id::text,
      'x', p_x,
      'y', p_y
    )
  );

  update public.combat_state
  set token_positions = v_tokens,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_upsert_player_token(uuid, double precision, double precision) to authenticated;

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
  v_next_idx int;
  v_count int;
  v_current jsonb;
  v_current_email text;
  v_reset_entries jsonb;
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

  v_next_idx := case when v_idx + 1 >= v_count then 0 else v_idx + 1 end;

  if v_next_idx = 0 and v_count > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_set(
          jsonb_set(e.entry, '{fast_available}', 'true'::jsonb, true),
          '{slow_available}', 'true'::jsonb, true
        ) order by e.ord
      ),
      '[]'::jsonb
    )
    into v_reset_entries
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord);

    update public.combat_state
    set initiative_current_index = v_next_idx,
        initiative_entries = v_reset_entries,
        updated_by_email = v_email
    where id = 1;
  else
    update public.combat_state
    set initiative_current_index = v_next_idx,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_pass_turn() to authenticated;

create or replace function public.combat_use_action(p_action text)
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
  v_key text;
  v_available boolean;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_action not in ('fast', 'slow') then
    raise exception 'Invalid action type';
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
    raise exception 'Only the active player can use actions';
  end if;

  v_key := case when p_action = 'fast' then 'fast_available' else 'slow_available' end;
  v_available := coalesce((v_current ->> v_key)::boolean, true);
  if not v_available then
    raise exception 'Action already used';
  end if;

  v_current := jsonb_set(v_current, array[v_key], 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_use_action(text) to authenticated;

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
