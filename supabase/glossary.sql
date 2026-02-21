-- Glossary schema + storage policies
-- Run this in Supabase SQL editor after your existing setup.

create extension if not exists pgcrypto;

create table if not exists public.glossary_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  images jsonb not null default '[]'::jsonb,
  is_locked boolean not null default false,
  created_by_email text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.glossary_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_glossary_entries_updated_at on public.glossary_entries;
create trigger trg_glossary_entries_updated_at
before update on public.glossary_entries
for each row execute function public.glossary_set_updated_at();

alter table public.glossary_entries enable row level security;

drop policy if exists glossary_entries_select on public.glossary_entries;
create policy glossary_entries_select on public.glossary_entries
for select to authenticated
using (true);

drop policy if exists glossary_entries_insert on public.glossary_entries;
create policy glossary_entries_insert on public.glossary_entries
for insert to authenticated
with check (
  coalesce(created_by_email, auth.jwt() ->> 'email') = auth.jwt() ->> 'email'
);

drop policy if exists glossary_entries_update on public.glossary_entries;
create policy glossary_entries_update on public.glossary_entries
for update to authenticated
using (
  auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
  or is_locked = false
)
with check (
  auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
  or is_locked = false
);

drop policy if exists glossary_entries_delete on public.glossary_entries;
create policy glossary_entries_delete on public.glossary_entries
for delete to authenticated
using (
  auth.jwt() ->> 'email' = 'drocasma9@gmail.com'
  or is_locked = false
);

insert into storage.buckets (id, name, public)
values ('glossary-assets', 'glossary-assets', true)
on conflict (id) do nothing;

drop policy if exists glossary_assets_public_read on storage.objects;
create policy glossary_assets_public_read on storage.objects
for select to authenticated
using (bucket_id = 'glossary-assets');

drop policy if exists glossary_assets_authenticated_insert on storage.objects;
create policy glossary_assets_authenticated_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'glossary-assets');

drop policy if exists glossary_assets_authenticated_update on storage.objects;
create policy glossary_assets_authenticated_update on storage.objects
for update to authenticated
using (bucket_id = 'glossary-assets')
with check (bucket_id = 'glossary-assets');

drop policy if exists glossary_assets_authenticated_delete on storage.objects;
create policy glossary_assets_authenticated_delete on storage.objects
for delete to authenticated
using (bucket_id = 'glossary-assets');
