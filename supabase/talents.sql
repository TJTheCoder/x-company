-- Talents persistence on characters
-- Run this in Supabase SQL editor after your existing setup.

alter table public.characters
add column if not exists talent_levels jsonb not null default '{"talent-fast-footwork": 1}'::jsonb;

update public.characters
set talent_levels = '{"talent-fast-footwork": 1}'::jsonb
where talent_levels is null;
