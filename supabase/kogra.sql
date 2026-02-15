-- Kogra schema + gameplay RPCs
-- Run this in Supabase SQL editor after your existing setup.

create extension if not exists "uuid-ossp";

create or replace function public.kogra_current_user_email()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '');
$$;

create or replace function public.kogra_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.kogra_games (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  status text not null default 'waiting' check (status in ('waiting', 'in_round', 'round_over', 'finished')),
  round_no int not null default 0,
  turn_no int not null default 0,
  direction text not null default 'ccw' check (direction in ('ccw')),
  current_turn_player_id uuid null,
  starter_player_id uuid null,
  previous_player_id uuid null,
  state jsonb not null default '{}'::jsonb,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kogra_players (
  id uuid primary key default uuid_generate_v4(),
  game_id uuid not null references public.kogra_games(id) on delete cascade,
  user_email text not null,
  display_name text not null,
  is_dm boolean not null default false,
  dm_slot_name text not null default '',
  is_active boolean not null default true,
  eliminated boolean not null default false,
  starting_hand_size int not null default 2 check (starting_hand_size between 2 and 5),
  loss_count int not null default 0,
  seat_index int null,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, user_email, is_dm, dm_slot_name)
);

alter table public.kogra_players add column if not exists dm_slot_name text not null default '';
update public.kogra_players
set dm_slot_name = case when is_dm then coalesce(nullif(display_name, ''), 'DM') else '' end
where dm_slot_name = '';
alter table public.kogra_players drop constraint if exists kogra_players_game_id_user_email_is_dm_key;
alter table public.kogra_players drop constraint if exists kogra_players_game_id_user_email_is_dm_dm_slot_name_key;
alter table public.kogra_players
add constraint kogra_players_game_id_user_email_is_dm_dm_slot_name_key
unique (game_id, user_email, is_dm, dm_slot_name);

create index if not exists kogra_players_game_idx on public.kogra_players(game_id);
create index if not exists kogra_players_active_idx on public.kogra_players(game_id, is_active, eliminated);

create table if not exists public.kogra_private_state (
  id uuid primary key default uuid_generate_v4(),
  game_id uuid not null references public.kogra_games(id) on delete cascade,
  player_id uuid not null references public.kogra_players(id) on delete cascade,
  user_email text not null,
  personal_cards jsonb not null default '[]'::jsonb,
  transit_cards jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, player_id)
);

create index if not exists kogra_private_state_game_idx on public.kogra_private_state(game_id);

