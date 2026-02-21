create table if not exists public.repo_stats_cache (
  id int primary key default 1 check (id = 1),
  lines int not null default 0,
  hours numeric(10,1) not null default 0,
  caption text not null default '0 lines across 0 hours!',
  source text null,
  commit_sha text null,
  updated_at timestamptz not null default now()
);

alter table public.repo_stats_cache enable row level security;

drop policy if exists "repo stats readable" on public.repo_stats_cache;

create policy "repo stats readable"
on public.repo_stats_cache
for select
using (true);

create or replace function public.repo_stats_best()
returns table (
  lines int,
  hours numeric,
  caption text,
  source text,
  commit_sha text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    c.lines,
    c.hours,
    c.caption,
    c.source,
    c.commit_sha,
    c.updated_at
  from public.repo_stats_cache c
  where c.id = 1;
$$;

create or replace function public.repo_stats_upsert_if_higher(
  p_lines int,
  p_hours numeric,
  p_caption text default null,
  p_source text default null,
  p_commit_sha text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.repo_stats_cache%rowtype;
  v_caption text;
begin
  if p_lines is null or p_lines < 0 then
    return false;
  end if;

  if p_hours is null or p_hours < 0 then
    return false;
  end if;

  select *
  into v_existing
  from public.repo_stats_cache
  where id = 1
  for update;

  if found then
    if p_lines < v_existing.lines then
      return false;
    end if;
    if p_lines = v_existing.lines and p_hours <= v_existing.hours then
      return false;
    end if;
  end if;

  v_caption := coalesce(p_caption, format('%s lines across %s hours!', p_lines, p_hours));

  insert into public.repo_stats_cache (id, lines, hours, caption, source, commit_sha, updated_at)
  values (1, p_lines, round(p_hours::numeric, 1), v_caption, p_source, p_commit_sha, now())
  on conflict (id) do update
    set lines = excluded.lines,
        hours = excluded.hours,
        caption = excluded.caption,
        source = excluded.source,
        commit_sha = excluded.commit_sha,
        updated_at = now();

  return true;
end;
$$;

grant execute on function public.repo_stats_best() to anon, authenticated;
grant execute on function public.repo_stats_upsert_if_higher(int, numeric, text, text, text) to anon, authenticated;
