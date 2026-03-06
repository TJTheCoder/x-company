-- Combat schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create table if not exists public.combat_state (
  id int primary key check (id = 1),
  map_url text null,
  zone_lines jsonb not null default '[]'::jsonb,
  zone_cover jsonb not null default '[]'::jsonb,
  token_positions jsonb not null default '[]'::jsonb,
  token_elevations jsonb not null default '[]'::jsonb,
  engagements jsonb not null default '[]'::jsonb,
  zone_loot jsonb not null default '[]'::jsonb,
  combat_mode boolean not null default false,
  initiative_monsters jsonb not null default '[]'::jsonb,
  initiative_entries jsonb not null default '[]'::jsonb,
  initiative_current_index int null,
  pending_reactions jsonb not null default '[]'::jsonb,
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
alter table public.combat_state add column if not exists zone_cover jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists token_positions jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists token_elevations jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists engagements jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists zone_loot jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists combat_mode boolean not null default false;
alter table public.combat_state add column if not exists initiative_monsters jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_entries jsonb not null default '[]'::jsonb;
alter table public.combat_state add column if not exists initiative_current_index int null;
alter table public.combat_state add column if not exists pending_reactions jsonb not null default '[]'::jsonb;

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
alter table public.characters add column if not exists dead boolean not null default false;
alter table public.characters add column if not exists talent_levels jsonb not null default '{}'::jsonb;
alter table public.characters add column if not exists talents jsonb not null default '[]'::jsonb;

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

create or replace function public.combat_force_mode_off_when_empty()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.combat_mode, false) = true and (
    jsonb_typeof(coalesce(new.initiative_entries, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(new.initiative_entries, '[]'::jsonb)) = 0
  ) then
    new.combat_mode = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_combat_force_mode_off_when_empty on public.combat_state;
create trigger trg_combat_force_mode_off_when_empty
before update of initiative_entries, combat_mode on public.combat_state
for each row execute function public.combat_force_mode_off_when_empty();

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
  id, map_url, zone_lines, zone_cover, token_positions, token_elevations, engagements, zone_loot, combat_mode, initiative_monsters, initiative_entries, initiative_current_index, pending_reactions, updated_by_email
)
values (1, null, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, '[]'::jsonb, '[]'::jsonb, null, '[]'::jsonb, null)
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
  v_elevations jsonb;
  v_entries jsonb;
  v_actor_entry jsonb;
  v_actor_idx int;
  v_attached_token_ids text[] := array[]::text[];
  v_attached_token_id text;
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

  select coalesce(token_positions, '[]'::jsonb), coalesce(token_elevations, '[]'::jsonb), coalesce(initiative_entries, '[]'::jsonb)
  into v_tokens, v_elevations, v_entries
  from public.combat_state
  where id = 1
  for update;

  select e.ord - 1, e.entry
  into v_actor_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_character_id::text
     or e.entry->>'participant_id' = ('player:' || p_character_id::text)
  order by e.ord
  limit 1;

  if v_actor_idx is not null then
    v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '');
    if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
    v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappled_by_id', ''), '');
    if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
    v_attached_token_id := nullif(coalesce(v_actor_entry->>'clinging_target_id', ''), '');
    if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
    v_attached_token_id := nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '');
    if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
    for v_attached_token_id in
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array' then v_actor_entry->'clung_onto_by_ids'
          else '[]'::jsonb
        end
      )
    loop
      if v_attached_token_id is not null and btrim(v_attached_token_id) <> '' and not (v_attached_token_id = any(v_attached_token_ids)) then
        v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
      end if;
    end loop;

    if array_length(v_attached_token_ids, 1) is not null then
      v_attached_token_ids := array_remove(v_attached_token_ids, p_character_id::text);
    end if;

    if nullif(coalesce(v_actor_entry->>'clinging_target_id', ''), '') is not null then
      raise exception 'Cannot move while clinging';
    end if;
  end if;

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
  v_elevations := coalesce(
    (
      select jsonb_agg(e.value)
      from jsonb_array_elements(v_elevations) as e(value)
      where coalesce(e.value->>'character_id', '') <> p_character_id::text
    ),
    '[]'::jsonb
  );
  v_elevations := v_elevations || jsonb_build_array(
    jsonb_build_object(
      'character_id', p_character_id::text,
      'elevation', 0
    )
  );

  foreach v_attached_token_id in array v_attached_token_ids loop
    v_tokens := coalesce(
      (
        select jsonb_agg(t.value)
        from jsonb_array_elements(v_tokens) as t(value)
        where coalesce(t.value->>'character_id', '') <> v_attached_token_id
      ),
      '[]'::jsonb
    );

    v_tokens := v_tokens || jsonb_build_array(
      jsonb_build_object(
        'character_id', v_attached_token_id,
        'x', p_x,
        'y', p_y
      )
    );
    v_elevations := coalesce(
      (
        select jsonb_agg(e.value)
        from jsonb_array_elements(v_elevations) as e(value)
        where coalesce(e.value->>'character_id', '') <> v_attached_token_id
      ),
      '[]'::jsonb
    );
    v_elevations := v_elevations || jsonb_build_array(
      jsonb_build_object(
        'character_id', v_attached_token_id,
        'elevation', 0
      )
    );
  end loop;

  update public.combat_state
  set token_positions = v_tokens,
      token_elevations = v_elevations,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_upsert_player_token(uuid, double precision, double precision) to authenticated;

create or replace function public.combat_apply_round_transition(p_entries jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
begin
  -- Apply pending feints as true initiative, clear feints, and refresh action availability.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entry', jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                e.entry,
                '{roll}',
                case
                  when nullif(coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll', ''), '') is null
                    or lower(coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll', '')) = 'null'
                  then 'null'::jsonb
                  else to_jsonb((coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll'))::double precision)
                end,
                true
              ),
              '{feint_pending_roll}',
              'null'::jsonb,
              true
            ),
            '{feint_pending_name}',
            'null'::jsonb,
            true
          ),
          '{fast_available}',
          'true'::jsonb,
          true
        ),
        'ord', e.ord
      )
      order by coalesce(
        case
          when nullif(coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll', ''), '') is null
            or lower(coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll', '')) = 'null'
          then null
          else (coalesce(e.entry->>'feint_pending_roll', e.entry->>'roll'))::double precision
        end,
        -1
      ) desc, e.ord
    ),
    '[]'::jsonb
  )
  into v_entries
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord);

  select coalesce(
    jsonb_agg(
      jsonb_set(
        jsonb_set((r.value->'entry'), '{slow_available}', 'true'::jsonb, true),
        '{fast_footwork_dodge_used}',
        'false'::jsonb,
        true
      )
      order by r.ord
    ),
    '[]'::jsonb
  )
  into v_entries
  from jsonb_array_elements(v_entries) with ordinality as r(value, ord);

  return v_entries;
end;
$$;

create or replace function public.combat_apply_falling(
  p_turn_start_token_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode boolean;
  v_entries jsonb;
  v_monsters jsonb;
  v_elevations jsonb;
  v_email text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
  v_turn_token_id text := nullif(btrim(coalesce(p_turn_start_token_id, '')), '');
  v_entry record;
  v_token_id text;
  v_kind text;
  v_prone boolean;
  v_can_fly boolean;
  v_elevation int := 0;
  v_base_fall boolean := false;
  v_base_map jsonb := '{}'::jsonb;
  v_should_map jsonb := '{}'::jsonb;
  v_known_tokens text[] := array[]::text[];
  v_iter int;
  v_changed_iter boolean;
  v_clinging_target_id text;
  v_grappled_by_id text;
  v_current_should boolean;
  v_next_should boolean;
  v_existing_fall int := 0;
  v_new_fall int := 0;
  v_new_elevation int := 0;
  v_should_step boolean;
  v_is_turn_step boolean;
  v_fall_dice int := 0;
  v_fall_successes int := 0;
  v_target_uuid uuid;
  v_attrs jsonb;
  v_str_before int := 0;
  v_str_after int := 0;
  v_snapshot jsonb;
  v_changed boolean := false;
begin
  if v_turn_token_id is not null and left(v_turn_token_id, 7) = 'player:' then
    v_turn_token_id := substr(v_turn_token_id, 8);
  end if;

  select combat_mode,
         coalesce(initiative_entries, '[]'::jsonb),
         coalesce(initiative_monsters, '[]'::jsonb),
         coalesce(token_elevations, '[]'::jsonb)
  into v_mode, v_entries, v_monsters, v_elevations
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    return;
  end if;
  if jsonb_array_length(v_entries) = 0 then
    return;
  end if;

  -- Build initial falling state from local properties only.
  for v_entry in
    select e.ord - 1 as idx, e.entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  loop
    v_token_id := coalesce(v_entry.entry->>'participant_id', '');
    if left(v_token_id, 7) = 'player:' then
      v_token_id := substr(v_token_id, 8);
    end if;
    if v_token_id = '' then
      continue;
    end if;
    if not (v_token_id = any(v_known_tokens)) then
      v_known_tokens := array_append(v_known_tokens, v_token_id);
    end if;

    begin
      select coalesce((el.value->>'elevation')::int, 0)
      into v_elevation
      from jsonb_array_elements(v_elevations) as el(value)
      where el.value->>'character_id' = v_token_id
      limit 1;
    exception when others then
      v_elevation := 0;
    end;
    v_elevation := greatest(0, coalesce(v_elevation, 0));

    v_kind := coalesce(v_entry.entry->>'kind', '');
    begin
      v_prone := coalesce((v_entry.entry->>'prone')::boolean, false);
    exception when others then
      v_prone := false;
    end;

    v_can_fly := false;
    if v_kind = 'monster' then
      select exists (
        select 1
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(v_entry.entry->'monster_snapshot'->'traits') = 'array'
            then coalesce(v_entry.entry->'monster_snapshot'->'traits', '[]'::jsonb)
            else '[]'::jsonb
          end
        ) as tr(value)
        where lower(btrim(tr.value)) = 'flight'
      )
      into v_can_fly;
    end if;

    v_base_fall := v_elevation > 0 and ((not v_can_fly) or v_prone);
    v_base_map := jsonb_set(v_base_map, array[v_token_id], to_jsonb(v_base_fall), true);
    v_should_map := jsonb_set(v_should_map, array[v_token_id], to_jsonb(v_base_fall), true);
  end loop;

  -- Resolve relationship dependencies (cling and grapple suppression) to a fixed point.
  for v_iter in 1..24 loop
    v_changed_iter := false;
    for v_entry in
      select e.ord - 1 as idx, e.entry
      from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    loop
      v_token_id := coalesce(v_entry.entry->>'participant_id', '');
      if left(v_token_id, 7) = 'player:' then
        v_token_id := substr(v_token_id, 8);
      end if;
      if v_token_id = '' then
        continue;
      end if;

      begin
        select coalesce((el.value->>'elevation')::int, 0)
        into v_elevation
        from jsonb_array_elements(v_elevations) as el(value)
        where el.value->>'character_id' = v_token_id
        limit 1;
      exception when others then
        v_elevation := 0;
      end;
      v_elevation := greatest(0, coalesce(v_elevation, 0));

      v_current_should := coalesce((v_should_map->>v_token_id)::boolean, false);
      if v_elevation <= 0 then
        v_next_should := false;
      else
        v_next_should := coalesce((v_base_map->>v_token_id)::boolean, false);
        v_clinging_target_id := nullif(coalesce(v_entry.entry->>'clinging_target_id', ''), '');
        v_grappled_by_id := nullif(coalesce(v_entry.entry->>'grappled_by_id', ''), '');

        if v_clinging_target_id is not null and v_clinging_target_id = any(v_known_tokens) then
          v_next_should := coalesce((v_should_map->>v_clinging_target_id)::boolean, v_next_should);
        elsif v_next_should and v_grappled_by_id is not null and v_grappled_by_id = any(v_known_tokens) then
          if coalesce((v_should_map->>v_grappled_by_id)::boolean, true) = false then
            v_next_should := false;
          end if;
        end if;
      end if;

      if v_next_should is distinct from v_current_should then
        v_should_map := jsonb_set(v_should_map, array[v_token_id], to_jsonb(v_next_should), true);
        v_changed_iter := true;
      end if;
    end loop;
    exit when not v_changed_iter;
  end loop;

  -- Apply state transitions: clear/advance falling, move by one elevation, and resolve impact.
  for v_entry in
    select e.ord - 1 as idx, e.entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  loop
    v_token_id := coalesce(v_entry.entry->>'participant_id', '');
    if left(v_token_id, 7) = 'player:' then
      v_token_id := substr(v_token_id, 8);
    end if;
    if v_token_id = '' then
      continue;
    end if;

    begin
      select coalesce((el.value->>'elevation')::int, 0)
      into v_elevation
      from jsonb_array_elements(v_elevations) as el(value)
      where el.value->>'character_id' = v_token_id
      limit 1;
    exception when others then
      v_elevation := 0;
    end;
    v_elevation := greatest(0, coalesce(v_elevation, 0));

    begin
      v_existing_fall := greatest(0, coalesce((v_entry.entry->>'falling_zones')::int, 0));
    exception when others then
      v_existing_fall := 0;
    end;

    v_next_should := coalesce((v_should_map->>v_token_id)::boolean, false);
    if v_elevation <= 0 or not v_next_should then
      if v_existing_fall > 0 or (v_entry.entry ? 'falling_zones') then
        v_entry.entry := jsonb_set(v_entry.entry, '{falling_zones}', 'null'::jsonb, true);
        v_entries := jsonb_set(v_entries, array[v_entry.idx::text], v_entry.entry, false);
        v_changed := true;
      end if;
      continue;
    end if;

    v_is_turn_step := v_turn_token_id is not null and v_turn_token_id = v_token_id;
    v_should_step := (v_existing_fall = 0) or v_is_turn_step;
    if not v_should_step then
      continue;
    end if;

    v_new_fall := greatest(1, v_existing_fall + 1);
    v_new_elevation := greatest(0, v_elevation - 1);
    if v_new_elevation <> v_elevation then
      v_elevations := coalesce(
        (
          select jsonb_agg(el.value)
          from jsonb_array_elements(v_elevations) as el(value)
          where coalesce(el.value->>'character_id', '') <> v_token_id
        ),
        '[]'::jsonb
      );
      v_elevations := v_elevations || jsonb_build_array(
        jsonb_build_object(
          'character_id', v_token_id,
          'elevation', v_new_elevation
        )
      );
      v_changed := true;
    end if;

    if v_new_elevation = 0 then
      v_fall_dice := v_new_fall * 8;
      v_fall_successes := 0;
      if v_fall_dice > 0 then
        select coalesce(count(*), 0)::int
        into v_fall_successes
        from generate_series(1, v_fall_dice) as g(i)
        where (floor(random() * 6)::int + 1) = 6;
      end if;

      if v_fall_successes > 0 then
        v_kind := coalesce(v_entry.entry->>'kind', '');
        if v_kind = 'monster' then
          v_snapshot := coalesce(v_entry.entry->'monster_snapshot', '{}'::jsonb);
          begin
            v_str_before := coalesce((v_snapshot->>'str')::int, 0);
          exception when others then
            v_str_before := 0;
          end;
          v_str_after := greatest(0, v_str_before - v_fall_successes);
          v_snapshot := jsonb_set(v_snapshot, '{str}', to_jsonb(v_str_after), true);
          v_entry.entry := jsonb_set(v_entry.entry, '{monster_snapshot}', v_snapshot, true);
          v_entries := jsonb_set(v_entries, array[v_entry.idx::text], v_entry.entry, false);

          v_monsters := coalesce(v_monsters, '[]'::jsonb);
          select coalesce(
            jsonb_agg(
              case
                when mon.value->>'id' = v_token_id
                then jsonb_set(mon.value, '{monster_snapshot}', v_snapshot, true)
                else mon.value
              end
            ),
            '[]'::jsonb
          )
          into v_monsters
          from jsonb_array_elements(v_monsters) as mon(value);
          v_changed := true;
        else
          begin
            v_target_uuid := v_token_id::uuid;
            select coalesce(to_jsonb(attributes), '{}'::jsonb)
            into v_attrs
            from public.characters
            where id = v_target_uuid
            limit 1;

            if v_attrs is not null then
              begin
                v_str_before := coalesce((v_attrs->>'STR')::int, 0);
              exception when others then
                v_str_before := 0;
              end;
              v_str_after := greatest(0, v_str_before - v_fall_successes);
              v_attrs := jsonb_set(v_attrs, '{STR}', to_jsonb(v_str_after), true);
              update public.characters
              set attributes = v_attrs
              where id = v_target_uuid;
            end if;
          exception when others then
            null;
          end;
        end if;
      end if;

      v_entry.entry := jsonb_set(v_entry.entry, '{falling_zones}', 'null'::jsonb, true);
    else
      v_entry.entry := jsonb_set(v_entry.entry, '{falling_zones}', to_jsonb(v_new_fall), true);
    end if;

    v_entries := jsonb_set(v_entries, array[v_entry.idx::text], v_entry.entry, false);
    v_changed := true;
  end loop;

  if not v_changed then
    return;
  end if;

  update public.combat_state
  set initiative_entries = v_entries,
      initiative_monsters = v_monsters,
      token_elevations = v_elevations,
      updated_by_email = coalesce(v_email, updated_by_email)
  where id = 1;

  perform public.combat_prune_fully_broken_engagements();
