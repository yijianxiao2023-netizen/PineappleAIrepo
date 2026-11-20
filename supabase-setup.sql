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
