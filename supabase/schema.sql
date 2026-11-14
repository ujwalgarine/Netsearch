-- NetPrep database schema (Supabase / Postgres).
-- Paste the whole file into Supabase: SQL Editor -> New query -> Run. Safe to run more than once.
--
-- Users and sessions live in Supabase Auth (auth.users / auth.sessions); every table here
-- points at auth.users with ON DELETE CASCADE, so deleting a user deletes all of their data.
-- Row level security limits every row to its owner (user_id = auth.uid()). The server also
-- filters every query by user_id.

-- An earlier draft of this file defined a one-row-per-user "maps" table. Replace it if present.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'maps')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maps' and column_name = 'version') then
    drop table public.maps;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'Untitled map',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists conversations_user_updated on public.conversations (user_id, updated_at desc);

create table if not exists public.messages (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  created_at       timestamptz not null default now()
);
create index if not exists messages_conversation on public.messages (conversation_id, id);

-- One row per planner turn; manual edits and people results update the latest version.
create table if not exists public.maps (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  version          integer not null,
  goal             text not null default '',
  data_json        jsonb not null,
  created_at       timestamptz not null default now(),
  unique (conversation_id, version)
);

create table if not exists public.connections (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  conversation_id      uuid not null references public.conversations(id) on delete cascade,
  person_key           text not null,          -- stable id of the person on the map (their profile URL)
  name                 text not null default '',
  profile_url          text,
  branch_label         text not null default '',
  title                text not null default '',
  organization         text not null default '',
  why                  text not null default '',
  talking_points_json  jsonb not null default '[]',
  search_query         text not null default '',
  status               text not null default 'suggested'
                       check (status in ('suggested', 'saved', 'contacted', 'replied', 'meeting_set', 'met')),
  notes                text,
  follow_up_on         date,
  status_updated_at    timestamptz,
  created_at           timestamptz not null default now(),
  unique (conversation_id, person_key)
);
create index if not exists connections_user_status on public.connections (user_id, status);

create table if not exists public.practice_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  connection_id  uuid references public.connections(id) on delete set null,
  scenario_json  jsonb not null default '{}',
  status         text not null default 'active',
  score          integer,
  feedback_json  jsonb,
  created_at     timestamptz not null default now(),
  ended_at       timestamptz
);

create table if not exists public.practice_messages (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references auth.users(id) on delete cascade,
  practice_session_id  uuid not null references public.practice_sessions(id) on delete cascade,
  role                 text not null,
  content              text not null,
  created_at           timestamptz not null default now()
);

create table if not exists public.tips_cache (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  input_hash  text not null,
  tips_json   jsonb not null,
  created_at  timestamptz not null default now()
);

-- Append-only analytics log: signup, map_created, connection_status_changed, practice_started, practice_completed.
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,
  ref_id      text,
  created_at  timestamptz not null default now()
);
create index if not exists events_user_type on public.events (user_id, type, created_at);

-- ---------------------------------------------------------------------------
-- Row level security: each user sees and changes only their own rows.
-- Child rows must also belong to a parent the user owns.
-- ---------------------------------------------------------------------------

alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.maps              enable row level security;
alter table public.connections       enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_messages enable row level security;
alter table public.tips_cache        enable row level security;
alter table public.events            enable row level security;

create or replace function public.owns_conversation(cid uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.conversations c where c.id = cid and c.user_id = auth.uid());
$$;

create or replace function public.owns_practice_session(sid uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.practice_sessions s where s.id = sid and s.user_id = auth.uid());
$$;

do $$
declare t text;
begin
  foreach t in array array['conversations', 'messages', 'maps', 'connections', 'practice_sessions', 'practice_messages', 'tips_cache', 'events'] loop
    execute format('drop policy if exists "own rows: read" on public.%I', t);
    execute format('drop policy if exists "own rows: insert" on public.%I', t);
    execute format('drop policy if exists "own rows: update" on public.%I', t);
    execute format('drop policy if exists "own rows: delete" on public.%I', t);
    execute format('create policy "own rows: read" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Inserts and updates: owner only, and the parent must be the owner's too.
create policy "own rows: insert" on public.conversations for insert to authenticated with check (user_id = auth.uid());
create policy "own rows: update" on public.conversations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own rows: insert" on public.messages for insert to authenticated with check (user_id = auth.uid() and public.owns_conversation(conversation_id));
create policy "own rows: update" on public.messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_conversation(conversation_id));

create policy "own rows: insert" on public.maps for insert to authenticated with check (user_id = auth.uid() and public.owns_conversation(conversation_id));
create policy "own rows: update" on public.maps for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_conversation(conversation_id));

create policy "own rows: insert" on public.connections for insert to authenticated with check (user_id = auth.uid() and public.owns_conversation(conversation_id));
create policy "own rows: update" on public.connections for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_conversation(conversation_id));

create policy "own rows: insert" on public.practice_sessions for insert to authenticated with check (user_id = auth.uid());
create policy "own rows: update" on public.practice_sessions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own rows: insert" on public.practice_messages for insert to authenticated with check (user_id = auth.uid() and public.owns_practice_session(practice_session_id));
create policy "own rows: update" on public.practice_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.owns_practice_session(practice_session_id));

create policy "own rows: insert" on public.tips_cache for insert to authenticated with check (user_id = auth.uid());
create policy "own rows: update" on public.tips_cache for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events are append-only: no update policy.
create policy "own rows: insert" on public.events for insert to authenticated with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Account deletion: a signed-in user can delete themselves (and, by cascade, all their data)
-- without the server ever holding a secret key.
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
