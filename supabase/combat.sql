-- Combat schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create table if not exists public.combat_state (
  id int primary key check (id = 1),
  map_url text null,
  zone_lines jsonb not null default '[]'::jsonb,
  token_positions jsonb not null default '[]'::jsonb,
  engagements jsonb not null default '[]'::jsonb,
  combat_mode boolean not null default false,
  initiative_monsters jsonb not null default '[]'::jsonb,
  initiative_entries jsonb not null default '[]'::jsonb,
  initiative_current_index int null,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

create table if not exists public.monsters (
  id uuid primary key,
  name text not null,
  physical int not null check (physical > 0),
  mental int not null check (mental > 0),
  special int not null check (special >= 0),
  gear jsonb not null default '[]'::jsonb,
  arts jsonb not null default '[]'::jsonb,
  range_band text not null check (range_band in ('Engaged', 'Near', 'Close', 'Long')),
  tags jsonb not null default '[]'::jsonb,
  icon_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.combat_state add column if not exists zone_lines jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists token_positions jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists engagements jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists combat_mode boolean not null default false;
alter table public.combat_state add column if not exists initiative_monsters jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_entries jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_current_index int null;

alter table public.monsters add column if not exists name text;
alter table public.monsters add column if not exists physical int;
alter table public.monsters add column if not exists mental int;
alter table public.monsters add column if not exists special int;
alter table public.monsters add column if not exists gear jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists arts jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists range_band text;
alter table public.monsters add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists icon_url text;
alter table public.monsters add column if not exists created_at timestamptz not null default now();
alter table public.monsters add column if not exists updated_at timestamptz not null default now();

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

drop trigger if exists trg_monsters_updated_at on public.monsters;
create trigger trg_monsters_updated_at
before update on public.monsters
for each row execute function public.combat_set_updated_at();

alter table public.combat_state enable row level security;
alter table public.monsters enable row level security;

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

drop policy if exists monsters_select on public.monsters;
create policy monsters_select on public.monsters
for select to authenticated using (true);

drop policy if exists monsters_insert_dm on public.monsters;
create policy monsters_insert_dm on public.monsters
for insert to authenticated
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

drop policy if exists monsters_update_dm on public.monsters;
create policy monsters_update_dm on public.monsters
for update to authenticated
using (auth.jwt() ->> 'email' = 'drocasma9@gmail.com')
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

drop policy if exists monsters_delete_dm on public.monsters;
create policy monsters_delete_dm on public.monsters
for delete to authenticated
using (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

insert into public.combat_state (
  id, map_url, zone_lines, token_positions, engagements, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email
)
values (1, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, '[]'::jsonb, '[]'::jsonb, null, null)
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
  v_after_fast boolean;
  v_after_slow boolean;
  v_next_idx int;
  v_reset_entries jsonb;
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
  v_after_fast := coalesce((v_current ->> 'fast_available')::boolean, true);
  v_after_slow := coalesce((v_current ->> 'slow_available')::boolean, true);

  if not v_after_fast and not v_after_slow then
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
      set initiative_entries = v_reset_entries,
          initiative_current_index = v_next_idx,
          updated_by_email = v_email
      where id = 1;
    else
      update public.combat_state
      set initiative_entries = v_entries,
          initiative_current_index = v_next_idx,
          updated_by_email = v_email
      where id = 1;
    end if;
  else
    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_use_action(text) to authenticated;

create or replace function public.combat_use_fast_or_slow()
returns text
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
  v_fast boolean;
  v_slow boolean;
  v_key text;
  v_next_idx int;
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
    raise exception 'Only the active player can use actions';
  end if;

  v_fast := coalesce((v_current ->> 'fast_available')::boolean, true);
  v_slow := coalesce((v_current ->> 'slow_available')::boolean, true);

  if v_fast then
    v_key := 'fast_available';
  elsif v_slow then
    v_key := 'slow_available';
  else
    raise exception 'No fast or slow action available';
  end if;

  v_current := jsonb_set(v_current, array[v_key], 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);
  v_fast := coalesce((v_current ->> 'fast_available')::boolean, true);
  v_slow := coalesce((v_current ->> 'slow_available')::boolean, true);

  if not v_fast and not v_slow then
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
      set initiative_entries = v_reset_entries,
          initiative_current_index = v_next_idx,
          updated_by_email = v_email
      where id = 1;
    else
      update public.combat_state
      set initiative_entries = v_entries,
          initiative_current_index = v_next_idx,
          updated_by_email = v_email
      where id = 1;
    end if;
  else
    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;

  return case when v_key = 'fast_available' then 'fast' else 'slow' end;
end;
$$;

grant execute on function public.combat_use_fast_or_slow() to authenticated;

create or replace function public.combat_engage(
  p_actor_character_id uuid,
  p_target_character_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_actor_email text;
  v_target_email text;
  v_entries jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_current_email text;
  v_mode boolean;
  v_edges jsonb;
  v_component uuid[];
  v_changed boolean;
  e record;
  v_member uuid;
  v_a text;
  v_b text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_character_id is null or p_target_character_id is null then
    raise exception 'Actor and target are required';
  end if;

  if p_actor_character_id = p_target_character_id then
    raise exception 'Cannot engage yourself';
  end if;

  select email into v_actor_email
  from public.characters
  where id = p_actor_character_id
  limit 1;

  if v_actor_email is null then
    raise exception 'Actor character not found';
  end if;

  select email into v_target_email
  from public.characters
  where id = p_target_character_id
  limit 1;

  if v_target_email is null then
    raise exception 'Target character not found';
  end if;

  if not v_is_dm and lower(v_actor_email) <> lower(v_email) then
    raise exception 'You can only engage using your own character';
  end if;

  select combat_mode, initiative_entries, initiative_current_index, coalesce(engagements, '[]'::jsonb)
  into v_mode, v_entries, v_idx, v_edges
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;

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

  if not v_is_dm and (v_current_email is null or lower(v_current_email) <> lower(v_email)) then
    raise exception 'Only the active player can engage';
  end if;

  -- Actor must not already be engaged with anyone.
  if exists (
    select 1
    from jsonb_array_elements(v_edges) as ed(value)
    where ed.value->>'a' = p_actor_character_id::text
       or ed.value->>'b' = p_actor_character_id::text
  ) then
    raise exception 'Actor is already engaged';
  end if;

  -- Build connected component for target from existing engagements.
  v_component := array[p_target_character_id];
  loop
    v_changed := false;
    for e in
      select ed.value->>'a' as a, ed.value->>'b' as b
      from jsonb_array_elements(v_edges) as ed(value)
    loop
      if e.a is not null and e.b is not null then
        if (e.a::uuid = any(v_component)) and not (e.b::uuid = any(v_component)) then
          v_component := array_append(v_component, e.b::uuid);
          v_changed := true;
        elsif (e.b::uuid = any(v_component)) and not (e.a::uuid = any(v_component)) then
          v_component := array_append(v_component, e.a::uuid);
          v_changed := true;
        end if;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  -- Add actor edges to every participant in target's connected component.
  foreach v_member in array v_component loop
    if v_member = p_actor_character_id then
      continue;
    end if;

    v_a := least(p_actor_character_id::text, v_member::text);
    v_b := greatest(p_actor_character_id::text, v_member::text);

    if not exists (
      select 1
      from jsonb_array_elements(v_edges) as ed(value)
      where ed.value->>'a' = v_a
        and ed.value->>'b' = v_b
    ) then
      v_edges := v_edges || jsonb_build_array(jsonb_build_object('a', v_a, 'b', v_b));
    end if;
  end loop;

  update public.combat_state
  set engagements = v_edges,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_engage(uuid, uuid) to authenticated;

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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monsters'
  ) then
    alter publication supabase_realtime add table public.monsters;
  end if;
end
$$;