end;
$$;

grant execute on function public.combat_apply_falling(text) to authenticated;

create or replace function public.combat_auto_pass_blitzed_turns()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode boolean;
  v_entries jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_is_blitzed boolean := false;
  v_next_idx int;
  v_next_entry jsonb;
  v_next_token_id text;
  v_reset_entries jsonb;
  v_guard int := 0;
begin
  loop
    select combat_mode, coalesce(initiative_entries, '[]'::jsonb), initiative_current_index
    into v_mode, v_entries, v_idx
    from public.combat_state
    where id = 1
    for update;

    if coalesce(v_mode, false) = false then
      return;
    end if;

    v_count := jsonb_array_length(v_entries);
    if v_count = 0 then
      return;
    end if;

    if v_idx is null or v_idx < 0 or v_idx >= v_count then
      v_idx := 0;
    end if;

    v_current := v_entries -> v_idx;
    begin
      v_is_blitzed := coalesce((v_current->>'blitzed')::boolean, false);
    exception when others then
      v_is_blitzed := false;
    end;
    if not v_is_blitzed then
      return;
    end if;

    -- Auto-pass this turn and clear Blitzed with no action consumption.
    v_current := jsonb_set(v_current, '{blitzed}', 'false'::jsonb, true);
    v_current := jsonb_set(v_current, '{taunted_anger_by_id}', 'null'::jsonb, true);
    v_current := jsonb_set(v_current, '{taunted_anger_by_name}', 'null'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);

    v_next_idx := case when v_idx + 1 >= v_count then 0 else v_idx + 1 end;
    v_next_entry := v_entries -> v_next_idx;
    v_next_token_id := nullif(coalesce(v_next_entry->>'participant_id', ''), '');
    v_next_entry := jsonb_set(v_next_entry, '{used_item_flags}', '[]'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_next_idx::text], v_next_entry, false);

    if v_next_idx = 0 and v_count > 0 then
      v_reset_entries := public.combat_apply_round_transition(v_entries);
      v_entries := v_reset_entries;
    end if;

    update public.combat_state
    set initiative_current_index = v_next_idx,
        initiative_entries = v_entries
    where id = 1;

    perform public.combat_apply_falling(v_next_token_id);

    v_guard := v_guard + 1;
    if v_guard >= 256 then
      return;
    end if;
  end loop;
end;
$$;

grant execute on function public.combat_auto_pass_blitzed_turns() to authenticated;

create or replace function public.combat_apply_falling_after_state_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.combat_mode, false) = true then
    perform public.combat_apply_falling(null);
    perform public.combat_auto_pass_blitzed_turns();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_combat_apply_falling_after_state_update on public.combat_state;
create trigger trg_combat_apply_falling_after_state_update
after update of initiative_entries, initiative_monsters, token_elevations, initiative_current_index, combat_mode on public.combat_state
for each row execute function public.combat_apply_falling_after_state_update();

create or replace function public.combat_prune_fully_broken_engagements()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entries jsonb;
  v_edges jsonb;
  v_new_edges jsonb;
  v_token_ids text[] := array[]::text[];
  v_token_broken boolean[] := array[]::boolean[];
  v_entry record;
  v_edge record;
  v_scan record;
  v_token text;
  v_participant_id text;
  v_token_id text;
  v_kind text;
  v_is_monster boolean;
  v_character_found boolean;
  v_dead boolean;
  v_broken boolean;
  v_component text[];
  v_changed boolean;
  v_all_broken boolean;
  v_remove_tokens text[] := array[]::text[];
  v_idx int;
  v_attr jsonb;
begin
  select coalesce(initiative_entries, '[]'::jsonb), coalesce(engagements, '[]'::jsonb)
  into v_entries, v_edges
  from public.combat_state
  where id = 1
  for update;

  if jsonb_array_length(v_edges) = 0 then
    return;
  end if;

  for v_entry in
    select e.value as entry
    from jsonb_array_elements(v_entries) as e(value)
  loop
    v_participant_id := coalesce(v_entry.entry->>'participant_id', '');
    v_kind := coalesce(v_entry.entry->>'kind', '');
    if v_participant_id = '' then
      continue;
    end if;
    if left(v_participant_id, 7) = 'player:' then
      v_token_id := substr(v_participant_id, 8);
    else
      v_token_id := v_participant_id;
    end if;
    if v_token_id = '' then
      continue;
    end if;

    v_dead := coalesce((v_entry.entry->>'dead')::boolean, false);
    v_broken := false;
    v_is_monster := left(v_token_id, 8) = 'monster:'
      or v_kind = 'monster'
      or jsonb_typeof(v_entry.entry->'monster_snapshot') = 'object';
    v_character_found := false;

    -- Prefer reading player state from characters when token id is a UUID.
    if not v_is_monster then
      begin
        select coalesce(to_jsonb(attributes), '{}'::jsonb), coalesce(dead, false)
        into v_attr, v_dead
        from public.characters
        where id = v_token_id::uuid
        limit 1;
        v_character_found := found;
      exception when others then
        v_character_found := false;
      end;
    end if;

    if v_character_found then
      v_broken :=
        coalesce((v_attr->>'STR')::int, 1) <= 0
        or coalesce((v_attr->>'AGL')::int, 1) <= 0
        or coalesce((v_attr->>'WIT')::int, 1) <= 0
        or coalesce((v_attr->>'EMP')::int, 1) <= 0;
    elsif v_is_monster then
      v_dead := v_dead or coalesce((v_entry.entry->'monster_snapshot'->>'dead')::boolean, false);
      v_broken :=
        coalesce((v_entry.entry->'monster_snapshot'->>'str')::int, 1) <= 0
        or coalesce((v_entry.entry->'monster_snapshot'->>'agl')::int, 1) <= 0
        or coalesce((v_entry.entry->'monster_snapshot'->>'wit')::int, 1) <= 0
        or coalesce((v_entry.entry->'monster_snapshot'->>'emp')::int, 1) <= 0;
    end if;

    v_idx := array_position(v_token_ids, v_token_id);
    if v_idx is null then
      v_token_ids := array_append(v_token_ids, v_token_id);
      v_token_broken := array_append(v_token_broken, (v_dead or v_broken));
    else
      v_token_broken[v_idx] := v_token_broken[v_idx] or (v_dead or v_broken);
    end if;
  end loop;

  for v_edge in
    select e.value as edge
    from jsonb_array_elements(v_edges) as e(value)
  loop
    if v_edge.edge->>'a' is null or v_edge.edge->>'b' is null then
      continue;
    end if;
    if (v_edge.edge->>'a') = any(v_remove_tokens) or (v_edge.edge->>'b') = any(v_remove_tokens) then
      continue;
    end if;

    v_component := array[v_edge.edge->>'a', v_edge.edge->>'b'];
    loop
      v_changed := false;
      for v_scan in
        select e.value as edge
        from jsonb_array_elements(v_edges) as e(value)
      loop
        if v_scan.edge->>'a' is null or v_scan.edge->>'b' is null then
          continue;
        end if;
        if (v_scan.edge->>'a') = any(v_component) and not ((v_scan.edge->>'b') = any(v_component)) then
          v_component := array_append(v_component, v_scan.edge->>'b');
          v_changed := true;
        elsif (v_scan.edge->>'b') = any(v_component) and not ((v_scan.edge->>'a') = any(v_component)) then
          v_component := array_append(v_component, v_scan.edge->>'a');
          v_changed := true;
        end if;
      end loop;
      exit when not v_changed;
    end loop;

    v_all_broken := true;
    foreach v_token in array v_component loop
      v_idx := array_position(v_token_ids, v_token);
      if v_idx is null or not coalesce(v_token_broken[v_idx], false) then
        v_all_broken := false;
        exit;
      end if;
    end loop;

    if v_all_broken then
      foreach v_token in array v_component loop
        if not (v_token = any(v_remove_tokens)) then
          v_remove_tokens := array_append(v_remove_tokens, v_token);
        end if;
      end loop;
    end if;
  end loop;

  if array_length(v_remove_tokens, 1) is null then
    return;
  end if;

  select coalesce(
    jsonb_agg(e.value),
    '[]'::jsonb
  )
  into v_new_edges
  from jsonb_array_elements(v_edges) as e(value)
  where coalesce(e.value->>'a', '') <> ''
    and coalesce(e.value->>'b', '') <> ''
    and not ((e.value->>'a') = any(v_remove_tokens))
    and not ((e.value->>'b') = any(v_remove_tokens));

  update public.combat_state
  set engagements = v_new_edges
  where id = 1;