create table if not exists public.kogra_events (
  id bigserial primary key,
  game_id uuid not null references public.kogra_games(id) on delete cascade,
  round_no int not null default 0,
  turn_no int not null default 0,
  actor_player_id uuid null references public.kogra_players(id) on delete set null,
  target_player_id uuid null references public.kogra_players(id) on delete set null,
  event_type text not null check (
    event_type in ('join', 'forfeit', 'restart', 'start', 'declare_pass', 'improve', 'call_bluff', 'round_end')
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kogra_events_game_idx on public.kogra_events(game_id, id desc);

-- Secret claims are only used by server-side RPC logic.
create table if not exists public.kogra_secret_claims (
  id bigserial primary key,
  game_id uuid not null references public.kogra_games(id) on delete cascade,
  round_no int not null,
  turn_no int not null,
  actor_player_id uuid not null references public.kogra_players(id) on delete cascade,
  cards jsonb not null,
  declared_type text not null,
  declared_rank int not null,
  declared_suit text null,
  declared_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kogra_secret_claims_game_idx on public.kogra_secret_claims(game_id, id desc);
alter table public.kogra_secret_claims add column if not exists declared_meta jsonb not null default '{}'::jsonb;

drop trigger if exists trg_kogra_games_updated_at on public.kogra_games;
create trigger trg_kogra_games_updated_at
before update on public.kogra_games
for each row execute function public.kogra_set_updated_at();

drop trigger if exists trg_kogra_players_updated_at on public.kogra_players;
create trigger trg_kogra_players_updated_at
before update on public.kogra_players
for each row execute function public.kogra_set_updated_at();

drop trigger if exists trg_kogra_private_state_updated_at on public.kogra_private_state;
create trigger trg_kogra_private_state_updated_at
before update on public.kogra_private_state
for each row execute function public.kogra_set_updated_at();

alter table public.kogra_games enable row level security;
alter table public.kogra_players enable row level security;
alter table public.kogra_private_state enable row level security;
alter table public.kogra_events enable row level security;
alter table public.kogra_secret_claims enable row level security;

drop policy if exists kogra_games_select on public.kogra_games;
create policy kogra_games_select on public.kogra_games
for select to authenticated using (true);

drop policy if exists kogra_games_insert on public.kogra_games;
create policy kogra_games_insert on public.kogra_games
for insert to authenticated with check (true);

drop policy if exists kogra_games_update on public.kogra_games;
create policy kogra_games_update on public.kogra_games
for update to authenticated using (true) with check (true);

drop policy if exists kogra_players_select on public.kogra_players;
create policy kogra_players_select on public.kogra_players
for select to authenticated using (true);

drop policy if exists kogra_players_insert on public.kogra_players;
create policy kogra_players_insert on public.kogra_players
for insert to authenticated
with check (
  (
    not is_dm
    and user_email = public.kogra_current_user_email()
  )
  or
  (
    is_dm
    and user_email = 'drocasma9@gmail.com'
    and public.kogra_current_user_email() = 'drocasma9@gmail.com'
  )
);

drop policy if exists kogra_players_update on public.kogra_players;
create policy kogra_players_update on public.kogra_players
for update to authenticated
using (user_email = public.kogra_current_user_email())
with check (user_email = public.kogra_current_user_email());

drop policy if exists kogra_players_delete on public.kogra_players;
create policy kogra_players_delete on public.kogra_players
for delete to authenticated
using (user_email = public.kogra_current_user_email());

drop policy if exists kogra_private_select on public.kogra_private_state;
create policy kogra_private_select on public.kogra_private_state
for select to authenticated using (user_email = public.kogra_current_user_email());

drop policy if exists kogra_private_insert on public.kogra_private_state;
create policy kogra_private_insert on public.kogra_private_state
for insert to authenticated with check (user_email = public.kogra_current_user_email());

drop policy if exists kogra_private_update on public.kogra_private_state;
create policy kogra_private_update on public.kogra_private_state
for update to authenticated
using (user_email = public.kogra_current_user_email())
with check (user_email = public.kogra_current_user_email());

drop policy if exists kogra_private_delete on public.kogra_private_state;
create policy kogra_private_delete on public.kogra_private_state
for delete to authenticated
using (user_email = public.kogra_current_user_email());

drop policy if exists kogra_events_select on public.kogra_events;
create policy kogra_events_select on public.kogra_events
for select to authenticated using (true);

drop policy if exists kogra_events_insert on public.kogra_events;
create policy kogra_events_insert on public.kogra_events
for insert to authenticated with check (true);

-- No policies on kogra_secret_claims on purpose.

create or replace function public.kogra_hand_type_strength(p_type text)
returns int
language sql
immutable
as $$
  select case p_type
    when 'high_card' then 1
    when 'pair' then 2
    when 'two_pair' then 3
    when 'three_kind' then 4
    when 'straight' then 5
    when 'flush' then 6
    when 'full_house' then 7
    when 'four_kind' then 8
    when 'straight_flush' then 9
    when 'royal_flush' then 10
    else 0
  end;
$$;

create or replace function public.kogra_suit_strength(p_suit text)
returns int
language sql
immutable
as $$
  select case p_suit
    when 'C' then 1
    when 'D' then 2
    when 'H' then 3
    when 'S' then 4
    else 0
  end;
$$;

create or replace function public.kogra_jsonb_int_array(p_meta jsonb, p_key text)
returns int[]
language sql
immutable
as $$
  select coalesce(array_agg((x.value)::text::int), '{}'::int[])
  from jsonb_array_elements(coalesce(p_meta -> p_key, '[]'::jsonb)) as x(value);
$$;

create or replace function public.kogra_decl_vector(
  p_type text,
  p_rank int,
  p_meta jsonb
)
returns int[]
language plpgsql
immutable
as $$
declare
  kickers int[];
begin
  if p_type = 'royal_flush' then
    return '{}'::int[];
  end if;

  if p_type = 'two_pair' then
    return array[p_rank, coalesce((p_meta->>'low_rank')::int, 0)];
  end if;

  if p_type = 'full_house' then
    return array[p_rank, coalesce((p_meta->>'pair_rank')::int, 0)];
  end if;

  if p_type = 'flush' then
    kickers := public.kogra_jsonb_int_array(p_meta, 'kickers');
    return array[p_rank] || coalesce(kickers, '{}'::int[]);
  end if;

  return array[p_rank];
end;
$$;

create or replace function public.kogra_compare_rank_vectors(
  p_new int[],
  p_old int[]
)
returns int
language plpgsql
immutable
as $$
declare
  i int;
  max_len int := greatest(coalesce(array_length(p_new, 1), 0), coalesce(array_length(p_old, 1), 0));
  nv int;
  ov int;
begin
  if max_len = 0 then
    return 0;
  end if;

  for i in 1..max_len loop
    nv := coalesce(p_new[i], 0);
    ov := coalesce(p_old[i], 0);
    if nv > ov then
      return 1;
    end if;
    if nv < ov then
      return -1;
    end if;
  end loop;
  return 0;
end;
$$;

create or replace function public.kogra_declaration_is_strictly_higher(
  p_new_type text,
  p_new_rank int,
  p_new_suit text,
  p_new_meta jsonb,
  p_old_type text,
  p_old_rank int,
  p_old_suit text,
  p_old_meta jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  new_type_score int := public.kogra_hand_type_strength(p_new_type);
  old_type_score int := public.kogra_hand_type_strength(p_old_type);
  cmp int;
  new_vec int[];
  old_vec int[];
begin
  if new_type_score > old_type_score then
    return true;
  end if;
  if new_type_score < old_type_score then
    return false;
  end if;

  if p_new_type = 'royal_flush' then
    return public.kogra_suit_strength(coalesce(p_new_suit, '')) > public.kogra_suit_strength(coalesce(p_old_suit, ''));
  end if;

  new_vec := public.kogra_decl_vector(p_new_type, p_new_rank, coalesce(p_new_meta, '{}'::jsonb));
  old_vec := public.kogra_decl_vector(p_old_type, p_old_rank, coalesce(p_old_meta, '{}'::jsonb));
  cmp := public.kogra_compare_rank_vectors(new_vec, old_vec);
  if cmp > 0 then
    return true;
  end if;
  if cmp < 0 then
    return false;
  end if;

  if p_new_type in ('flush', 'straight_flush', 'royal_flush') then
    return public.kogra_suit_strength(coalesce(p_new_suit, '')) > public.kogra_suit_strength(coalesce(p_old_suit, ''));
  end if;

  return false;
end;
$$;

create or replace function public.kogra_make_shuffled_deck()
returns jsonb
language sql
volatile
as $$
  with cards as (
    select jsonb_build_object('rank', r, 'suit', s) as card
    from unnest(array['C', 'D', 'H', 'S']) as s
    cross join generate_series(2, 14) as r
  )
  select coalesce(jsonb_agg(card), '[]'::jsonb)
  from (
    select card
    from cards
    order by random()
  ) x;
$$;

create or replace function public.kogra_array_has_straight(p_ranks int[], p_min_high int default 0)
returns boolean
language plpgsql
immutable
as $$
declare
  h int;
begin
  for h in 5..14 loop
    if h < p_min_high then
      continue;
    end if;
    if h = 5 then
      if 14 = any(p_ranks) and 2 = any(p_ranks) and 3 = any(p_ranks) and 4 = any(p_ranks) and 5 = any(p_ranks) then
        return true;
      end if;
    else
      if (h) = any(p_ranks)
         and (h - 1) = any(p_ranks)
         and (h - 2) = any(p_ranks)
         and (h - 3) = any(p_ranks)
         and (h - 4) = any(p_ranks) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

drop function if exists public.kogra_cards_match_declaration(jsonb, text, integer, text);

create or replace function public.kogra_cards_match_declaration(
  p_cards jsonb,
  p_declared_type text,
  p_declared_rank int,
  p_declared_suit text,
  p_declared_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
immutable
as $$
declare
  ranks int[];
  suited_ranks int[];
  best_pair int;
  best_three int;
  best_four int;
  pair_ranks int[];
  flush_best int;
  declared_vec int[];
  actual_vec int[];
  pair_rank int;
begin
  select coalesce(array_agg((c->>'rank')::int), '{}') into ranks
  from jsonb_array_elements(p_cards) c;

  if p_declared_type = 'high_card' then
    return exists (
      select 1
      from jsonb_array_elements(p_cards) c
      where (c->>'rank')::int >= p_declared_rank
    );
  end if;

  if p_declared_type = 'pair' then
    select max(rank_val) into best_pair
    from (
      select (c->>'rank')::int as rank_val, count(*) as cnt
      from jsonb_array_elements(p_cards) c
      group by 1
      having count(*) >= 2
    ) x;
    return coalesce(best_pair, 0) >= p_declared_rank;
  end if;

  if p_declared_type = 'two_pair' then
    select coalesce(array_agg(rank_val order by rank_val desc), '{}'::int[]) into pair_ranks
    from (
      select (c->>'rank')::int as rank_val
      from jsonb_array_elements(p_cards) c
      group by 1
      having count(*) >= 2
    ) x;
    if coalesce(array_length(pair_ranks, 1), 0) < 2 then
      return false;
    end if;
    actual_vec := array[pair_ranks[1], pair_ranks[2]];
    declared_vec := public.kogra_decl_vector('two_pair', p_declared_rank, coalesce(p_declared_meta, '{}'::jsonb));
    return public.kogra_compare_rank_vectors(actual_vec, declared_vec) >= 0;
  end if;

  if p_declared_type = 'three_kind' then
    select max(rank_val) into best_three
    from (
      select (c->>'rank')::int as rank_val
      from jsonb_array_elements(p_cards) c
      group by 1
      having count(*) >= 3
    ) x;
    return coalesce(best_three, 0) >= p_declared_rank;
  end if;

  if p_declared_type = 'straight' then
    return public.kogra_array_has_straight(ranks, p_declared_rank);
  end if;

  if p_declared_type = 'flush' then
    select coalesce(array_agg((c->>'rank')::int order by (c->>'rank')::int desc), '{}'::int[]) into actual_vec
    from (
      select c
      from jsonb_array_elements(p_cards) c
      where (p_declared_suit is null or c->>'suit' = p_declared_suit)
      order by (c->>'rank')::int desc
      limit 5
    ) q;
    if coalesce(array_length(actual_vec, 1), 0) < 5 then
      return false;
    end if;
    declared_vec := public.kogra_decl_vector('flush', p_declared_rank, coalesce(p_declared_meta, '{}'::jsonb));
    return public.kogra_compare_rank_vectors(actual_vec, declared_vec) >= 0;
  end if;

  if p_declared_type = 'full_house' then
    declared_vec := public.kogra_decl_vector('full_house', p_declared_rank, coalesce(p_declared_meta, '{}'::jsonb));
    for best_three in
      select (c->>'rank')::int as rank_val
      from jsonb_array_elements(p_cards) c
      group by 1
      having count(*) >= 3
      order by rank_val desc
    loop
      select max((c->>'rank')::int) into pair_rank
      from jsonb_array_elements(p_cards) c
      where (c->>'rank')::int <> best_three
      group by (c->>'rank')::int
      having count(*) >= 2;
      if pair_rank is not null then
        actual_vec := array[best_three, pair_rank];
        if public.kogra_compare_rank_vectors(actual_vec, declared_vec) >= 0 then
          return true;
        end if;
      end if;
    end loop;
    return false;
  end if;

  if p_declared_type = 'four_kind' then
    select max(rank_val) into best_four
    from (
      select (c->>'rank')::int as rank_val
      from jsonb_array_elements(p_cards) c
      group by 1
      having count(*) >= 4
    ) x;
    return coalesce(best_four, 0) >= p_declared_rank;
  end if;

  if p_declared_type = 'straight_flush' then
    for suited_ranks in
      select coalesce(array_agg((c->>'rank')::int), '{}')
      from jsonb_array_elements(p_cards) c
      where (p_declared_suit is null or c->>'suit' = p_declared_suit)
      group by c->>'suit'
      having count(*) >= 5
    loop
      if public.kogra_array_has_straight(suited_ranks, p_declared_rank) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if p_declared_type = 'royal_flush' then
    return exists (
      select 1
      from (
        select c->>'suit' as suit, array_agg((c->>'rank')::int) as rs
        from jsonb_array_elements(p_cards) c
        where (p_declared_suit is null or c->>'suit' = p_declared_suit)
        group by c->>'suit'
      ) x
      where 10 = any(x.rs)
        and 11 = any(x.rs)
        and 12 = any(x.rs)
        and 13 = any(x.rs)
        and 14 = any(x.rs)
    );
  end if;

  return false;
end;
$$;

create or replace function public.kogra_next_player(
  p_game_id uuid,
  p_current_player_id uuid
)
returns uuid
language plpgsql
stable
as $$
declare
  ids uuid[];
  idx int;
  total int;
begin
  select array_agg(id order by seat_index asc) into ids
  from public.kogra_players
  where game_id = p_game_id
    and is_active = true
    and eliminated = false;

  total := coalesce(array_length(ids, 1), 0);
  if total = 0 then
    return null;
  end if;

  select i into idx
  from generate_subscripts(ids, 1) as i
  where ids[i] = p_current_player_id
  limit 1;

  if idx is null then
    return ids[1];
  end if;

  if idx = total then
    return ids[1];
  end if;

  return ids[idx + 1];
end;
$$;

create or replace function public.kogra_start_round_internal(
  p_game_id uuid,
  p_forced_starter uuid default null,
  p_reshuffle boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  deck jsonb;
  drawn jsonb;
  starter uuid;
  active_count int;
begin
  if p_reshuffle then
    with shuffled as (
      select id, row_number() over (order by random()) - 1 as seat_idx
      from public.kogra_players
      where game_id = p_game_id
        and is_active = true
        and eliminated = false
    )
    update public.kogra_players kp
    set seat_index = s.seat_idx
    from shuffled s
    where kp.id = s.id;
  end if;

  select count(*) into active_count
  from public.kogra_players
  where game_id = p_game_id and is_active = true and eliminated = false;

  if active_count < 2 then
    update public.kogra_games
    set status = 'finished',
        current_turn_player_id = null,
        previous_player_id = null,
        starter_player_id = null,
        state = '{}'::jsonb
    where id = p_game_id;

    update public.kogra_private_state
    set personal_cards = '[]'::jsonb,
        transit_cards = '[]'::jsonb
    where game_id = p_game_id;

    return;
  end if;

  if p_forced_starter is not null then
    select id into starter
    from public.kogra_players
    where id = p_forced_starter
      and game_id = p_game_id
      and is_active = true
      and eliminated = false
    limit 1;
  end if;

  if starter is null then
    select id into starter
    from public.kogra_players
    where game_id = p_game_id
      and is_active = true
      and eliminated = false
    order by random()
    limit 1;
  end if;

  insert into public.kogra_private_state (game_id, player_id, user_email)
  select kp.game_id, kp.id, kp.user_email
  from public.kogra_players kp
  where kp.game_id = p_game_id
    and kp.is_active = true
    and kp.eliminated = false
  on conflict (game_id, player_id) do nothing;

  update public.kogra_private_state
  set personal_cards = '[]'::jsonb,
      transit_cards = '[]'::jsonb
  where game_id = p_game_id;

  deck := public.kogra_make_shuffled_deck();

  for p in
    select id, starting_hand_size
    from public.kogra_players
    where game_id = p_game_id
      and is_active = true
      and eliminated = false
    order by seat_index asc
  loop
    select coalesce(jsonb_agg(value), '[]'::jsonb) into drawn
    from (
      select value
      from jsonb_array_elements(deck) with ordinality t(value, ord)
      where ord <= p.starting_hand_size
      order by ord
    ) s;

    select coalesce(jsonb_agg(value), '[]'::jsonb) into deck
    from (
      select value
      from jsonb_array_elements(deck) with ordinality t(value, ord)
      where ord > p.starting_hand_size
      order by ord
    ) s;

    update public.kogra_private_state
    set personal_cards = coalesce(drawn, '[]'::jsonb),
        transit_cards = '[]'::jsonb
    where game_id = p_game_id and player_id = p.id;
  end loop;

  select coalesce(jsonb_agg(value), '[]'::jsonb) into drawn
  from (
    select value
    from jsonb_array_elements(deck) with ordinality t(value, ord)
    where ord <= 5
    order by ord
  ) s;

  update public.kogra_private_state
  set transit_cards = coalesce(drawn, '[]'::jsonb)
  where game_id = p_game_id
    and player_id = starter;

  update public.kogra_games
  set status = 'in_round',
      round_no = round_no + 1,
      turn_no = 0,
      starter_player_id = starter,
      previous_player_id = null,
      current_turn_player_id = starter,
      state = '{}'::jsonb
  where id = p_game_id;
end;
$$;

create or replace function public.kogra_join_game(
  p_game_id uuid,
  p_display_name text default null,
  p_as_dm boolean default false,
  p_dm_slot_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.kogra_current_user_email();
  v_player_id uuid;
  v_name text;
  v_slot text;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if p_as_dm and v_email <> 'drocasma9@gmail.com' then
    raise exception 'Only the DM account can join as DM';
  end if;

  v_slot := case
    when p_as_dm then coalesce(nullif(btrim(p_dm_slot_name), ''), 'DM')
    else ''
  end;

  v_name := case
    when p_as_dm then v_slot
    when p_display_name is not null and btrim(p_display_name) <> '' then p_display_name
    else split_part(v_email, '@', 1)
  end;

  insert into public.kogra_players (game_id, user_email, display_name, is_dm, dm_slot_name, is_active, eliminated, left_at)
  values (p_game_id, v_email, v_name, p_as_dm, v_slot, true, false, null)
  on conflict (game_id, user_email, is_dm, dm_slot_name)
  do update set
    display_name = excluded.display_name,
    dm_slot_name = excluded.dm_slot_name,
    is_active = true,
    eliminated = false,
    left_at = null
  returning id into v_player_id;

  insert into public.kogra_private_state (game_id, player_id, user_email)
  values (p_game_id, v_player_id, v_email)
  on conflict (game_id, player_id) do nothing;

  insert into public.kogra_events (game_id, event_type, actor_player_id, payload)
  values (p_game_id, 'join', v_player_id, jsonb_build_object('is_dm', p_as_dm));

  return v_player_id;
end;
$$;

create or replace function public.kogra_forfeit(
  p_game_id uuid,
  p_as_dm boolean default false,
  p_dm_slot_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.kogra_current_user_email();
  v_player_id uuid;
  v_next uuid;
  active_count int;
  current_turn uuid;
  v_slot text := case when p_as_dm then coalesce(nullif(btrim(p_dm_slot_name), ''), 'DM') else '' end;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  select id into v_player_id
  from public.kogra_players
  where game_id = p_game_id
    and user_email = v_email
    and is_dm = p_as_dm
    and dm_slot_name = v_slot
    and is_active = true
  limit 1;

  if v_player_id is null then
    raise exception 'No active player slot found';
  end if;

  update public.kogra_players
  set is_active = false,
      eliminated = true,
      left_at = now()
  where id = v_player_id;

  insert into public.kogra_events (game_id, event_type, actor_player_id)
  values (p_game_id, 'forfeit', v_player_id);

  select current_turn_player_id into current_turn
  from public.kogra_games
  where id = p_game_id;

  if current_turn = v_player_id then
    v_next := public.kogra_next_player(p_game_id, v_player_id);
    update public.kogra_games
    set current_turn_player_id = v_next
    where id = p_game_id;
  end if;

  select count(*) into active_count
  from public.kogra_players
  where game_id = p_game_id
    and is_active = true
    and eliminated = false;

  if active_count < 2 then
    update public.kogra_games
    set status = 'finished',
        current_turn_player_id = null,
        previous_player_id = null,
        starter_player_id = null
    where id = p_game_id;

    update public.kogra_private_state
    set personal_cards = '[]'::jsonb,
        transit_cards = '[]'::jsonb
    where game_id = p_game_id;
  end if;
end;
$$;

create or replace function public.kogra_restart_game(
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.kogra_current_user_email() = '' then
    raise exception 'Not authenticated';
  end if;

  update public.kogra_games
  set status = 'waiting',
      round_no = 0,
      turn_no = 0,
      current_turn_player_id = null,
      starter_player_id = null,
      previous_player_id = null,
      state = '{}'::jsonb
  where id = p_game_id;

  update public.kogra_players
  set is_active = false,
      eliminated = false,
      starting_hand_size = 2,
      loss_count = 0,
      seat_index = null,
      left_at = now()
  where game_id = p_game_id;

  update public.kogra_private_state
  set personal_cards = '[]'::jsonb,
      transit_cards = '[]'::jsonb
  where game_id = p_game_id;

  delete from public.kogra_secret_claims where game_id = p_game_id;

  insert into public.kogra_events (game_id, event_type, payload)
  values (
    p_game_id,
    'restart',
    jsonb_build_object('by_email', public.kogra_current_user_email())
  );
end;
$$;

create or replace function public.kogra_start_game(
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.kogra_current_user_email() = '' then
    raise exception 'Not authenticated';
  end if;

  perform public.kogra_start_round_internal(p_game_id, null, true);

  insert into public.kogra_events (game_id, event_type, round_no, payload)
  select g.id, 'start', g.round_no, '{}'::jsonb
  from public.kogra_games g
  where g.id = p_game_id;
end;
$$;

create or replace function public.kogra_declare_and_pass(
  p_game_id uuid,
  p_declared_type text,
  p_declared_rank int,
  p_declared_suit text,
  p_declared_meta jsonb,
  p_pass_cards jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.kogra_current_user_email();
  g public.kogra_games%rowtype;
  actor public.kogra_players%rowtype;
  actor_private public.kogra_private_state%rowtype;
  next_player uuid;
  combined jsonb;
  remaining jsonb;
  pass_keys text[];
  combined_keys text[];
  rem_count int;
  event_name text := 'declare_pass';
  claim_id bigint;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  if jsonb_typeof(p_pass_cards) <> 'array' or jsonb_array_length(p_pass_cards) <> 5 then
    raise exception 'Exactly 5 cards must be passed';
  end if;

  if public.kogra_hand_type_strength(p_declared_type) = 0 then
    raise exception 'Invalid declaration type';
  end if;

  if p_declared_type <> 'royal_flush' and (p_declared_rank < 2 or p_declared_rank > 14) then
    raise exception 'Declared rank must be between 2 and 14';
  end if;

  if p_declared_type = 'royal_flush' then
    p_declared_rank := 14;
  end if;

  if p_declared_type = 'two_pair' then
    if coalesce((p_declared_meta->>'low_rank')::int, 0) < 2 then
      raise exception 'Two pair must include a valid lower pair';
    end if;
    if coalesce((p_declared_meta->>'low_rank')::int, 0) >= p_declared_rank then
      raise exception 'Two pair lower rank must be lower than higher rank';
    end if;
  end if;

  if p_declared_type = 'full_house' then
    if coalesce((p_declared_meta->>'pair_rank')::int, 0) < 2 then
      raise exception 'Full house must include a valid pair rank';
    end if;
    if coalesce((p_declared_meta->>'pair_rank')::int, 0) = p_declared_rank then
      raise exception 'Full house three-of-a-kind and pair rank must differ';
    end if;
  end if;

  select * into g
  from public.kogra_games
  where id = p_game_id
  limit 1;

  if g.id is null then
    raise exception 'Game not found';
  end if;

  if g.status <> 'in_round' then
    raise exception 'Game is not currently in a round';
  end if;

  select * into actor
  from public.kogra_players
  where id = g.current_turn_player_id
  limit 1;

  if actor.id is null then
    raise exception 'No current turn player';
  end if;

  if actor.user_email <> v_email then
    raise exception 'Not your turn';
  end if;

  select * into actor_private
  from public.kogra_private_state
  where game_id = p_game_id and player_id = actor.id
  limit 1;

  if actor_private.id is null then
    raise exception 'Private state not found';
  end if;

  combined := coalesce(actor_private.personal_cards, '[]'::jsonb) || coalesce(actor_private.transit_cards, '[]'::jsonb);

  select array_agg((c->>'rank') || '-' || (c->>'suit')) into pass_keys
  from jsonb_array_elements(p_pass_cards) c;

  if (select count(distinct k) from unnest(pass_keys) k) <> 5 then
    raise exception 'Passed cards must be unique';
  end if;

  select array_agg((c->>'rank') || '-' || (c->>'suit')) into combined_keys
  from jsonb_array_elements(combined) c;

  if exists (
    select 1
    from unnest(pass_keys) k
    where not (k = any(combined_keys))
  ) then
    raise exception 'Passed cards must come from your available cards';
  end if;

  select coalesce(jsonb_agg(c), '[]'::jsonb) into remaining
  from jsonb_array_elements(combined) c
  where ((c->>'rank') || '-' || (c->>'suit')) <> all(pass_keys);

  rem_count := jsonb_array_length(remaining);
  if rem_count <> actor.starting_hand_size then
    raise exception 'You must keep exactly your personal hand size (%) cards', actor.starting_hand_size;
  end if;

  if (g.state ? 'declared_type') then
    event_name := 'improve';
    if not public.kogra_declaration_is_strictly_higher(
      p_declared_type,
      p_declared_rank,
      p_declared_suit,
      coalesce(p_declared_meta, '{}'::jsonb),
      g.state->>'declared_type',
      coalesce((g.state->>'declared_rank')::int, 2),
      g.state->>'declared_suit',
      coalesce(g.state->'declared_meta', '{}'::jsonb)
    ) then
      raise exception 'Declaration must strictly improve on previous declaration';
    end if;
  end if;

  next_player := public.kogra_next_player(p_game_id, actor.id);
  if next_player is null then
    raise exception 'No next player found';
  end if;

  update public.kogra_private_state
  set personal_cards = remaining,
      transit_cards = '[]'::jsonb
  where game_id = p_game_id and player_id = actor.id;

  update public.kogra_private_state
  set transit_cards = p_pass_cards
  where game_id = p_game_id and player_id = next_player;

  insert into public.kogra_secret_claims (
    game_id, round_no, turn_no, actor_player_id, cards, declared_type, declared_rank, declared_suit, declared_meta
  )
  values (
    p_game_id, g.round_no, g.turn_no + 1, actor.id, combined, p_declared_type, p_declared_rank, p_declared_suit, coalesce(p_declared_meta, '{}'::jsonb)
  )
  returning id into claim_id;

  update public.kogra_games
  set turn_no = g.turn_no + 1,
      previous_player_id = actor.id,
      current_turn_player_id = next_player,
      state = jsonb_build_object(
        'declared_type', p_declared_type,
        'declared_rank', p_declared_rank,
        'declared_suit', p_declared_suit,
        'declared_meta', coalesce(p_declared_meta, '{}'::jsonb),
        'declared_by_player_id', actor.id,
        'last_claim_id', claim_id
      )
  where id = p_game_id;

  insert into public.kogra_events (game_id, round_no, turn_no, actor_player_id, target_player_id, event_type, payload)
  values (
    p_game_id,
    g.round_no,
    g.turn_no + 1,
    actor.id,
    next_player,
    event_name,
    jsonb_build_object(
      'declared_type', p_declared_type,
      'declared_rank', p_declared_rank,
      'declared_suit', p_declared_suit,
      'declared_meta', coalesce(p_declared_meta, '{}'::jsonb)
    )
  );
end;
$$;

create or replace function public.kogra_call_bluff(
  p_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.kogra_current_user_email();
  g public.kogra_games%rowtype;
  caller public.kogra_players%rowtype;
  prev_player uuid;
  claim_id bigint;
  claim public.kogra_secret_claims%rowtype;
  claim_true boolean;
  winner uuid;
  loser uuid;
  loser_size int;
  revealed_transit jsonb;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  select * into g
  from public.kogra_games
  where id = p_game_id
  limit 1;

  if g.id is null then
    raise exception 'Game not found';
  end if;

  if g.status <> 'in_round' then
    raise exception 'Round is not active';
  end if;

  select * into caller
  from public.kogra_players
  where id = g.current_turn_player_id
  limit 1;

  if caller.id is null then
    raise exception 'No current turn player';
  end if;

  if caller.user_email <> v_email then
    raise exception 'Not your turn';
  end if;

  prev_player := g.previous_player_id;
  if prev_player is null then
    raise exception 'No previous declaration to challenge';
  end if;

  claim_id := coalesce((g.state->>'last_claim_id')::bigint, 0);
  if claim_id = 0 then
    raise exception 'No claim found';
  end if;

  select * into claim
  from public.kogra_secret_claims
  where id = claim_id
    and game_id = p_game_id
  limit 1;

  if claim.id is null then
    raise exception 'Claim record missing';
  end if;

  select coalesce(ps.transit_cards, '[]'::jsonb) into revealed_transit
  from public.kogra_private_state ps
  where ps.game_id = p_game_id
    and ps.player_id = caller.id
  limit 1;

  claim_true := public.kogra_cards_match_declaration(
    claim.cards,
    claim.declared_type,
    claim.declared_rank,
    claim.declared_suit,
    coalesce(claim.declared_meta, '{}'::jsonb)
  );

  if claim_true then
    winner := prev_player;
    loser := caller.id;
  else
    winner := caller.id;
    loser := prev_player;
  end if;

  select starting_hand_size into loser_size
  from public.kogra_players
  where id = loser
  limit 1;

  update public.kogra_players
  set loss_count = loss_count + 1,
      starting_hand_size = case
        when starting_hand_size >= 5 then 5
        else starting_hand_size + 1
      end,
      eliminated = case
        when starting_hand_size >= 5 then true
        else false
      end,
      is_active = case
        when starting_hand_size >= 5 then false
        else is_active
      end
  where id = loser;

  insert into public.kogra_events (
    game_id, round_no, turn_no, actor_player_id, target_player_id, event_type, payload
  )
  values (
    p_game_id,
    g.round_no,
    g.turn_no + 1,
    caller.id,
    prev_player,
    'call_bluff',
    jsonb_build_object(
      'winner_player_id', winner,
      'loser_player_id', loser,
      'bluff_was_true', (not claim_true)
    )
  );

  update public.kogra_games
  set status = 'round_over',
      current_turn_player_id = prev_player,
      previous_player_id = prev_player,
      state = jsonb_build_object(
        'winner_player_id', winner,
        'loser_player_id', loser,
        'bluff_was_true', (not claim_true),
        'challenger_player_id', caller.id,
        'challenged_player_id', prev_player,
        'last_call_result', jsonb_build_object(
          'winner_player_id', winner,
          'loser_player_id', loser,
          'bluff_was_true', (not claim_true),
          'loser_hand_size_before', loser_size
        ),
        'revealed_transit_cards', coalesce(revealed_transit, '[]'::jsonb),
        'revealed_claim_cards', coalesce(claim.cards, '[]'::jsonb)
      )
  where id = p_game_id;

  return jsonb_build_object(
    'winner_player_id', winner,
    'loser_player_id', loser,
    'bluff_was_true', (not claim_true)
  );
end;
$$;

create or replace function public.kogra_continue_after_challenge(
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.kogra_current_user_email();
  g public.kogra_games%rowtype;
  winner uuid;
  loser uuid;
  bluff_true boolean;
  remaining_count int;
  starter uuid;
  loser_seat int;
begin
  if v_email = '' then
    raise exception 'Not authenticated';
  end if;

  select * into g
  from public.kogra_games
  where id = p_game_id
  limit 1;

  if g.id is null then
    raise exception 'Game not found';
  end if;

  if g.status <> 'round_over' then
    raise exception 'No challenge to continue';
  end if;

  if coalesce(g.state->>'challenged_player_id', '') = '' then
    raise exception 'No challenged player recorded';
  end if;

  if not exists (
    select 1
    from public.kogra_players p
    where p.id = (g.state->>'challenged_player_id')::uuid
      and p.user_email = v_email
      and p.is_active = true
      and p.eliminated = false
  ) then
    raise exception 'Only the challenged player can continue';
  end if;

  winner := (g.state->'last_call_result'->>'winner_player_id')::uuid;
  loser := (g.state->'last_call_result'->>'loser_player_id')::uuid;
  bluff_true := coalesce((g.state->'last_call_result'->>'bluff_was_true')::boolean, false);

  select count(*) into remaining_count
  from public.kogra_players
  where game_id = p_game_id
    and is_active = true
    and eliminated = false;

  if remaining_count < 2 then
    update public.kogra_games
    set status = 'finished',
        previous_player_id = null,
        current_turn_player_id = null,
        starter_player_id = null,
        state = jsonb_build_object(
          'winner_player_id', winner,
          'loser_player_id', loser,
          'bluff_was_true', bluff_true
        )
    where id = p_game_id;

    update public.kogra_private_state
    set personal_cards = '[]'::jsonb,
        transit_cards = '[]'::jsonb
    where game_id = p_game_id;
  else
    if exists (
      select 1
      from public.kogra_players p
      where p.id = loser
        and p.game_id = p_game_id
        and p.is_active = true
        and p.eliminated = false
    ) then
      starter := loser;
    else
      select p.seat_index into loser_seat
      from public.kogra_players p
      where p.id = loser
      limit 1;

      select p.id into starter
      from public.kogra_players p
      where p.game_id = p_game_id
        and p.is_active = true
        and p.eliminated = false
        and coalesce(p.seat_index, 99999) > coalesce(loser_seat, -1)
      order by p.seat_index asc
      limit 1;

      if starter is null then
        select p.id into starter
        from public.kogra_players p
        where p.game_id = p_game_id
          and p.is_active = true
          and p.eliminated = false
        order by p.seat_index asc
        limit 1;
      end if;
    end if;

    perform public.kogra_start_round_internal(p_game_id, starter, false);
    update public.kogra_games
    set state = state || jsonb_build_object(
      'last_call_result',
      jsonb_build_object(
        'winner_player_id', winner,
        'loser_player_id', loser,
        'bluff_was_true', bluff_true
      )
    )
    where id = p_game_id;
  end if;

  insert into public.kogra_events (
    game_id, round_no, actor_player_id, target_player_id, event_type, payload
  )
  select g2.id, g2.round_no, winner, loser, 'round_end',
    jsonb_build_object(
      'winner_player_id', winner,
      'loser_player_id', loser,
      'bluff_was_true', bluff_true
    )
  from public.kogra_games g2
  where g2.id = p_game_id;
end;
$$;

grant execute on function public.kogra_join_game(uuid, text, boolean, text) to authenticated;
grant execute on function public.kogra_forfeit(uuid, boolean, text) to authenticated;
grant execute on function public.kogra_restart_game(uuid) to authenticated;
grant execute on function public.kogra_start_game(uuid) to authenticated;
grant execute on function public.kogra_declare_and_pass(uuid, text, int, text, jsonb, jsonb) to authenticated;
grant execute on function public.kogra_call_bluff(uuid) to authenticated;
grant execute on function public.kogra_continue_after_challenge(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kogra_games'
  ) then
    alter publication supabase_realtime add table public.kogra_games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kogra_players'
  ) then
    alter publication supabase_realtime add table public.kogra_players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kogra_private_state'
  ) then
    alter publication supabase_realtime add table public.kogra_private_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kogra_events'
  ) then
    alter publication supabase_realtime add table public.kogra_events;
  end if;
end
$$;


insert into public.kogra_games (name, status, state, created_by_email)
values ('Kogra', 'waiting', '{}'::jsonb, 'system')
on conflict (name) do nothing;
