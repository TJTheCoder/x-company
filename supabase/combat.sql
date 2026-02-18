-- Combat schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create table if not exists public.combat_state (
  id int primary key check (id = 1),
  map_url text null,
  zone_lines jsonb not null default '[]'::jsonb,
  token_positions jsonb not null default '[]'::jsonb,
  engagements jsonb not null default '[]'::jsonb,
  zone_loot jsonb not null default '[]'::jsonb,
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
  size int not null default 1,
  gear jsonb not null default '[]'::jsonb,
  arts jsonb not null default '[]'::jsonb,
  range_band text not null check (range_band in ('Engaged', 'Near', 'Close', 'Long')),
  traits jsonb not null default '[]'::jsonb,
  icon_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.combat_state add column if not exists zone_lines jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists token_positions jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists engagements jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists zone_loot jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists combat_mode boolean not null default false;
alter table public.combat_state add column if not exists initiative_monsters jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_entries jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_current_index int null;

alter table public.monsters add column if not exists name text;
alter table public.monsters add column if not exists physical int;
alter table public.monsters add column if not exists mental int;
alter table public.monsters add column if not exists special int;
alter table public.monsters add column if not exists size int;
alter table public.monsters add column if not exists gear jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists arts jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists range_band text;
alter table public.monsters add column if not exists traits jsonb not null default '[]'::jsonb;
alter table public.monsters add column if not exists icon_url text;
alter table public.monsters add column if not exists created_at timestamptz not null default now();
alter table public.monsters add column if not exists updated_at timestamptz not null default now();
alter table public.monsters alter column size set default 1;
update public.monsters set size = 1 where size is null;
alter table public.monsters alter column size set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'monsters'
      and column_name = 'tags'
  ) then
    update public.monsters
    set traits = tags
    where (traits is null or jsonb_typeof(traits) <> 'array' or jsonb_array_length(traits) = 0)
      and tags is not null;

    alter table public.monsters drop column if exists tags;
  end if;
end
$$;

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
  id, map_url, zone_lines, token_positions, engagements, zone_loot, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, updated_by_email
)
values (1, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, '[]'::jsonb, '[]'::jsonb, null, null)
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

create or replace function public.combat_engage_token(
  p_actor_token_id text,
  p_target_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_current_email text;
  v_mode boolean;
  v_edges jsonb;
  v_tokens jsonb;
  v_actor_exists boolean;
  v_target_exists boolean;
  v_component text[];
  v_changed boolean;
  e record;
  v_member text;
  v_a text;
  v_b text;
  v_actor_uuid uuid;
  v_actor_owner_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;

  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;

  if p_actor_token_id = p_target_token_id then
    raise exception 'Cannot engage yourself';
  end if;

  select combat_mode, initiative_entries, initiative_current_index, coalesce(engagements, '[]'::jsonb), coalesce(token_positions, '[]'::jsonb)
  into v_mode, v_entries, v_idx, v_edges, v_tokens
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

  select exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) into v_actor_exists;
  if not v_actor_exists then
    raise exception 'Actor token not found';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_target_token_id
  ) into v_target_exists;
  if not v_target_exists then
    raise exception 'Target token not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can engage';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only engage using your own character';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_edges) as ed(value)
    where ed.value->>'a' = p_actor_token_id
       or ed.value->>'b' = p_actor_token_id
  ) then
    raise exception 'Actor is already engaged';
  end if;

  v_component := array[p_target_token_id];
  loop
    v_changed := false;
    for e in
      select ed.value->>'a' as a, ed.value->>'b' as b
      from jsonb_array_elements(v_edges) as ed(value)
    loop
      if e.a is not null and e.b is not null then
        if (e.a = any(v_component)) and not (e.b = any(v_component)) then
          v_component := array_append(v_component, e.b);
          v_changed := true;
        elsif (e.b = any(v_component)) and not (e.a = any(v_component)) then
          v_component := array_append(v_component, e.a);
          v_changed := true;
        end if;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  foreach v_member in array v_component loop
    if v_member = p_actor_token_id then
      continue;
    end if;

    v_a := least(p_actor_token_id, v_member);
    v_b := greatest(p_actor_token_id, v_member);

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