end;
$$;

grant execute on function public.combat_prune_fully_broken_engagements() to authenticated;

create or replace function public.combat_prune_after_character_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if exists (
    select 1
    from public.combat_state
    where id = 1
      and coalesce(combat_mode, false) = true
  ) then
    perform public.combat_prune_fully_broken_engagements();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_combat_prune_after_character_update on public.characters;
create trigger trg_combat_prune_after_character_update
after update of attributes, dead on public.characters
for each row execute function public.combat_prune_after_character_update();

create or replace function public.combat_prune_after_state_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if coalesce(new.combat_mode, false) = true then
    perform public.combat_prune_fully_broken_engagements();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_combat_prune_after_state_update on public.combat_state;
create trigger trg_combat_prune_after_state_update
after update of initiative_entries, initiative_monsters, engagements, combat_mode on public.combat_state
for each row execute function public.combat_prune_after_state_update();

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
  v_next_entry jsonb;
  v_next_token_id text;
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

  v_current := jsonb_set(v_current, '{taunted_anger_by_id}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, '{taunted_anger_by_name}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);

  v_next_idx := case when v_idx + 1 >= v_count then 0 else v_idx + 1 end;
  v_next_entry := v_entries -> v_next_idx;
  v_next_token_id := nullif(coalesce(v_next_entry->>'participant_id', ''), '');
  v_next_entry := jsonb_set(v_next_entry, '{used_item_flags}', '[]'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_next_idx::text], v_next_entry, false);

  if v_next_idx = 0 and v_count > 0 then
    v_reset_entries := public.combat_apply_round_transition(v_entries);

    update public.combat_state
    set initiative_current_index = v_next_idx,
        initiative_entries = v_reset_entries,
        updated_by_email = v_email
    where id = 1;
  else
    update public.combat_state
    set initiative_current_index = v_next_idx,
        initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;

  perform public.combat_apply_falling(v_next_token_id);
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
  v_pending_reactions jsonb;
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
  v_next_entry jsonb;
  v_next_token_id text;
  v_has_reaction_stack boolean := false;
  v_entry jsonb;
  v_flags jsonb;
  v_flag text;
  v_has_incoming boolean;
  v_has_meta boolean;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_action not in ('fast', 'slow') then
    raise exception 'Invalid action type';
  end if;

  select initiative_entries, initiative_current_index, coalesce(pending_reactions, '[]'::jsonb)
  into v_entries, v_idx, v_pending_reactions
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

  v_current := jsonb_set(v_current, '{taunted_anger_by_id}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, '{taunted_anger_by_name}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, array[v_key], 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);
  v_after_fast := coalesce((v_current ->> 'fast_available')::boolean, true);
  v_after_slow := coalesce((v_current ->> 'slow_available')::boolean, true);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
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
  v_pending_reactions jsonb;
  v_idx int;
  v_count int;
  v_current jsonb;
  v_current_email text;
  v_fast boolean;
  v_slow boolean;
  v_key text;
  v_next_idx int;
  v_reset_entries jsonb;
  v_next_entry jsonb;
  v_next_token_id text;
  v_has_reaction_stack boolean := false;
  v_entry jsonb;
  v_flags jsonb;
  v_flag text;
  v_has_incoming boolean;
  v_has_meta boolean;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  select initiative_entries, initiative_current_index, coalesce(pending_reactions, '[]'::jsonb)
  into v_entries, v_idx, v_pending_reactions
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

  v_current := jsonb_set(v_current, '{taunted_anger_by_id}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, '{taunted_anger_by_name}', 'null'::jsonb, true);
  v_current := jsonb_set(v_current, array[v_key], 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_current, false);
  v_fast := coalesce((v_current ->> 'fast_available')::boolean, true);
  v_slow := coalesce((v_current ->> 'slow_available')::boolean, true);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;

  return case when v_key = 'fast_available' then 'fast' else 'slow' end;
end;
$$;

grant execute on function public.combat_use_fast_or_slow() to authenticated;

create or replace function public.combat_clear_taunt_anger(
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
    return;
  end if;

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    return;
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');

  if not v_is_dm then
    if v_entry_kind <> 'player' then
      raise exception 'Only player characters can update taunt state';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can update taunt state';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{taunted_anger_by_id}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{taunted_anger_by_name}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_clear_taunt_anger(text) to authenticated;

create or replace function public.combat_consume_taunt_distract(
  p_actor_token_id text
)
returns int
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
  v_penalty int := 0;
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
    return 0;
  end if;

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    return 0;
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');

  if not v_is_dm then
    if v_entry_kind <> 'player' then
      raise exception 'Only player characters can update taunt state';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can update taunt state';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
  end if;

  begin
    v_penalty := greatest(0, coalesce((v_entry->>'taunted_distract_value')::int, 0));
  exception when others then
    v_penalty := 0;
  end;

  if v_penalty <= 0 then
    return 0;
  end if;

  v_entry := jsonb_set(v_entry, '{taunted_distract_value}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;

  return v_penalty;
end;
$$;

grant execute on function public.combat_consume_taunt_distract(text) to authenticated;

create or replace function public.combat_set_used_item_flag(
  p_actor_token_id text,
  p_flag text,
  p_enabled boolean
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
  v_flags jsonb;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;
  if p_flag is null or btrim(p_flag) = '' then
    raise exception 'Flag is required';
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
    return;
  end if;

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    return;
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');

  if not v_is_dm then
    if v_entry_kind <> 'player' then
      raise exception 'Only player characters can update item flags';
    end if;
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can update item flags';
    end;
    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;
    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
  end if;

  if jsonb_typeof(v_entry->'used_item_flags') = 'array' then
    v_flags := v_entry->'used_item_flags';
  else
    v_flags := '[]'::jsonb;
  end if;

  if coalesce(p_enabled, false) then
    if not exists (
      select 1
      from jsonb_array_elements_text(v_flags) as x(value)
      where x.value = p_flag
    ) then
      v_flags := v_flags || jsonb_build_array(p_flag);
    end if;
  else
    select coalesce(jsonb_agg(to_jsonb(x.value)), '[]'::jsonb)
    into v_flags
    from jsonb_array_elements_text(v_flags) as x(value)
    where x.value <> p_flag;
  end if;

  v_entry := jsonb_set(v_entry, '{used_item_flags}', v_flags, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_set_used_item_flag(text, text, boolean) to authenticated;

create or replace function public.combat_enqueue_reaction(
  p_reaction jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_reactions jsonb;
  v_id text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_reaction is null or jsonb_typeof(p_reaction) <> 'object' then
    raise exception 'Reaction payload is required';
  end if;

  v_id := nullif(coalesce(p_reaction->>'id', ''), '');
  if v_id is null then
    raise exception 'Reaction id is required';
  end if;

  select coalesce(pending_reactions, '[]'::jsonb)
  into v_reactions
  from public.combat_state
  where id = 1
  for update;

  if jsonb_typeof(v_reactions) <> 'array' then
    v_reactions := '[]'::jsonb;
  end if;

  if exists (select 1 from jsonb_array_elements(v_reactions) as r where r->>'id' = v_id) then
    return;
  end if;

  v_reactions := v_reactions || jsonb_build_array(p_reaction);

  update public.combat_state
  set pending_reactions = v_reactions,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_enqueue_reaction(jsonb) to authenticated;

create or replace function public.combat_clear_reaction(
  p_reaction_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_reactions jsonb;
  v_entries jsonb;
  v_entry jsonb;
  v_next_entry jsonb;
  v_flags jsonb;
  v_cleaned_flags jsonb;
  v_idx int;
  v_has_incoming_stack boolean := false;
  v_changed boolean := false;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_reaction_id is null or btrim(p_reaction_id) = '' then
    raise exception 'Reaction id is required';
  end if;

  select coalesce(pending_reactions, '[]'::jsonb),
         coalesce(initiative_entries, '[]'::jsonb)
  into v_reactions, v_entries
  from public.combat_state
  where id = 1
  for update;

  if jsonb_typeof(v_reactions) <> 'array' then
    v_reactions := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_entries) <> 'array' then
    v_entries := '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(r), '[]'::jsonb)
  into v_reactions
  from jsonb_array_elements(v_reactions) as r
  where r->>'id' <> p_reaction_id;

  if jsonb_array_length(v_reactions) = 0 then
    for v_entry in
      select e.value
      from jsonb_array_elements(v_entries) as e(value)
    loop
      if jsonb_typeof(v_entry->'used_item_flags') <> 'array' then
        continue;
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(v_entry->'used_item_flags') as f(value)
        where f.value like 'Incoming (%'
           or f.value like 'Incoming Damage (%'
      )
      and exists (
        select 1
        from jsonb_array_elements_text(v_entry->'used_item_flags') as f(value)
        where f.value like '__Incoming Meta (%'
      ) then
        v_has_incoming_stack := true;
        exit;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_reactions) = 0 and not v_has_incoming_stack then
    for v_idx, v_entry in
      select e.ord - 1, e.entry
      from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    loop
      if jsonb_typeof(v_entry->'used_item_flags') = 'array' then
        v_flags := v_entry->'used_item_flags';
      else
        v_flags := '[]'::jsonb;
      end if;

      select coalesce(jsonb_agg(to_jsonb(f.value)), '[]'::jsonb)
      into v_cleaned_flags
      from jsonb_array_elements_text(v_flags) as f(value)
      where f.value <> 'Dodged'
        and f.value <> 'Parried'
        and f.value <> 'Arts Chosen'
        and f.value not like 'Incoming (%'
        and f.value not like 'Incoming Damage (%'
        and f.value not like '__Incoming Meta (%'
        and not (f.value like 'Used (%' and f.value <> 'Used (Flaming Longsword)');

      if v_cleaned_flags <> v_flags then
        v_changed := true;
      end if;

      v_next_entry := jsonb_set(v_entry, '{used_item_flags}', v_cleaned_flags, true);
      v_entries := jsonb_set(v_entries, array[v_idx::text], v_next_entry, false);
    end loop;
  end if;

  if v_changed then
    update public.combat_state
    set pending_reactions = v_reactions,
        initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  else
    update public.combat_state
    set pending_reactions = v_reactions,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_clear_reaction(text) to authenticated;

create or replace function public.combat_use_reaction_action(
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
  v_fast boolean;
  v_slow boolean;
  v_key text;
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
      raise exception 'Only player characters can react';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can react';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only react for your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only react for your own character';
    end if;
  end if;

  v_fast := coalesce((v_entry ->> 'fast_available')::boolean, true);
  v_slow := coalesce((v_entry ->> 'slow_available')::boolean, true);
  if v_fast then
    v_key := 'fast_available';
  elsif v_slow then
    v_key := 'slow_available';
  else
    raise exception 'No fast or slow action available';
  end if;

  v_entry := jsonb_set(v_entry, array[v_key], 'false'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_use_reaction_action(text) to authenticated;

create or replace function public.combat_update_flow_state(
  p_initiative_entries jsonb,
  p_initiative_current_index int,
  p_actor_token_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_existing_entries jsonb;
  v_actor_entry jsonb;
  v_actor_idx int;
  v_actor_kind text;
  v_actor_uuid uuid;
  v_actor_owner_email text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_initiative_entries is null or jsonb_typeof(p_initiative_entries) <> 'array' then
    raise exception 'initiative entries payload is required';
  end if;

  select coalesce(initiative_entries, '[]'::jsonb)
  into v_existing_entries
  from public.combat_state
  where id = 1
  for update;

  if not v_is_dm then
    if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
      raise exception 'Actor token is required';
    end if;

    select e.ord - 1, e.entry
    into v_actor_idx, v_actor_entry
    from jsonb_array_elements(v_existing_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = p_actor_token_id
       or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
    order by e.ord
    limit 1;

    if v_actor_idx is null then
      raise exception 'Actor participant not found';
    end if;

    v_actor_kind := coalesce(v_actor_entry->>'kind', '');
    if v_actor_kind <> 'player' then
      raise exception 'Only player characters can update flow state';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can update flow state';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only update flow state for your own character';
    end if;
  end if;

  update public.combat_state
  set initiative_entries = p_initiative_entries,
      initiative_current_index = case
        when p_initiative_current_index is null then initiative_current_index
        else p_initiative_current_index
      end,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_update_flow_state(jsonb, int, text) to authenticated;

create or replace function public.combat_consume_fast_footwork_dodge(
  p_actor_token_id text
)
returns boolean
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
  v_used boolean := false;
  v_has_talent boolean := false;
  v_talent_levels jsonb;
  v_talents jsonb;
  v_level int := 0;
  v_talent jsonb;
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
    return false;
  end if;

  select e.ord - 1, e.entry
  into v_entry_idx, v_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_entry_idx is null then
    return false;
  end if;

  v_entry_kind := coalesce(v_entry->>'kind', '');
  v_entry_email := nullif(coalesce(v_entry->>'user_email', ''), '');
  if v_entry_kind <> 'player' then
    return false;
  end if;

  begin
    v_actor_uuid := p_actor_token_id::uuid;
  exception when others then
    return false;
  end;

  if not v_is_dm then
    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only react for your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only react for your own character';
    end if;
  end if;

  begin
    v_used := coalesce((v_entry->>'fast_footwork_dodge_used')::boolean, false);
  exception when others then
    v_used := false;
  end;
  if v_used then
    return false;
  end if;

  select coalesce(talent_levels, '{}'::jsonb), coalesce(talents, '[]'::jsonb)
  into v_talent_levels, v_talents
  from public.characters
  where id = v_actor_uuid
  limit 1;

  if jsonb_typeof(v_talent_levels) = 'object' then
    begin
      v_level := coalesce((v_talent_levels->>'talent-fast-footwork')::int, 0);
    exception when others then
      v_level := 0;
    end;
    if v_level >= 1 then
      v_has_talent := true;
    end if;
  end if;

  if not v_has_talent and jsonb_typeof(v_talents) = 'array' then
    for v_talent in
      select value
      from jsonb_array_elements(v_talents) as t(value)
    loop
      if coalesce(v_talent->>'id', '') <> 'talent-fast-footwork' then
        continue;
      end if;
      begin
        v_level := coalesce((v_talent->>'level')::int, 0);
      exception when others then
        v_level := 0;
      end;
      if v_level >= 1 then
        v_has_talent := true;
        exit;
      end if;
    end loop;
  end if;

  if not v_has_talent then
    return false;
  end if;

  v_entry := jsonb_set(v_entry, '{fast_footwork_dodge_used}', 'true'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;

  return true;
end;
$$;

grant execute on function public.combat_consume_fast_footwork_dodge(text) to authenticated;

create or replace function public.combat_set_prone_for_token(
  p_actor_token_id text,
  p_prone boolean
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
      raise exception 'Only player characters can update prone';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can update prone';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only update your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{prone}', to_jsonb(coalesce(p_prone, false)), true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_set_prone_for_token(text, boolean) to authenticated;

create or replace function public.combat_apply_feint(
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
  v_mode_on boolean;
  v_edges jsonb;
  v_actor_idx int;
  v_target_idx int;
  v_actor_entry jsonb;
  v_target_entry jsonb;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_effective_roll_num double precision;
  v_target_effective_roll_num double precision;
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
    raise exception 'Cannot feint yourself';
  end if;

  select combat_mode, coalesce(initiative_entries, '[]'::jsonb), coalesce(engagements, '[]'::jsonb)
  into v_mode_on, v_entries, v_edges
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode_on, false) = false then
    raise exception 'Combat mode is not active';
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

  if v_actor_idx is null or v_target_idx is null then
    raise exception 'Participants not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can feint';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only feint with your own character';
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

  v_actor_effective_roll_num :=
    case
      when nullif(coalesce(v_actor_entry->>'feint_pending_roll', v_actor_entry->>'roll', ''), '') is null
        or lower(coalesce(v_actor_entry->>'feint_pending_roll', v_actor_entry->>'roll', '')) = 'null'
      then null
      else (coalesce(v_actor_entry->>'feint_pending_roll', v_actor_entry->>'roll'))::double precision
    end;
  v_target_effective_roll_num :=
    case
      when nullif(coalesce(v_target_entry->>'feint_pending_roll', v_target_entry->>'roll', ''), '') is null
        or lower(coalesce(v_target_entry->>'feint_pending_roll', v_target_entry->>'roll', '')) = 'null'
      then null
      else (coalesce(v_target_entry->>'feint_pending_roll', v_target_entry->>'roll'))::double precision
    end;

  v_actor_entry := jsonb_set(v_actor_entry, '{feint_pending_roll}', to_jsonb(v_target_effective_roll_num), true);
  v_actor_entry := jsonb_set(v_actor_entry, '{feint_pending_name}', to_jsonb(coalesce(v_target_entry->>'name', 'Target')), true);
  v_target_entry := jsonb_set(v_target_entry, '{feint_pending_roll}', to_jsonb(v_actor_effective_roll_num), true);
  v_target_entry := jsonb_set(v_target_entry, '{feint_pending_name}', to_jsonb(coalesce(v_actor_entry->>'name', 'Actor')), true);

  v_entries := jsonb_set(v_entries, array[v_actor_idx::text], v_actor_entry, false);
  v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_apply_feint(text, text) to authenticated;

create or replace function public.combat_token_side(
  p_entries jsonb,
  p_token_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id text := nullif(btrim(coalesce(p_token_id, '')), '');
  v_entry jsonb;
  v_kind text;
begin
  if v_token_id is null then
    return 'player';
  end if;
  if left(v_token_id, 7) = 'player:' then
    v_token_id := substr(v_token_id, 8);
  end if;

  select e.entry
  into v_entry
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = v_token_id
     or e.entry->>'participant_id' = ('player:' || v_token_id)
  order by e.ord
  limit 1;

  if v_entry is null then
    if left(v_token_id, 8) = 'monster:' then
      return 'monster';
    end if;
    return 'player';
  end if;

  v_kind := coalesce(v_entry->>'kind', '');
  if v_kind = 'monster' then
    if exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(v_entry->'monster_snapshot'->'traits') = 'array'
          then coalesce(v_entry->'monster_snapshot'->'traits', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) as tr(value)
      where lower(btrim(tr.value)) = 'ally'
    ) then
      return 'player';
    end if;
    return 'monster';
  end if;

  return 'player';
end;
$$;

grant execute on function public.combat_token_side(jsonb, text) to authenticated;

create or replace function public.combat_crawl_token(
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
  v_edges jsonb;
  v_tokens jsonb;
  v_elevations jsonb;
  v_mode boolean;
  v_actor_entry jsonb;
  v_actor_entry_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_side text := 'player';
  v_other_side text := 'player';
  v_actor_elevation int := 0;
  v_other_elevation int := 0;
  v_other_token text;
  v_attached_token_ids text[] := array[]::text[];
  v_attached_token_id text;
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
         coalesce(engagements, '[]'::jsonb),
         coalesce(token_positions, '[]'::jsonb),
         coalesce(token_elevations, '[]'::jsonb)
  into v_mode, v_entries, v_edges, v_tokens, v_elevations
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode, false) = false then
    raise exception 'Combat mode is not active';
  end if;

  select e.ord - 1, e.entry
  into v_actor_entry_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_actor_entry_idx is null then
    raise exception 'Actor participant not found';
  end if;

  if coalesce(v_actor_entry->>'prone', 'false') <> 'true' then
    raise exception 'Can only crawl while prone';
  end if;

  begin
    select coalesce((e.value->>'elevation')::int, 0)
    into v_actor_elevation
    from jsonb_array_elements(v_elevations) as e(value)
    where e.value->>'character_id' = p_actor_token_id
    limit 1;
  exception when others then
    v_actor_elevation := 0;
  end;
  v_actor_elevation := greatest(0, coalesce(v_actor_elevation, 0));

  v_actor_side := public.combat_token_side(v_entries, p_actor_token_id);
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
    v_other_side := public.combat_token_side(v_entries, v_other_token);
    if v_other_side <> v_actor_side then
      begin
        select coalesce((e.value->>'elevation')::int, 0)
        into v_other_elevation
        from jsonb_array_elements(v_elevations) as e(value)
        where e.value->>'character_id' = v_other_token
        limit 1;
      exception when others then
        v_other_elevation := 0;
      end;
      v_other_elevation := greatest(0, coalesce(v_other_elevation, 0));
      if v_other_elevation = v_actor_elevation then
        raise exception 'Cannot crawl while engaged with an enemy';
      end if;
    end if;
  end loop;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can crawl';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only crawl with your own character';
    end if;
  end if;

  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappled_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'clinging_target_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  for v_attached_token_id in
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array' then v_actor_entry->'clung_onto_by_ids'
        else '[]'::jsonb
      end
    )
  loop
    if v_attached_token_id is not null and btrim(v_attached_token_id) <> '' and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
  end loop;
  if array_length(v_attached_token_ids, 1) is not null then
    v_attached_token_ids := array_remove(v_attached_token_ids, p_actor_token_id);
  end if;

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

  foreach v_attached_token_id in array v_attached_token_ids loop
    v_tokens := coalesce(
      (
        select jsonb_agg(t.value)
        from jsonb_array_elements(v_tokens) as t(value)
        where coalesce(t.value->>'character_id', '') <> v_attached_token_id
      ),
      '[]'::jsonb
    );

    v_tokens := v_tokens || jsonb_build_array(
      jsonb_build_object(
        'character_id', v_attached_token_id,
        'x', p_x,
        'y', p_y
      )
    );
  end loop;

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

grant execute on function public.combat_crawl_token(text, double precision, double precision) to authenticated;

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
  v_elevations jsonb;
  v_actor_exists boolean;
  v_target_exists boolean;
  v_actor_elevation int := 0;
  v_target_elevation int := 0;
  v_member_elevation int := 0;
  v_component text[];
  v_changed boolean;
  e record;
  rel record;
  v_member text;
  v_entry_token text;
  v_linked_token text;
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

  select combat_mode, initiative_entries, initiative_current_index, coalesce(engagements, '[]'::jsonb), coalesce(token_positions, '[]'::jsonb), coalesce(token_elevations, '[]'::jsonb)
  into v_mode, v_entries, v_idx, v_edges, v_tokens, v_elevations
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

  begin
    select coalesce((e.value->>'elevation')::int, 0)
    into v_actor_elevation
    from jsonb_array_elements(v_elevations) as e(value)
    where e.value->>'character_id' = p_actor_token_id
    limit 1;
  exception when others then
    v_actor_elevation := 0;
  end;
  begin
    select coalesce((e.value->>'elevation')::int, 0)
    into v_target_elevation
    from jsonb_array_elements(v_elevations) as e(value)
    where e.value->>'character_id' = p_target_token_id
    limit 1;
  exception when others then
    v_target_elevation := 0;
  end;
  v_actor_elevation := greatest(0, coalesce(v_actor_elevation, 0));
  v_target_elevation := greatest(0, coalesce(v_target_elevation, 0));
  if v_actor_elevation <> v_target_elevation then
    raise exception 'Cannot engage targets at different elevations';
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

    -- Expand through active grapple/cling relationships as well.
    for rel in
      select en.value as entry
      from jsonb_array_elements(v_entries) as en(value)
    loop
      v_entry_token := coalesce(rel.entry->>'participant_id', '');
      if left(v_entry_token, 7) = 'player:' then
        v_entry_token := substr(v_entry_token, 8);
      end if;
      if v_entry_token = '' then
        continue;
      end if;

      foreach v_linked_token in array array[
        nullif(coalesce(rel.entry->>'grappling_target_id', ''), ''),
        nullif(coalesce(rel.entry->>'grappled_by_id', ''), ''),
        nullif(coalesce(rel.entry->>'clinging_target_id', ''), ''),
        nullif(coalesce(rel.entry->>'clung_onto_by_id', ''), '')
      ] loop
        if v_linked_token is null then
          continue;
        end if;
        if v_entry_token = any(v_component) and not (v_linked_token = any(v_component)) then
          v_component := array_append(v_component, v_linked_token);
          v_changed := true;
        elsif v_linked_token = any(v_component) and not (v_entry_token = any(v_component)) then
          v_component := array_append(v_component, v_entry_token);
          v_changed := true;
        end if;
      end loop;

      for v_linked_token in
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(rel.entry->'clung_onto_by_ids') = 'array'
            then rel.entry->'clung_onto_by_ids'
            else '[]'::jsonb
          end
        )
      loop
        if v_entry_token = any(v_component) and not (v_linked_token = any(v_component)) then
          v_component := array_append(v_component, v_linked_token);
          v_changed := true;
        elsif v_linked_token = any(v_component) and not (v_entry_token = any(v_component)) then
          v_component := array_append(v_component, v_entry_token);
          v_changed := true;
        end if;
      end loop;
    end loop;

    exit when not v_changed;
  end loop;

  foreach v_member in array v_component loop
    if v_member = p_actor_token_id then
      continue;
    end if;

    begin
      select coalesce((e.value->>'elevation')::int, 0)
      into v_member_elevation
      from jsonb_array_elements(v_elevations) as e(value)
      where e.value->>'character_id' = v_member
      limit 1;
    exception when others then
      v_member_elevation := 0;
    end;
    v_member_elevation := greatest(0, coalesce(v_member_elevation, 0));
    if v_member_elevation <> v_actor_elevation then
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
  v_elevations jsonb;
  v_mode boolean;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_side text := 'player';
  v_other_side text := 'player';
  v_actor_elevation int := 0;
  v_other_elevation int := 0;
  v_other_token text;
  v_actor_entry jsonb;
  v_actor_entry_idx int;
  v_grappling_target_id text;
  v_grapple_target_entry jsonb;
  v_actor_size int := 1;
  v_grapple_target_size int := 1;
  v_actor_can_run_with_grapple boolean := false;
  v_attached_token_ids text[] := array[]::text[];
  v_attached_token_id text;
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
         coalesce(token_positions, '[]'::jsonb),
         coalesce(token_elevations, '[]'::jsonb)
  into v_mode, v_entries, v_idx, v_edges, v_tokens, v_elevations
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
  v_actor_side := public.combat_token_side(v_entries, p_actor_token_id);

  select e.ord - 1, e.entry
  into v_actor_entry_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  if v_actor_entry_idx is null then
    raise exception 'Actor participant not found';
  end if;

  if nullif(coalesce(v_actor_entry->>'clinging_target_id', ''), '') is not null then
    raise exception 'Cannot run while clinging';
  end if;

  v_grappling_target_id := nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '');
  if v_grappling_target_id is not null then
    if coalesce(v_actor_entry->>'kind', '') = 'monster' then
      v_actor_size := coalesce((v_actor_entry->'monster_snapshot'->>'size')::int, 1);
    end if;

    select e.entry
    into v_grapple_target_entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = v_grappling_target_id
       or e.entry->>'participant_id' = ('player:' || v_grappling_target_id)
    order by e.ord
    limit 1;

    if v_grapple_target_entry is not null and coalesce(v_grapple_target_entry->>'kind', '') = 'monster' then
      v_grapple_target_size := coalesce((v_grapple_target_entry->'monster_snapshot'->>'size')::int, 1);
    end if;

    v_actor_can_run_with_grapple := v_actor_size > v_grapple_target_size;
  end if;

  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappled_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  for v_attached_token_id in
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array' then v_actor_entry->'clung_onto_by_ids'
        else '[]'::jsonb
      end
    )
  loop
    if v_attached_token_id is not null and btrim(v_attached_token_id) <> '' and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
  end loop;
  if array_length(v_attached_token_ids, 1) is not null then
    v_attached_token_ids := array_remove(v_attached_token_ids, p_actor_token_id);
  end if;

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

  begin
    select coalesce((e.value->>'elevation')::int, 0)
    into v_actor_elevation
    from jsonb_array_elements(v_elevations) as e(value)
    where e.value->>'character_id' = p_actor_token_id
    limit 1;
  exception when others then
    v_actor_elevation := 0;
  end;
  v_actor_elevation := greatest(0, coalesce(v_actor_elevation, 0));

  -- Cannot run while engaged with any enemy, except when the only enemy engagement
  -- is the actor's grappled target and the actor is strictly larger.
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

    v_other_side := public.combat_token_side(v_entries, v_other_token);
    if v_other_side <> v_actor_side then
      begin
        select coalesce((e.value->>'elevation')::int, 0)
        into v_other_elevation
        from jsonb_array_elements(v_elevations) as e(value)
        where e.value->>'character_id' = v_other_token
        limit 1;
      exception when others then
        v_other_elevation := 0;
      end;
      v_other_elevation := greatest(0, coalesce(v_other_elevation, 0));
      if v_other_elevation = v_actor_elevation then
        if v_actor_can_run_with_grapple and v_other_token = v_grappling_target_id then
          continue;
        end if;
        raise exception 'Cannot run while engaged with an enemy';
      end if;
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

  foreach v_attached_token_id in array v_attached_token_ids loop
    v_tokens := coalesce(
      (
        select jsonb_agg(t.value)
        from jsonb_array_elements(v_tokens) as t(value)
        where coalesce(t.value->>'character_id', '') <> v_attached_token_id
      ),
      '[]'::jsonb
    );

    v_tokens := v_tokens || jsonb_build_array(
      jsonb_build_object(
        'character_id', v_attached_token_id,
        'x', p_x,
        'y', p_y
      )
    );
  end loop;

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

create or replace function public.combat_fly_token(
  p_actor_token_id text,
  p_x double precision,
  p_y double precision,
  p_elevation_delta int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_entries jsonb;
  v_elevations jsonb;
  v_actor_entry jsonb;
  v_actor_idx int;
  v_current_elevation int := 0;
  v_next_elevation int := 0;
  v_attached_token_ids text[] := array[]::text[];
  v_attached_token_id text;
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

  if p_elevation_delta is null or p_elevation_delta not in (-1, 1) then
    raise exception 'Fly elevation delta must be -1 or 1';
  end if;

  select coalesce(token_elevations, '[]'::jsonb), coalesce(initiative_entries, '[]'::jsonb)
  into v_elevations, v_entries
  from public.combat_state
  where id = 1
  for update;

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

  begin
    select coalesce((e.value->>'elevation')::int, 0)
    into v_current_elevation
    from jsonb_array_elements(v_elevations) as e(value)
    where e.value->>'character_id' = p_actor_token_id
    limit 1;
  exception when others then
    v_current_elevation := 0;
  end;
  v_current_elevation := greatest(0, coalesce(v_current_elevation, 0));
  v_next_elevation := v_current_elevation + p_elevation_delta;
  if v_next_elevation < 0 then
    raise exception 'Cannot fly below elevation 0';
  end if;

  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'grappled_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  v_attached_token_id := nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '');
  if v_attached_token_id is not null and not (v_attached_token_id = any(v_attached_token_ids)) then
    v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
  end if;
  for v_attached_token_id in
    select jsonb_array_elements_text(
      case
        when jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array' then v_actor_entry->'clung_onto_by_ids'
        else '[]'::jsonb
      end
    )
  loop
    if v_attached_token_id is not null and btrim(v_attached_token_id) <> '' and not (v_attached_token_id = any(v_attached_token_ids)) then
      v_attached_token_ids := array_append(v_attached_token_ids, v_attached_token_id);
    end if;
  end loop;
  if array_length(v_attached_token_ids, 1) is not null then
    v_attached_token_ids := array_remove(v_attached_token_ids, p_actor_token_id);
  end if;

  perform public.combat_run_token(p_actor_token_id, p_x, p_y);

  select coalesce(token_elevations, '[]'::jsonb)
  into v_elevations
  from public.combat_state
  where id = 1
  for update;

  v_elevations := coalesce(
    (
      select jsonb_agg(e.value)
      from jsonb_array_elements(v_elevations) as e(value)
      where coalesce(e.value->>'character_id', '') <> p_actor_token_id
        and not (coalesce(e.value->>'character_id', '') = any(v_attached_token_ids))
    ),
    '[]'::jsonb
  );

  v_elevations := v_elevations || jsonb_build_array(
    jsonb_build_object(
      'character_id', p_actor_token_id,
      'elevation', v_next_elevation
    )
  );

  foreach v_attached_token_id in array v_attached_token_ids loop
    v_elevations := v_elevations || jsonb_build_array(
      jsonb_build_object(
        'character_id', v_attached_token_id,
        'elevation', v_next_elevation
      )
    );
  end loop;

  update public.combat_state
  set token_elevations = v_elevations,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_fly_token(text, double precision, double precision, int) to authenticated;

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

create or replace function public.combat_set_readied_for_token(
  p_actor_token_id text,
  p_weapon_item_id text,
  p_weapon_name text,
  p_weapon_hand text,
  p_ammo_item jsonb
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
  if p_weapon_item_id is null or btrim(p_weapon_item_id) = '' then
    raise exception 'Weapon item id is required';
  end if;
  if p_weapon_name is null or btrim(p_weapon_name) = '' then
    raise exception 'Weapon name is required';
  end if;
  if p_weapon_hand not in ('left', 'right', 'both') then
    raise exception 'Weapon hand must be left, right, or both';
  end if;
  if p_ammo_item is null or jsonb_typeof(p_ammo_item) <> 'object' then
    raise exception 'Ammo item is required';
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
      raise exception 'Only player characters can ready weapons';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can ready weapons';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only ready weapons for your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only ready weapons for your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{readied_weapon_item_id}', to_jsonb(p_weapon_item_id), true);
  v_entry := jsonb_set(v_entry, '{readied_weapon_name}', to_jsonb(p_weapon_name), true);
  v_entry := jsonb_set(v_entry, '{readied_weapon_hand}', to_jsonb(p_weapon_hand), true);
  v_entry := jsonb_set(v_entry, '{readied_ammo_item}', p_ammo_item, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_set_readied_for_token(text, text, text, text, jsonb) to authenticated;

create or replace function public.combat_clear_readied_for_token(
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
      raise exception 'Only player characters can clear readied weapon';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can clear readied weapon';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only clear readied weapon for your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only clear readied weapon for your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{readied_weapon_item_id}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{readied_weapon_name}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{readied_weapon_hand}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{readied_ammo_item}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_clear_readied_for_token(text) to authenticated;

create or replace function public.combat_set_aim_for_token(
  p_actor_token_id text,
  p_target_token_id text,
  p_target_name text,
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
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;
  if p_weapon_item_id is null or btrim(p_weapon_item_id) = '' then
    raise exception 'Weapon item id is required';
  end if;
  if p_weapon_name is null or btrim(p_weapon_name) = '' then
    raise exception 'Weapon name is required';
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
      raise exception 'Only player characters can aim';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can aim';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only aim with your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only aim with your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{aim_target_id}', to_jsonb(p_target_token_id), true);
  v_entry := jsonb_set(v_entry, '{aim_target_name}', to_jsonb(coalesce(nullif(btrim(p_target_name), ''), 'Target')), true);
  v_entry := jsonb_set(v_entry, '{aim_weapon_item_id}', to_jsonb(p_weapon_item_id), true);
  v_entry := jsonb_set(v_entry, '{aim_weapon_name}', to_jsonb(p_weapon_name), true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_set_aim_for_token(text, text, text, text, text) to authenticated;

create or replace function public.combat_clear_aim_for_token(
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
      raise exception 'Only player characters can clear aim';
    end if;

    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can clear aim';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only clear aim for your own character';
    end if;
    if v_entry_email is null or lower(v_entry_email) <> lower(v_email) then
      raise exception 'You can only clear aim for your own character';
    end if;
  end if;

  v_entry := jsonb_set(v_entry, '{aim_target_id}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{aim_target_name}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{aim_weapon_item_id}', 'null'::jsonb, true);
  v_entry := jsonb_set(v_entry, '{aim_weapon_name}', 'null'::jsonb, true);
  v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_clear_aim_for_token(text) to authenticated;

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
  v_grappling_target_id text;
  v_target_entry jsonb;
  v_actor_size int := 1;
  v_target_size int := 1;
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

  v_grappling_target_id := nullif(coalesce(v_entry->>'grappling_target_id', ''), '');
  if nullif(coalesce(v_entry->>'clinging_target_id', ''), '') is not null
     or nullif(coalesce(v_entry->>'grappled_by_id', ''), '') is not null then
    raise exception 'Cannot get up while grappling, clinging, or grappled';
  end if;
  if v_grappling_target_id is not null then
    if coalesce(v_entry->>'kind', '') = 'monster' then
      v_actor_size := coalesce((v_entry->'monster_snapshot'->>'size')::int, 1);
    end if;

    select e.entry
    into v_target_entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = v_grappling_target_id
       or e.entry->>'participant_id' = ('player:' || v_grappling_target_id)
    order by e.ord
    limit 1;

    if v_target_entry is not null and coalesce(v_target_entry->>'kind', '') = 'monster' then
      v_target_size := coalesce((v_target_entry->'monster_snapshot'->>'size')::int, 1);
    end if;

    if v_actor_size <= v_target_size then
      raise exception 'Cannot get up while grappling, clinging, or grappled';
    end if;
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
  v_readied_weapon_item_id text;
  v_readied_weapon_name text;
  v_readied_ammo_item jsonb;
  v_should_clear_readied boolean := false;
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

  v_readied_weapon_item_id := nullif(coalesce(v_target_entry->>'readied_weapon_item_id', ''), '');
  v_readied_weapon_name := nullif(coalesce(v_target_entry->>'readied_weapon_name', ''), '');
  v_readied_ammo_item := v_target_entry->'readied_ammo_item';

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

  v_should_clear_readied :=
    v_readied_weapon_item_id is not null and (
      v_readied_weapon_item_id = p_target_item_id
      or (v_readied_weapon_name is not null and v_readied_weapon_name = v_target_item_name)
    );

  if v_should_clear_readied then
    if v_readied_ammo_item is not null and jsonb_typeof(v_readied_ammo_item) = 'object' then
      v_zone_loot := coalesce(v_zone_loot, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
          'zone_id', p_zone_id,
          'item', v_readied_ammo_item
        )
      );
    end if;
    v_target_entry := jsonb_set(v_target_entry, '{readied_weapon_item_id}', 'null'::jsonb, true);
    v_target_entry := jsonb_set(v_target_entry, '{readied_weapon_name}', 'null'::jsonb, true);
    v_target_entry := jsonb_set(v_target_entry, '{readied_weapon_hand}', 'null'::jsonb, true);
    v_target_entry := jsonb_set(v_target_entry, '{readied_ammo_item}', 'null'::jsonb, true);
  end if;

  v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

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
  v_item_qty int;
  v_merge_ord int;
  v_merge_item jsonb;
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
  v_item_qty := greatest(1, coalesce((v_item->>'quantity')::int, 1));

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

    select coalesce(inventory, '[]'::jsonb)
    into v_actor_gear
    from public.characters
    where id = v_actor_uuid
    limit 1;

    select e.ord, e.value
    into v_merge_ord, v_merge_item
    from jsonb_array_elements(v_actor_gear) with ordinality as e(value, ord)
    where (e.value - 'id' - 'quantity') = (v_item - 'id' - 'quantity')
    order by e.ord
    limit 1;

    if v_merge_ord is null then
      v_actor_gear := coalesce(v_actor_gear, '[]'::jsonb) || jsonb_build_array(v_item);
    else
      v_merge_item := jsonb_set(
        v_merge_item,
        '{quantity}',
        to_jsonb(greatest(1, coalesce((v_merge_item->>'quantity')::int, 1) + v_item_qty)),
        true
      );
      v_actor_gear := jsonb_set(v_actor_gear, array[(v_merge_ord - 1)::text], v_merge_item, false);
    end if;

    update public.characters
    set inventory = v_actor_gear
    where id = v_actor_uuid;
  else
    v_actor_snapshot := coalesce(v_actor_entry->'monster_snapshot', '{}'::jsonb);
    v_actor_gear := coalesce(v_actor_snapshot->'gear', '[]'::jsonb);
    select e.ord, e.value
    into v_merge_ord, v_merge_item
    from jsonb_array_elements(v_actor_gear) with ordinality as e(value, ord)
    where (e.value - 'id' - 'quantity') = (v_item - 'id' - 'quantity')
    order by e.ord
    limit 1;

    if v_merge_ord is null then
      v_actor_gear := v_actor_gear || jsonb_build_array(v_item);
    else
      v_merge_item := jsonb_set(
        v_merge_item,
        '{quantity}',
        to_jsonb(greatest(1, coalesce((v_merge_item->>'quantity')::int, 1) + v_item_qty)),
        true
      );
      v_actor_gear := jsonb_set(v_actor_gear, array[(v_merge_ord - 1)::text], v_merge_item, false);
    end if;

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
  v_has_engagement boolean := false;
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

  select exists (
    select 1
    from jsonb_array_elements(v_edges) as ed(value)
    where ed.value->>'a' = p_actor_token_id
       or ed.value->>'b' = p_actor_token_id
  )
  into v_has_engagement;

  if not v_has_engagement then
    raise exception 'Actor is not engaged';
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

create or replace function public.combat_resolve_grapple_or_cling(
  p_actor_token_id text,
  p_target_token_id text,
  p_mode text,
  p_success boolean,
  p_zone_id int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_is_dm boolean := v_email = 'drocasma9@gmail.com';
  v_mode text := lower(coalesce(p_mode, ''));
  v_entries jsonb;
  v_monsters jsonb;
  v_edges jsonb;
  v_tokens jsonb;
  v_zone_loot jsonb;
  v_mode_on boolean;
  v_actor_entry jsonb;
  v_target_entry jsonb;
  v_actor_idx int;
  v_target_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_size int := 1;
  v_target_size int := 1;
  v_actor_kind text;
  v_target_kind text;
  v_target_uuid uuid;
  v_target_inventory jsonb;
  v_target_slots jsonb;
  v_target_snapshot jsonb;
  v_target_snapshot_gear jsonb;
  v_target_snapshot_slots jsonb;
  v_target_monster_id text;
  v_drop_items jsonb;
  v_target_clung_ids jsonb := '[]'::jsonb;
  v_target_clung_names jsonb := '[]'::jsonb;
  v_legacy_clinger_id text;
  v_legacy_clinger_name text;
  v_first_clinger_id text;
  v_first_clinger_name text;
  v_a text;
  v_b text;
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
    raise exception 'Cannot target self';
  end if;
  if v_mode not in ('grapple', 'cling') then
    raise exception 'Invalid grapple mode';
  end if;
  if p_zone_id is null or p_zone_id <= 0 then
    raise exception 'Zone is required';
  end if;

  select combat_mode,
         initiative_entries,
         initiative_monsters,
         coalesce(engagements, '[]'::jsonb),
         coalesce(token_positions, '[]'::jsonb),
         coalesce(zone_loot, '[]'::jsonb)
  into v_mode_on, v_entries, v_monsters, v_edges, v_tokens, v_zone_loot
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode_on, false) = false then
    raise exception 'Combat mode is not active';
  end if;
  if v_entries is null or jsonb_array_length(v_entries) = 0 then
    raise exception 'No initiative entries';
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_tokens) as t(value)
    where t.value->>'character_id' = p_actor_token_id
  ) then
    raise exception 'Actor token not found';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_tokens) as t(value)
    where t.value->>'character_id' = p_target_token_id
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
      raise exception 'Only player characters can use this action';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only use this action with your own character';
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

  if nullif(coalesce(v_actor_entry->>'grappling_target_id', ''), '') is not null
     or nullif(coalesce(v_actor_entry->>'grappled_by_id', ''), '') is not null
     or nullif(coalesce(v_actor_entry->>'clinging_target_id', ''), '') is not null
     or nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '') is not null
     or (
       jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array'
       and jsonb_array_length(v_actor_entry->'clung_onto_by_ids') > 0
     ) then
    raise exception 'Actor is already in a grapple/cling relationship';
  end if;
  if v_mode = 'grapple' then
    if nullif(coalesce(v_target_entry->>'grappling_target_id', ''), '') is not null
       or nullif(coalesce(v_target_entry->>'grappled_by_id', ''), '') is not null
       or nullif(coalesce(v_target_entry->>'clinging_target_id', ''), '') is not null
       or nullif(coalesce(v_target_entry->>'clung_onto_by_id', ''), '') is not null
       or (
         jsonb_typeof(v_target_entry->'clung_onto_by_ids') = 'array'
         and jsonb_array_length(v_target_entry->'clung_onto_by_ids') > 0
       ) then
      raise exception 'Target is already in a grapple/cling relationship';
    end if;
  else
    if nullif(coalesce(v_target_entry->>'clinging_target_id', ''), '') is not null then
      raise exception 'Cannot cling onto a clinging creature';
    end if;
  end if;

  v_actor_kind := coalesce(v_actor_entry->>'kind', '');
  v_target_kind := coalesce(v_target_entry->>'kind', '');
  if v_actor_kind = 'monster' then
    v_actor_size := coalesce((v_actor_entry->'monster_snapshot'->>'size')::int, 1);
  end if;
  if v_target_kind = 'monster' then
    v_target_size := coalesce((v_target_entry->'monster_snapshot'->>'size')::int, 1);
  end if;

  if v_mode = 'grapple' and v_actor_size < v_target_size then
    raise exception 'Cannot grapple larger target';
  end if;
  if v_mode = 'cling' and v_target_size <= v_actor_size then
    raise exception 'Can only cling to larger target';
  end if;

  if v_actor_kind = 'player' then
    select coalesce(to_jsonb(equipment_slots), '{}'::jsonb)
    into v_target_slots
    from public.characters
    where id = p_actor_token_id::uuid
    limit 1;
    if nullif(coalesce(v_target_slots->>'left', ''), '') is not null
       or nullif(coalesce(v_target_slots->>'right', ''), '') is not null then
      raise exception 'Must be unarmed to grapple or cling';
    end if;
  end if;

  if not coalesce(p_success, false) then
    return;
  end if;

  if v_mode = 'grapple' then
    v_actor_entry := jsonb_set(v_actor_entry, '{grappling_target_id}', to_jsonb(p_target_token_id), true);
    v_actor_entry := jsonb_set(v_actor_entry, '{grappling_target_name}', to_jsonb(coalesce(v_target_entry->>'name', 'Target')), true);
    if v_actor_size <= v_target_size then
      v_actor_entry := jsonb_set(v_actor_entry, '{prone}', 'true'::jsonb, true);
    end if;

    v_target_entry := jsonb_set(v_target_entry, '{grappled_by_id}', to_jsonb(p_actor_token_id), true);
    v_target_entry := jsonb_set(v_target_entry, '{grappled_by_name}', to_jsonb(coalesce(v_actor_entry->>'name', 'Actor')), true);
    v_target_entry := jsonb_set(v_target_entry, '{prone}', 'true'::jsonb, true);
  else
    v_actor_entry := jsonb_set(v_actor_entry, '{clinging_target_id}', to_jsonb(p_target_token_id), true);
    v_actor_entry := jsonb_set(v_actor_entry, '{clinging_target_name}', to_jsonb(coalesce(v_target_entry->>'name', 'Target')), true);
    v_actor_entry := jsonb_set(v_actor_entry, '{prone}', 'true'::jsonb, true);

    v_target_clung_ids :=
      case
        when jsonb_typeof(v_target_entry->'clung_onto_by_ids') = 'array'
        then coalesce(v_target_entry->'clung_onto_by_ids', '[]'::jsonb)
        else '[]'::jsonb
      end;
    v_target_clung_names :=
      case
        when jsonb_typeof(v_target_entry->'clung_onto_by_names') = 'array'
        then coalesce(v_target_entry->'clung_onto_by_names', '[]'::jsonb)
        else '[]'::jsonb
      end;

    v_legacy_clinger_id := nullif(coalesce(v_target_entry->>'clung_onto_by_id', ''), '');
    v_legacy_clinger_name := nullif(coalesce(v_target_entry->>'clung_onto_by_name', ''), '');
    if v_legacy_clinger_id is not null and not exists (
      select 1
      from jsonb_array_elements_text(v_target_clung_ids) as x(value)
      where x.value = v_legacy_clinger_id
    ) then
      v_target_clung_ids := v_target_clung_ids || jsonb_build_array(v_legacy_clinger_id);
      v_target_clung_names := v_target_clung_names || jsonb_build_array(coalesce(v_legacy_clinger_name, v_legacy_clinger_id));
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(v_target_clung_ids) as x(value)
      where x.value = p_actor_token_id
    ) then
      v_target_clung_ids := v_target_clung_ids || jsonb_build_array(p_actor_token_id);
      v_target_clung_names := v_target_clung_names || jsonb_build_array(coalesce(v_actor_entry->>'name', 'Actor'));
    end if;

    select x.value
    into v_first_clinger_id
    from jsonb_array_elements_text(v_target_clung_ids) as x(value)
    limit 1;
    select x.value
    into v_first_clinger_name
    from jsonb_array_elements_text(v_target_clung_names) as x(value)
    limit 1;

    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_ids}', v_target_clung_ids, true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_names}', v_target_clung_names, true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_id}', to_jsonb(v_first_clinger_id), true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_name}', to_jsonb(v_first_clinger_name), true);
  end if;

  if v_mode = 'grapple' then
    if v_target_kind = 'player' then
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

      v_drop_items := (
        select coalesce(jsonb_agg(i.value), '[]'::jsonb)
        from jsonb_array_elements(v_target_inventory) as i(value)
        where coalesce(i.value->>'id', '') = coalesce(v_target_slots->>'left', '')
           or coalesce(i.value->>'name', '') = coalesce(v_target_slots->>'left', '')
           or coalesce(i.value->>'id', '') = coalesce(v_target_slots->>'right', '')
           or coalesce(i.value->>'name', '') = coalesce(v_target_slots->>'right', '')
      );

      v_target_inventory := coalesce(
        (
          select jsonb_agg(i.value)
          from jsonb_array_elements(v_target_inventory) as i(value)
          where not (
            coalesce(i.value->>'id', '') = coalesce(v_target_slots->>'left', '')
            or coalesce(i.value->>'name', '') = coalesce(v_target_slots->>'left', '')
            or coalesce(i.value->>'id', '') = coalesce(v_target_slots->>'right', '')
            or coalesce(i.value->>'name', '') = coalesce(v_target_slots->>'right', '')
          )
        ),
        '[]'::jsonb
      );

      v_target_slots := jsonb_set(v_target_slots, '{left}', 'null'::jsonb, true);
      v_target_slots := jsonb_set(v_target_slots, '{right}', 'null'::jsonb, true);

      update public.characters
      set equipment_slots = v_target_slots,
          inventory = v_target_inventory
      where id = v_target_uuid;
    else
      v_target_snapshot := coalesce(v_target_entry->'monster_snapshot', '{}'::jsonb);
      v_target_snapshot_gear := coalesce(v_target_snapshot->'gear', '[]'::jsonb);
      v_target_snapshot_slots := coalesce(v_target_snapshot->'equipment_slots', '{}'::jsonb);

      v_drop_items := (
        select coalesce(jsonb_agg(i.value), '[]'::jsonb)
        from jsonb_array_elements(v_target_snapshot_gear) as i(value)
        where coalesce(i.value->>'id', '') = coalesce(v_target_snapshot_slots->>'left', '')
           or coalesce(i.value->>'name', '') = coalesce(v_target_snapshot_slots->>'left', '')
           or coalesce(i.value->>'id', '') = coalesce(v_target_snapshot_slots->>'right', '')
           or coalesce(i.value->>'name', '') = coalesce(v_target_snapshot_slots->>'right', '')
      );

      v_target_snapshot_gear := coalesce(
        (
          select jsonb_agg(i.value)
          from jsonb_array_elements(v_target_snapshot_gear) as i(value)
          where not (
            coalesce(i.value->>'id', '') = coalesce(v_target_snapshot_slots->>'left', '')
            or coalesce(i.value->>'name', '') = coalesce(v_target_snapshot_slots->>'left', '')
            or coalesce(i.value->>'id', '') = coalesce(v_target_snapshot_slots->>'right', '')
            or coalesce(i.value->>'name', '') = coalesce(v_target_snapshot_slots->>'right', '')
          )
        ),
        '[]'::jsonb
      );

      v_target_snapshot_slots := jsonb_set(v_target_snapshot_slots, '{left}', 'null'::jsonb, true);
      v_target_snapshot_slots := jsonb_set(v_target_snapshot_slots, '{right}', 'null'::jsonb, true);
      v_target_snapshot := jsonb_set(v_target_snapshot, '{gear}', v_target_snapshot_gear, true);
      v_target_snapshot := jsonb_set(v_target_snapshot, '{equipment_slots}', v_target_snapshot_slots, true);
      v_target_entry := jsonb_set(v_target_entry, '{monster_snapshot}', v_target_snapshot, true);

      v_monsters := coalesce(v_monsters, '[]'::jsonb);
      v_target_monster_id := coalesce(v_target_entry->>'participant_id', '');
      select coalesce(
        jsonb_agg(
          case
            when mon.value->>'id' = v_target_monster_id
            then jsonb_set(mon.value, '{monster_snapshot}', v_target_snapshot, true)
            else mon.value
          end
        ),
        '[]'::jsonb
      )
      into v_monsters
      from jsonb_array_elements(v_monsters) as mon(value);
    end if;

    if coalesce(v_drop_items, '[]'::jsonb) <> '[]'::jsonb then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'zone_id', p_zone_id,
            'item', drop_item.value
          )
        ),
        '[]'::jsonb
      )
      into v_drop_items
      from jsonb_array_elements(v_drop_items) as drop_item(value);

      v_zone_loot := coalesce(v_zone_loot, '[]'::jsonb) || v_drop_items;
    end if;
  end if;

  -- Relationship implies engagement; ensure the pair edge exists.
  v_a := least(p_actor_token_id, p_target_token_id);
  v_b := greatest(p_actor_token_id, p_target_token_id);
  if not exists (
    select 1
    from jsonb_array_elements(v_edges) as ed(value)
    where ed.value->>'a' = v_a
      and ed.value->>'b' = v_b
  ) then
    v_edges := v_edges || jsonb_build_array(jsonb_build_object('a', v_a, 'b', v_b));
  end if;

  v_entries := jsonb_set(v_entries, array[v_actor_idx::text], v_actor_entry, false);
  v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      initiative_monsters = coalesce(v_monsters, initiative_monsters),
      engagements = v_edges,
      zone_loot = v_zone_loot,
      token_positions = (
        select coalesce(
          jsonb_agg(
            case
              when t.value->>'character_id' = p_target_token_id
              then jsonb_build_object('character_id', p_target_token_id, 'x', a.value->'x', 'y', a.value->'y')
              else t.value
            end
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(v_tokens) as t(value),
             lateral (
               select tok.value
               from jsonb_array_elements(v_tokens) as tok(value)
               where tok.value->>'character_id' = p_actor_token_id
               limit 1
             ) as a
      ),
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_resolve_grapple_or_cling(text, text, text, boolean, int) to authenticated;

create or replace function public.combat_release_grapple_or_cling(
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
  v_mode_on boolean;
  v_actor_entry jsonb;
  v_target_entry jsonb;
  v_actor_idx int;
  v_target_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_target_clung_ids jsonb := '[]'::jsonb;
  v_target_clung_names jsonb := '[]'::jsonb;
  v_first_clinger_id text;
  v_first_clinger_name text;
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

  select combat_mode, coalesce(initiative_entries, '[]'::jsonb)
  into v_mode_on, v_entries
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode_on, false) = false then
    raise exception 'Combat mode is not active';
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

  if v_actor_idx is null or v_target_idx is null then
    raise exception 'Participants not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can release';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only release with your own character';
    end if;
  end if;

  if (v_actor_entry->>'grappling_target_id') <> p_target_token_id
     and (v_actor_entry->>'clinging_target_id') <> p_target_token_id then
    raise exception 'No release relationship found';
  end if;

  if (v_actor_entry->>'grappling_target_id') = p_target_token_id then
    v_actor_entry := jsonb_set(v_actor_entry, '{grappling_target_id}', 'null'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{grappling_target_name}', 'null'::jsonb, true);
    v_target_entry := jsonb_set(v_target_entry, '{grappled_by_id}', 'null'::jsonb, true);
    v_target_entry := jsonb_set(v_target_entry, '{grappled_by_name}', 'null'::jsonb, true);
  end if;

  if (v_actor_entry->>'clinging_target_id') = p_target_token_id then
    v_actor_entry := jsonb_set(v_actor_entry, '{clinging_target_id}', 'null'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{clinging_target_name}', 'null'::jsonb, true);

    v_target_clung_ids :=
      case
        when jsonb_typeof(v_target_entry->'clung_onto_by_ids') = 'array'
        then coalesce(v_target_entry->'clung_onto_by_ids', '[]'::jsonb)
        else '[]'::jsonb
      end;
    v_target_clung_names :=
      case
        when jsonb_typeof(v_target_entry->'clung_onto_by_names') = 'array'
        then coalesce(v_target_entry->'clung_onto_by_names', '[]'::jsonb)
        else '[]'::jsonb
      end;

    select coalesce(
      jsonb_agg(v.value),
      '[]'::jsonb
    )
    into v_target_clung_ids
    from jsonb_array_elements(v_target_clung_ids) with ordinality as v(value, ord)
    where v.value::text <> to_jsonb(p_actor_token_id)::text;

    select coalesce(
      jsonb_agg(n.value),
      '[]'::jsonb
    )
    into v_target_clung_names
    from jsonb_array_elements(v_target_clung_names) with ordinality as n(value, ord)
    where n.ord not in (
      select v.ord
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_target_entry->'clung_onto_by_ids') = 'array'
          then coalesce(v_target_entry->'clung_onto_by_ids', '[]'::jsonb)
          else '[]'::jsonb
        end
      ) with ordinality as v(value, ord)
      where v.value::text = to_jsonb(p_actor_token_id)::text
    );

    select x.value into v_first_clinger_id from jsonb_array_elements_text(v_target_clung_ids) as x(value) limit 1;
    select x.value into v_first_clinger_name from jsonb_array_elements_text(v_target_clung_names) as x(value) limit 1;

    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_ids}', v_target_clung_ids, true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_names}', v_target_clung_names, true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_id}', to_jsonb(v_first_clinger_id), true);
    v_target_entry := jsonb_set(v_target_entry, '{clung_onto_by_name}', to_jsonb(v_first_clinger_name), true);
  end if;

  v_entries := jsonb_set(v_entries, array[v_actor_idx::text], v_actor_entry, false);
  v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_release_grapple_or_cling(text, text) to authenticated;

