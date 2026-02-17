-- Equipment slots persistence on characters
-- Run this in Supabase SQL editor after your existing setup.

alter table public.characters
add column if not exists equipment_slots jsonb not null default
  '{"armor": null, "helmet": null, "left": null, "right": null}'::jsonb;

update public.characters
set equipment_slots = '{"armor": null, "helmet": null, "left": null, "right": null}'::jsonb
where equipment_slots is null;
