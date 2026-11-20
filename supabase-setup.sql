-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It creates the tables for synced chats and memory, and makes sure each
-- person can only ever read and change their own data.

create table if not exists public.chats (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  title text not null default '',
  updated bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);

create table if not exists public.memories (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  updated bigint not null default 0
);

alter table public.chats enable row level security;
alter table public.memories enable row level security;

drop policy if exists "own chats" on public.chats;
create policy "own chats" on public.chats
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own memory" on public.memories;
create policy "own memory" on public.memories
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.chats, public.memories from anon;
grant select, insert, update, delete on public.chats, public.memories to authenticated;

-- Web search usage limits (used by the "web" Edge Function).
create table if not exists public.web_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  kind text not null,
  count int not null default 0,
  primary key (user_id, day, kind)
);

alter table public.web_usage enable row level security;
revoke all on public.web_usage from anon, authenticated;

create or replace function public.bump_web_usage(p_user uuid, p_kind text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  insert into web_usage (user_id, day, kind, count)
  values (p_user, current_date, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = web_usage.count + 1
  returning count into n;
  return n <= p_limit;
end;
$$;

revoke all on function public.bump_web_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_web_usage(uuid, text, int) to service_role;

-- Account limit: block new sign-ups once Pineapple AI has 25 accounts.
-- Existing users can always sign in. To change the limit, edit max_accounts below and run this again.
create or replace function public.enforce_account_limit()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  max_accounts constant int := 25;
begin
  perform pg_advisory_xact_lock(724001);
  if (select count(*) from auth.users) >= max_accounts then
    raise exception 'PINEAPPLE_FULL: Pineapple AI has reached its limit of % accounts.', max_accounts;
  end if;
  return new;
end;
$$;

drop trigger if exists pineapple_account_limit on auth.users;
create trigger pineapple_account_limit
  before insert on auth.users
  for each row execute function public.enforce_account_limit();