create or replace function public.combat_break_free(
  p_actor_token_id text,
  p_other_token_id text,
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
  v_mode_on boolean;
  v_actor_entry jsonb;
  v_other_entry jsonb;
  v_actor_idx int;
  v_other_idx int;
  v_actor_uuid uuid;
  v_actor_owner_email text;
  v_actor_clung_ids jsonb := '[]'::jsonb;
  v_has_cling_relationship boolean := false;
  v_has_grapple_relationship boolean := false;
  v_clinger_id text;
  v_entry jsonb;
  v_entry_idx int;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;
  if p_actor_token_id is null or btrim(p_actor_token_id) = '' then
    raise exception 'Actor token is required';
  end if;
  if p_other_token_id is null or btrim(p_other_token_id) = '' then
    raise exception 'Other token is required';
  end if;

  select combat_mode, coalesce(initiative_entries, '[]'::jsonb)
  into v_mode_on, v_entries
  from public.combat_state
  where id = 1
  for update;

  if coalesce(v_mode_on, false) = false then
    raise exception 'Combat mode is not active';
  end if;

  select e.ord - 1, e.entry
  into v_actor_idx, v_actor_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_actor_token_id
     or e.entry->>'participant_id' = ('player:' || p_actor_token_id)
  order by e.ord
  limit 1;

  select e.ord - 1, e.entry
  into v_other_idx, v_other_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_other_token_id
     or e.entry->>'participant_id' = ('player:' || p_other_token_id)
  order by e.ord
  limit 1;

  if v_actor_idx is null or v_other_idx is null then
    raise exception 'Participants not found';
  end if;

  if not v_is_dm then
    begin
      v_actor_uuid := p_actor_token_id::uuid;
    exception when others then
      raise exception 'Only player characters can break free';
    end;

    select email into v_actor_owner_email
    from public.characters
    where id = v_actor_uuid
    limit 1;

    if v_actor_owner_email is null or lower(v_actor_owner_email) <> lower(v_email) then
      raise exception 'You can only break free with your own character';
    end if;
  end if;

  v_actor_clung_ids :=
    case
      when jsonb_typeof(v_actor_entry->'clung_onto_by_ids') = 'array'
      then coalesce(v_actor_entry->'clung_onto_by_ids', '[]'::jsonb)
      else '[]'::jsonb
    end;
  if nullif(coalesce(v_actor_entry->>'clung_onto_by_id', ''), '') is not null and not exists (
    select 1
    from jsonb_array_elements_text(v_actor_clung_ids) as x(value)
    where x.value = v_actor_entry->>'clung_onto_by_id'
  ) then
    v_actor_clung_ids := v_actor_clung_ids || jsonb_build_array(v_actor_entry->>'clung_onto_by_id');
  end if;

  v_has_grapple_relationship := (v_actor_entry->>'grappled_by_id') = p_other_token_id;
  v_has_cling_relationship := exists (
    select 1
    from jsonb_array_elements_text(v_actor_clung_ids) as x(value)
    where x.value = p_other_token_id
  );

  if not v_has_grapple_relationship and not v_has_cling_relationship then
    raise exception 'No break free relationship found';
  end if;

  if not coalesce(p_success, false) then
    return;
  end if;

  if v_has_grapple_relationship then
    v_actor_entry := jsonb_set(v_actor_entry, '{grappled_by_id}', 'null'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{grappled_by_name}', 'null'::jsonb, true);
    v_other_entry := jsonb_set(v_other_entry, '{grappling_target_id}', 'null'::jsonb, true);
    v_other_entry := jsonb_set(v_other_entry, '{grappling_target_name}', 'null'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_other_idx::text], v_other_entry, false);
  end if;

  if v_has_cling_relationship then
    v_actor_entry := jsonb_set(v_actor_entry, '{clung_onto_by_id}', 'null'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{clung_onto_by_name}', 'null'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{clung_onto_by_ids}', '[]'::jsonb, true);
    v_actor_entry := jsonb_set(v_actor_entry, '{clung_onto_by_names}', '[]'::jsonb, true);

    for v_clinger_id in
      select x.value
      from jsonb_array_elements_text(v_actor_clung_ids) as x(value)
    loop
      select e.ord - 1, e.entry
      into v_entry_idx, v_entry
      from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
      where e.entry->>'participant_id' = v_clinger_id
         or e.entry->>'participant_id' = ('player:' || v_clinger_id)
      order by e.ord
      limit 1;

      if v_entry_idx is null then
        continue;
      end if;

      v_entry := jsonb_set(v_entry, '{clinging_target_id}', 'null'::jsonb, true);
      v_entry := jsonb_set(v_entry, '{clinging_target_name}', 'null'::jsonb, true);
      v_entries := jsonb_set(v_entries, array[v_entry_idx::text], v_entry, false);
    end loop;
  end if;

  v_entries := jsonb_set(v_entries, array[v_actor_idx::text], v_actor_entry, false);
  if not v_has_grapple_relationship then
    v_entries := jsonb_set(v_entries, array[v_other_idx::text], v_other_entry, false);
  end if;

  update public.combat_state
  set initiative_entries = v_entries,
      updated_by_email = v_email
  where id = 1;
end;
$$;

grant execute on function public.combat_break_free(text, text, boolean) to authenticated;

create or replace function public.combat_resurrect_token(
  p_target_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_entries jsonb;
  v_monsters jsonb;
  v_target_idx int;
  v_target_entry jsonb;
  v_target_uuid uuid;
begin
  if v_email <> 'drocasma9@gmail.com' then
    raise exception 'Only DM can resurrect';
  end if;
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;

  select coalesce(initiative_entries, '[]'::jsonb), coalesce(initiative_monsters, '[]'::jsonb)
  into v_entries, v_monsters
  from public.combat_state
  where id = 1
  for update;

  if p_target_token_id like 'monster:%' then
    select e.ord - 1, e.entry
    into v_target_idx, v_target_entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = p_target_token_id
    order by e.ord
    limit 1;

    if v_target_idx is not null then
      v_target_entry := jsonb_set(v_target_entry, '{dead}', 'false'::jsonb, true);
      if v_target_entry->'monster_snapshot' is not null then
        v_target_entry := jsonb_set(v_target_entry, '{monster_snapshot,dead}', 'false'::jsonb, true);
      end if;
      v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);
    end if;

    select coalesce(
      jsonb_agg(
        case
          when m.value->>'id' = p_target_token_id and m.value->'monster_snapshot' is not null
          then jsonb_set(m.value, '{monster_snapshot,dead}', 'false'::jsonb, true)
          else m.value
        end
      ),
      '[]'::jsonb
    )
    into v_monsters
    from jsonb_array_elements(v_monsters) as m(value);

    update public.combat_state
    set initiative_entries = v_entries,
        initiative_monsters = v_monsters,
        updated_by_email = v_email
    where id = 1;
    return;
  end if;

  begin
    v_target_uuid := p_target_token_id::uuid;
  exception when others then
    raise exception 'Invalid target token';
  end;

  update public.characters
  set dead = false
  where id = v_target_uuid;

  select e.ord - 1, e.entry
  into v_target_idx, v_target_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_target_token_id
     or e.entry->>'participant_id' = ('player:' || p_target_token_id)
  order by e.ord
  limit 1;

  if v_target_idx is not null then
    v_target_entry := jsonb_set(v_target_entry, '{dead}', 'false'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);

    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_resurrect_token(text) to authenticated;

create or replace function public.combat_restore_physical_token(
  p_target_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_entries jsonb;
  v_monsters jsonb;
  v_target_idx int;
  v_target_entry jsonb;
  v_target_uuid uuid;
  v_attrs jsonb;
begin
  if v_email <> 'drocasma9@gmail.com' then
    raise exception 'Only DM can restore';
  end if;
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;

  select coalesce(initiative_entries, '[]'::jsonb), coalesce(initiative_monsters, '[]'::jsonb)
  into v_entries, v_monsters
  from public.combat_state
  where id = 1
  for update;

  if p_target_token_id like 'monster:%' then
    select e.ord - 1, e.entry
    into v_target_idx, v_target_entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = p_target_token_id
    order by e.ord
    limit 1;

    if v_target_idx is not null then
      v_target_entry := jsonb_set(v_target_entry, '{prone}', 'false'::jsonb, true);
      if v_target_entry->'monster_snapshot' is not null then
        v_target_entry := jsonb_set(
          jsonb_set(
            v_target_entry,
            '{monster_snapshot,str}',
            to_jsonb(greatest(1, coalesce((v_target_entry->'monster_snapshot'->>'str')::int, 0))),
            true
          ),
          '{monster_snapshot,agl}',
          to_jsonb(greatest(1, coalesce((v_target_entry->'monster_snapshot'->>'agl')::int, 0))),
          true
        );
      end if;
      v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);
    end if;

    select coalesce(
      jsonb_agg(
        case
          when m.value->>'id' = p_target_token_id and m.value->'monster_snapshot' is not null
          then jsonb_set(
            jsonb_set(
              m.value,
              '{monster_snapshot,str}',
              to_jsonb(greatest(1, coalesce((m.value->'monster_snapshot'->>'str')::int, 0))),
              true
            ),
            '{monster_snapshot,agl}',
            to_jsonb(greatest(1, coalesce((m.value->'monster_snapshot'->>'agl')::int, 0))),
            true
          )
          else m.value
        end
      ),
      '[]'::jsonb
    )
    into v_monsters
    from jsonb_array_elements(v_monsters) as m(value);

    update public.combat_state
    set initiative_entries = v_entries,
        initiative_monsters = v_monsters,
        updated_by_email = v_email
    where id = 1;
    return;
  end if;

  begin
    v_target_uuid := p_target_token_id::uuid;
  exception when others then
    raise exception 'Invalid target token';
  end;

  select coalesce(to_jsonb(attributes), '{}'::jsonb)
  into v_attrs
  from public.characters
  where id = v_target_uuid
  limit 1;

  v_attrs := jsonb_set(v_attrs, '{STR}', to_jsonb(greatest(1, coalesce((v_attrs->>'STR')::int, 0))), true);
  v_attrs := jsonb_set(v_attrs, '{AGL}', to_jsonb(greatest(1, coalesce((v_attrs->>'AGL')::int, 0))), true);

  update public.characters
  set attributes = v_attrs
  where id = v_target_uuid;

  select e.ord - 1, e.entry
  into v_target_idx, v_target_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_target_token_id
     or e.entry->>'participant_id' = ('player:' || p_target_token_id)
  order by e.ord
  limit 1;

  if v_target_idx is not null then
    v_target_entry := jsonb_set(v_target_entry, '{prone}', 'false'::jsonb, true);
    v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);
    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_restore_physical_token(text) to authenticated;