grant execute on function public.combat_engage_token(text, text) to authenticated;

create or replace function public.combat_run_token(
  p_actor_token_id text,
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
  v_entries jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_current_kind text;
  v_current_participant text;
  v_current_email text;
  v_edges jsonb;
  v_tokens jsonb;
  v_mode boolean;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_is_monster boolean;
  v_other_token text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;

  if p_x < 0 or p_x > 1 or p_y < 0 or p_y > 1 then
    raise exception 'Token position must be normalized between 0 and 1';
  end if;

  select combat_mode,
         initiative_entries,
         initiative_current_index,
         coalesce(engagements, '[]'::jsonb),
         coalesce(token_positions, '[]'::jsonb)
  into v_mode, v_entries, v_idx, v_edges, v_tokens
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
  v_current_kind := coalesce(v_current ->> 'kind', '');
  v_current_participant := coalesce(v_current ->> 'participant_id', '');
  v_current_email := nullif(coalesce(v_current ->> 'user_email', ''), '');
  v_actor_is_monster := p_actor_token_id like 'monster:%';

  if not v_is_dm then
    if v_current_email is null or lower(v_current_email) <> lower(v_email) then
      raise exception 'Only the active player can run';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can run';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only run with your own character';
    end if;
  end if;

  if v_current_kind = 'monster' then
    if v_current_participant <> p_actor_token_id then
      raise exception 'Only the active participant can run';
    end if;
  elsif v_current_kind = 'player' then
    if v_current_participant <> ('player:' || p_actor_token_id) then
      raise exception 'Only the active participant can run';
    end if;
  else
    raise exception 'Invalid initiative participant';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;

  -- Cannot run while engaged with any enemy.
  for v_other_token in
    select case
             when ed.value->>'a' = p_actor_token_id then ed.value->>'b'
             when ed.value->>'b' = p_actor_token_id then ed.value->>'a'
             else null
           end as other_token
    from jsonb_array_elements(v_edges) as ed(value)
  loop
    if v_other_token is null then
      continue;
    end if;

    if (v_other_token like 'monster:%') <> v_actor_is_monster then
      raise exception 'Cannot run while engaged with an enemy';
    end if;
  end loop;

  -- Consume fast first, and if unavailable consume slow as fast.
  perform public.combat_use_fast_or_slow();

  -- Move token.
  v_tokens := coalesce(
    (
      select jsonb_agg(t.value)
      from jsonb_array_elements(v_tokens) as t(value)
      where coalesce(t.value->>'character_id', '') <> p_actor_token_id
    ),
    '[]'::jsonb
  );

  v_tokens := v_tokens || jsonb_build_array(
    jsonb_build_object(
      'character_id', p_actor_token_id,
      'x', p_x,
      'y', p_y
    )
  );

  -- Break all engagements involving the actor token (ally engagements).
  v_edges := coalesce(
    (
      select jsonb_agg(ed.value)
      from jsonb_array_elements(v_edges) as ed(value)
      where ed.value->>'a' <> p_actor_token_id
        and ed.value->>'b' <> p_actor_token_id
    ),
    '[]'::jsonb
  );

  update public.combat_state
  set token_positions = v_tokens,
      engagements = v_edges,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_run_token(text, double precision, double precision) to authenticated;

create or replace function public.combat_set_swing_weapon(
  p_weapon_item_id text,
  p_weapon_name text
)
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

  if p_weapon_item_id is null or btrim(p_weapon_item_id) = '' then
    raise exception 'Weapon item id is required';
  end if;
  if p_weapon_name is null or btrim(p_weapon_name) = '' then
    raise exception 'Weapon name is required';
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
  if v_email <> 'drocasma9@gmail.com' and (v_current_email is null or lower(v_current_email) <> lower(v_email)) then
    raise exception 'Only the active player can set swing';
  end if;

  v_current := jsonb_set(v_current, '{swing_weapon_item_id}', to_jsonb(p_weapon_item_id), true);
  v_current := jsonb_set(v_current, '{swing_weapon_name}', to_jsonb(p_weapon_name), true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_set_swing_weapon(text, text) to authenticated;

create or replace function public.combat_clear_swing_weapon()
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
  if v_email <> 'drocasma9@gmail.com' and (v_current_email is null or lower(v_current_email) <> lower(v_email)) then
    raise exception 'Only the active player can clear swing';
  end if;

  v_current := jsonb_set(v_current, '{swing_weapon_item_id}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, '{swing_weapon_name}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_clear_swing_weapon() to authenticated;

create or replace function public.combat_clear_swing_weapon_for_token(
  p_actor_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_count int;
  v_entry jsonb;
  v_entry_idx int;
  v_entry_kind text;
  v_entry_email text;
  v_actor_uuid uuid;
  v_actor_owner_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;

  select initiative_entries
  into v_entries
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

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    raise exception 'Actor participant not found';
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');

  if not v_is_dm then
    if v_entry_kind <> 'player' then
      raise exception 'Only player characters can clear swing';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can clear swing';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only clear swing for your own character';
    end if;

    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only clear swing for your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{swing_weapon_item_id}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{swing_weapon_name}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_clear_swing_weapon_for_token(text) to authenticated;

create or replace function public.combat_resolve_shove(
  p_actor_token_id text,
  p_target_token_id text,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_edges jsonb;
  v_tokens jsonb;
  v_mode boolean;
  v_actor_entry jsonb;
  v_target_entry jsonb;
  v_actor_idx int;
  v_target_idx int;
  v_actor_size int := 1;
  v_target_size int := 1;
  v_actor_uuid uuid;
  v_actor_owner_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;
  if p_actor_token_id = p_target_token_id then
    raise exception 'Cannot shove yourself';
  end if;

  select combat_mode,
         initiative_entries,
         coalesce(engagements, '[]'::jsonb),
         coalesce(token_positions, '[]'::jsonb)
  into v_mode, v_entries, v_edges, v_tokens
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;

  if v_entries is null then
    v_entries := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_entries) = 0 then
    raise exception 'No initiative entries';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_target_token_id
  ) then
    raise exception 'Target token not found';
  end if;

  select e.ord - 1, e.entry
  into v_actor_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  select e.ord - 1, e.entry
  into v_target_idx, v_target_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_target_token_id
     or e.entry->>'participant_id' = ('player:' || p_target_token_id)
  order by e.ord
  limit 1;

  if v_actor_idx is null then
    raise exception 'Actor participant not found';
  end if;
  if v_target_idx is null then
    raise exception 'Target participant not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can shove';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only shove using your own character';
    end if;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_edges) as ed(value)
    where (ed.value->>'a' = p_actor_token_id and ed.value->>'b' = p_target_token_id)
       or (ed.value->>'a' = p_target_token_id and ed.value->>'b' = p_actor_token_id)
  ) then
    raise exception 'Target is not engaged';
  end if;

  if coalesce(v_actor_entry->>'kind', '') = 'monster' then
    v_actor_size := coalesce((v_actor_entry->'monster_snapshot'->>'size')::int, 1);
  end if;
  if coalesce(v_target_entry->>'kind', '') = 'monster' then
    v_target_size := coalesce((v_target_entry->'monster_snapshot'->>'size')::int, 1);
  end if;

  if v_actor_size < v_target_size then
    raise exception 'Cannot shove larger target';
  end if;

  if coalesce(p_success, false) then
    v_target_entry := jsonb_set(v_target_entry, '{prone}', 'true'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_resolve_shove(text, text, boolean) to authenticated;

create or replace function public.combat_get_up_token(
  p_actor_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_count int;
  v_entry jsonb;
  v_entry_idx int;
  v_entry_kind text;
  v_entry_email text;
  v_actor_uuid uuid;
  v_actor_owner_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;

  select initiative_entries
  into v_entries
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

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    raise exception 'Actor participant not found';
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');

  if not v_is_dm then
    if v_entry_kind <> 'player' then
      raise exception 'Only player characters can get up';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can get up';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only get up with your own character';
    end if;

    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only get up with your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{prone}', 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_get_up_token(text) to authenticated;

create or replace function public.combat_resolve_disarm(
  p_actor_token_id text,
  p_target_token_id text,
  p_target_item_id text,
  p_zone_id int,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_monsters jsonb;
  v_tokens jsonb;
  v_zone_loot jsonb;
  v_mode boolean;
  v_actor_entry jsonb;
  v_target_entry jsonb;
  v_actor_idx int;
  v_target_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_target_uuid uuid;
  v_target_inventory jsonb;
  v_target_slots jsonb;
  v_target_item jsonb;
  v_target_item_name text;
  v_snapshot jsonb;
  v_snapshot_gear jsonb;
  v_snapshot_slots jsonb;
  v_monster_id text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;
  if p_target_item_id is null or btrim(p_target_item_id) = '' then
    raise exception 'Target item is required';
  end if;
  if p_zone_id is null or p_zone_id <= 0 then
    raise exception 'Zone is required';
  end if;

  select combat_mode,
         initiative_entries,
         initiative_monsters,
         coalesce(token_positions, '[]'::jsonb),
         coalesce(zone_loot, '[]'::jsonb)
  into v_mode, v_entries, v_monsters, v_tokens, v_zone_loot
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;

  if v_entries is null then
    v_entries := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_entries) = 0 then
    raise exception 'No initiative entries';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_target_token_id
  ) then
    raise exception 'Target token not found';
  end if;

  select e.ord - 1, e.entry
  into v_actor_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  select e.ord - 1, e.entry
  into v_target_idx, v_target_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_target_token_id
     or e.entry->>'participant_id' = ('player:' || p_target_token_id)
  order by e.ord
  limit 1;

  if v_actor_idx is null then
    raise exception 'Actor participant not found';
  end if;
  if v_target_idx is null then
    raise exception 'Target participant not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can disarm';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only disarm using your own character';
    end if;
  end if;

  if not coalesce(p_success, false) then
    return;
  end if;

  if coalesce(v_target_entry->>'kind', '') = 'player' then
    begin
      v_target_uuid := p_target_token_id::uuid;
    exception when others then
      raise exception 'Target character not found';
    end;

    select coalesce(inventory, '[]'::jsonb), coalesce(to_jsonb(equipment_slots), '{}'::jsonb)
    into v_target_inventory, v_target_slots
    from public.characters
    where id = v_target_uuid
    limit 1;

    if v_target_inventory is null then
      raise exception 'Target character not found';
    end if;

    select i.value into v_target_item
    from jsonb_array_elements(v_target_inventory) as i(value)
    where i.value->>'id' = p_target_item_id
    limit 1;

    if v_target_item is null then
      raise exception 'Target item not found';
    end if;
    if lower(coalesce(v_target_item->>'item_type', '')) = 'shield' then
      raise exception 'Cannot disarm shields';
    end if;

    v_target_item_name := coalesce(v_target_item->>'name', '');
    if coalesce(v_target_slots->>'left', '') <> p_target_item_id
       and coalesce(v_target_slots->>'right', '') <> p_target_item_id
       and coalesce(v_target_slots->>'left', '') <> v_target_item_name
       and coalesce(v_target_slots->>'right', '') <> v_target_item_name then
      raise exception 'Target is not holding that item';
    end if;

    v_target_inventory := coalesce(
      (
        select jsonb_agg(i.value)
        from jsonb_array_elements(v_target_inventory) as i(value)
        where coalesce(i.value->>'id', '') <> p_target_item_id
      ),
      '[]'::jsonb
    );

    if coalesce(v_target_slots->>'left', '') = p_target_item_id
       or coalesce(v_target_slots->>'left', '') = v_target_item_name then
      v_target_slots := jsonb_set(v_target_slots, '{left}', 'null'::jsonb, true);
    end if;
    if coalesce(v_target_slots->>'right', '') = p_target_item_id
       or coalesce(v_target_slots->>'right', '') = v_target_item_name then
      v_target_slots := jsonb_set(v_target_slots, '{right}', 'null'::jsonb, true);
    end if;

    update public.characters
    set inventory = v_target_inventory,
        equipment_slots = v_target_slots
    where id = v_target_uuid;
  else
    v_snapshot := coalesce(v_target_entry->'monster_snapshot', '{}'::jsonb);
    v_snapshot_gear := coalesce(v_snapshot->'gear', '[]'::jsonb);
    v_snapshot_slots := coalesce(v_snapshot->'equipment_slots', '{}'::jsonb);

    select i.value into v_target_item
    from jsonb_array_elements(v_snapshot_gear) as i(value)
    where i.value->>'id' = p_target_item_id
    limit 1;

    if v_target_item is null then
      raise exception 'Target item not found';
    end if;
    if lower(coalesce(v_target_item->>'item_type', '')) = 'shield' then
      raise exception 'Cannot disarm shields';
    end if;

    v_target_item_name := coalesce(v_target_item->>'name', '');
    if coalesce(v_snapshot_slots->>'left', '') <> p_target_item_id
       and coalesce(v_snapshot_slots->>'right', '') <> p_target_item_id
       and coalesce(v_snapshot_slots->>'left', '') <> v_target_item_name
       and coalesce(v_snapshot_slots->>'right', '') <> v_target_item_name then
      raise exception 'Target is not holding that item';
    end if;

    v_snapshot_gear := coalesce(
      (
        select jsonb_agg(i.value)
        from jsonb_array_elements(v_snapshot_gear) as i(value)
        where coalesce(i.value->>'id', '') <> p_target_item_id
      ),
      '[]'::jsonb
    );

    if coalesce(v_snapshot_slots->>'left', '') = p_target_item_id
       or coalesce(v_snapshot_slots->>'left', '') = v_target_item_name then
      v_snapshot_slots := jsonb_set(v_snapshot_slots, '{left}', 'null'::jsonb, true);
    end if;
    if coalesce(v_snapshot_slots->>'right', '') = p_target_item_id
       or coalesce(v_snapshot_slots->>'right', '') = v_target_item_name then
      v_snapshot_slots := jsonb_set(v_snapshot_slots, '{right}', 'null'::jsonb, true);
    end if;

    v_snapshot := jsonb_set(v_snapshot, '{gear}', v_snapshot_gear, true);
    v_snapshot := jsonb_set(v_snapshot, '{equipment_slots}', v_snapshot_slots, true);
    v_target_entry := jsonb_set(v_target_entry, '{monster_snapshot}', v_snapshot, true);
    v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

    v_monsters := coalesce(v_monsters, '[]'::jsonb);
    v_monster_id := coalesce(v_target_entry->>'participant_id', '');
    select coalesce(
      jsonb_agg(
        case
          when mon.value->>'id' = v_monster_id
          then jsonb_set(mon.value, '{monster_snapshot}', v_snapshot, true)
          else mon.value
        end
      ),
      '[]'::jsonb
    )
    into v_monsters
    from jsonb_array_elements(v_monsters) as mon(value);
  end if;

  v_zone_loot := coalesce(v_zone_loot, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'zone_id', p_zone_id,
      'item', v_target_item
    )
  );

  update public.combat_state
  set initiative_entries = v_entries,
      initiative_monsters = coalesce(v_monsters, initiative_monsters),
      zone_loot = v_zone_loot,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_resolve_disarm(text, text, text, int, boolean) to authenticated;

create or replace function public.combat_pick_up_zone_item(
  p_actor_token_id text,
  p_zone_id int,
  p_item_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_monsters jsonb;
  v_tokens jsonb;
  v_zone_loot jsonb;
  v_mode boolean;
  v_actor_entry jsonb;
  v_actor_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_drop jsonb;
  v_item jsonb;
  v_actor_snapshot jsonb;
  v_actor_gear jsonb;
  v_monster_id text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;
  if p_zone_id is null or p_zone_id <= 0 then
    raise exception 'Zone is required';
  end if;
  if p_item_id is null or btrim(p_item_id) = '' then
    raise exception 'Item is required';
  end if;

  select combat_mode,
         initiative_entries,
         initiative_monsters,
         coalesce(token_positions, '[]'::jsonb),
         coalesce(zone_loot, '[]'::jsonb)
  into v_mode, v_entries, v_monsters, v_tokens, v_zone_loot
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;
  if v_entries is null or jsonb_array_length(v_entries) = 0 then
    raise exception 'No initiative entries';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;

  select e.ord - 1, e.entry
  into v_actor_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_actor_idx is null then
    raise exception 'Actor participant not found';
  end if;

  if not v_is_dm then
    if coalesce(v_actor_entry->>'kind', '') <> 'player' then
      raise exception 'Only player characters can pick up items';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can pick up items';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only pick up items with your own character';
    end if;
  end if;

  select d.value into v_drop
  from jsonb_array_elements(v_zone_loot) as d(value)
  where (d.value->>'zone_id')::int = p_zone_id
    and coalesce(d.value->'item'->>'id', '') = p_item_id
  limit 1;

  if v_drop is null then
    raise exception 'Item not found in zone';
  end if;
  v_item := v_drop->'item';

  v_zone_loot := coalesce(
    (
      select jsonb_agg(d.value)
      from jsonb_array_elements(v_zone_loot) as d(value)
      where not (
        (d.value->>'zone_id')::int = p_zone_id
        and coalesce(d.value->'item'->>'id', '') = p_item_id
      )
    ),
    '[]'::jsonb
  );

  if coalesce(v_actor_entry->>'kind', '') = 'player' then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Actor character not found';
    end;

    update public.characters
    set inventory = coalesce(inventory, '[]'::jsonb) || jsonb_build_array(v_item)
    where id = v_actor_uuid;
  else
    v_actor_snapshot := coalesce(v_actor_entry->'monster_snapshot', '{}'::jsonb);
    v_actor_gear := coalesce(v_actor_snapshot->'gear', '[]'::jsonb) || jsonb_build_array(v_item);
    v_actor_snapshot := jsonb_set(v_actor_snapshot, '{gear}', v_actor_gear, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{monster_snapshot}', v_actor_snapshot, true);
    v_entries := jsonb_set(v_entries, array[v_actor_idx::text], v_actor_entry, false);

    v_monsters := coalesce(v_monsters, '[]'::jsonb);
    v_monster_id := coalesce(v_actor_entry->>'participant_id', '');
    select coalesce(
      jsonb_agg(
        case
          when m.value->>'id' = v_monster_id
          then jsonb_set(m.value, '{monster_snapshot}', v_actor_snapshot, true)
          else m.value
        end
      ),
      '[]'::jsonb
    )
    into v_monsters
    from jsonb_array_elements(v_monsters) as m(value);
  end if;

  update public.combat_state
  set initiative_entries = v_entries,
      initiative_monsters = coalesce(v_monsters, initiative_monsters),
      zone_loot = v_zone_loot,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_pick_up_zone_item(text, int, text) to authenticated;

create or replace function public.combat_break_engagement_token(
  p_actor_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_entries jsonb;
  v_mode boolean;
  v_edges jsonb;
  v_tokens jsonb;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_is_monster boolean;
  v_other_token text;
  v_has_enemy boolean := false;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;

  select combat_mode,
         initiative_entries,
         coalesce(engagements, '[]'::jsonb),
         coalesce(token_positions, '[]'::jsonb)
  into v_mode, v_entries, v_edges, v_tokens
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;

  if v_entries is null then
    v_entries := '[]'::jsonb;
  end if;
  if jsonb_array_length(v_entries) = 0 then
    raise exception 'No initiative entries';
  end if;
  v_actor_is_monster := p_actor_token_id like 'monster:%';

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can retreat';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only retreat with your own character';
    end if;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_tokens) as t(value)
    where t.value ->> 'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;

  for v_other_token in
    select case
             when ed.value->>'a' = p_actor_token_id then ed.value->>'b'
             when ed.value->>'b' = p_actor_token_id then ed.value->>'a'
             else null
           end as other_token
    from jsonb_array_elements(v_edges) as ed(value)
  loop
    if v_other_token is null then
      continue;
    end if;

    if (v_other_token like 'monster:%') <> v_actor_is_monster then
      v_has_enemy := true;
      exit;
    end if;
  end loop;

  if not v_has_enemy then
    raise exception 'Actor is not engaged with an enemy';
  end if;

  v_edges := coalesce(
    (
      select jsonb_agg(ed.value)
      from jsonb_array_elements(v_edges) as ed(value)
      where ed.value->>'a' <> p_actor_token_id
        and ed.value->>'b' <> p_actor_token_id
    ),
    '[]'::jsonb
  );

  update public.combat_state
  set engagements = v_edges,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_break_engagement_token(text) to authenticated;

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
