-- Shared map board schema + policies
-- Run this in Supabase SQL editor.

create table if not exists public.map_state (
  id int primary key check (id = 1),
  strokes jsonb not null default '[]'::jsonb,
  labels jsonb not null default '[]'::jsonb,
  updated_by_email text null,
  updated_at timestamptz not null default now()
);

create or replace function public.map_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_map_state_updated_at on public.map_state;
create trigger trg_map_state_updated_at
before update on public.map_state
for each row execute function public.map_set_updated_at();

alter table public.map_state enable row level security;

drop policy if exists map_state_select on public.map_state;
create policy map_state_select on public.map_state
for select to authenticated
using (true);

drop policy if exists map_state_insert_dm on public.map_state;
create policy map_state_insert_dm on public.map_state
for insert to authenticated
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

drop policy if exists map_state_update_dm on public.map_state;
create policy map_state_update_dm on public.map_state
for update to authenticated
using (auth.jwt() ->> 'email' = 'drocasma9@gmail.com')
with check (auth.jwt() ->> 'email' = 'drocasma9@gmail.com');

insert into public.map_state (id, strokes, labels, updated_by_email)
values (1, '[]'::jsonb, '[]'::jsonb, null)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'map_state'
  ) then
    alter publication supabase_realtime add table public.map_state;
  end if;
end;
$$;