create or replace function public.combat_restore_mental_token(
  p_target_token_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_entries jsonb;
  v_monsters jsonb;
  v_target_idx int;
  v_target_entry jsonb;
  v_target_uuid uuid;
  v_attrs jsonb;
begin
  if v_email <> 'drocasma9@gmail.com' then
    raise exception 'Only DM can restore';
  end if;
  if p_target_token_id is null or btrim(p_target_token_id) = '' then
    raise exception 'Target token is required';
  end if;

  select coalesce(initiative_entries, '[]'::jsonb), coalesce(initiative_monsters, '[]'::jsonb)
  into v_entries, v_monsters
  from public.combat_state
  where id = 1
  for update;

  if p_target_token_id like 'monster:%' then
    select e.ord - 1, e.entry
    into v_target_idx, v_target_entry
    from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
    where e.entry->>'participant_id' = p_target_token_id
    order by e.ord
    limit 1;

    if v_target_idx is not null then
      if v_target_entry->'monster_snapshot' is not null then
        v_target_entry := jsonb_set(
          jsonb_set(
            v_target_entry,
            '{monster_snapshot,wit}',
            to_jsonb(greatest(1, coalesce((v_target_entry->'monster_snapshot'->>'wit')::int, 0))),
            true
          ),
          '{monster_snapshot,emp}',
          to_jsonb(greatest(1, coalesce((v_target_entry->'monster_snapshot'->>'emp')::int, 0))),
          true
        );
      end if;
      v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);
    end if;

    select coalesce(
      jsonb_agg(
        case
          when m.value->>'id' = p_target_token_id and m.value->'monster_snapshot' is not null
          then jsonb_set(
            jsonb_set(
              m.value,
              '{monster_snapshot,wit}',
              to_jsonb(greatest(1, coalesce((m.value->'monster_snapshot'->>'wit')::int, 0))),
              true
            ),
            '{monster_snapshot,emp}',
            to_jsonb(greatest(1, coalesce((m.value->'monster_snapshot'->>'emp')::int, 0))),
            true
          )
          else m.value
        end
      ),
      '[]'::jsonb
    )
    into v_monsters
    from jsonb_array_elements(v_monsters) as m(value);

    update public.combat_state
    set initiative_entries = v_entries,
        initiative_monsters = v_monsters,
        updated_by_email = v_email
    where id = 1;
    return;
  end if;

  begin
    v_target_uuid := p_target_token_id::uuid;
  exception when others then
    raise exception 'Invalid target token';
  end;

  select coalesce(to_jsonb(attributes), '{}'::jsonb)
  into v_attrs
  from public.characters
  where id = v_target_uuid
  limit 1;

  v_attrs := jsonb_set(v_attrs, '{WIT}', to_jsonb(greatest(1, coalesce((v_attrs->>'WIT')::int, 0))), true);
  v_attrs := jsonb_set(v_attrs, '{EMP}', to_jsonb(greatest(1, coalesce((v_attrs->>'EMP')::int, 0))), true);

  update public.characters
  set attributes = v_attrs
  where id = v_target_uuid;

  select e.ord - 1, e.entry
  into v_target_idx, v_target_entry
  from jsonb_array_elements(v_entries) with ordinality as e(entry, ord)
  where e.entry->>'participant_id' = p_target_token_id
     or e.entry->>'participant_id' = ('player:' || p_target_token_id)
  order by e.ord
  limit 1;

  if v_target_idx is not null then
    v_entries := jsonb_set(v_entries, array[v_target_idx::text], v_target_entry, false);
    update public.combat_state
    set initiative_entries = v_entries,
        updated_by_email = v_email
    where id = 1;
  end if;
end;
$$;

grant execute on function public.combat_restore_mental_token(text) to authenticated;

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
