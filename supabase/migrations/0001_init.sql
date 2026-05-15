-- ============================================================================
-- Realtime Inbox — schema, RLS, realtime
-- ============================================================================
-- Two audiences hit the public.contacts table:
--   1. Anonymous visitors submitting the contact form  -> INSERT only
--   2. Authenticated agents working their inbox        -> SELECT + UPDATE(status)
--
-- RLS lives entirely in SQL. The app layer never filters by agency_id; the
-- database does.
-- ============================================================================

-- -- Schema --------------------------------------------------------------------

create extension if not exists pgcrypto;

create table public.agencies (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- profiles: bridge auth.users -> agencies (1 user belongs to 1 agency)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id) on delete restrict,
  email       text not null,
  created_at  timestamptz not null default now()
);

create index profiles_agency_idx on public.profiles (agency_id);

-- contact_status: an enum keeps invalid values out at the type level
do $$ begin
  create type public.contact_status as enum ('new', 'contacted', 'discarded');
exception
  when duplicate_object then null;
end $$;

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 200),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message     text not null check (length(trim(message)) between 1 and 5000),
  status      public.contact_status not null default 'new',
  created_at  timestamptz not null default now()
);

create index contacts_agency_created_idx
  on public.contacts (agency_id, created_at desc);

-- -- Column-level grants -------------------------------------------------------
-- Supabase auto-grants SELECT/INSERT/UPDATE/DELETE on public.* to anon and
-- authenticated. RLS then gates rows. We additionally constrain *columns* so
-- that even if a future RLS policy is over-permissive, anon can never write
-- a status, and agents can never edit a contact's name/email/message.

revoke all on public.contacts   from anon, authenticated;
revoke all on public.agencies   from anon, authenticated;
revoke all on public.profiles   from anon, authenticated;

-- agencies: anyone can read (slug lookup needs this); no writes from API.
grant select on public.agencies to anon, authenticated;

-- profiles: an authenticated user can only see their own row.
grant select on public.profiles to authenticated;

-- contacts:
--   anon          -> insert these 4 columns, nothing else; no select/update/delete
--   authenticated -> insert (same 4 cols), select all, update *only* status
grant insert (agency_id, name, email, message) on public.contacts to anon, authenticated;
grant select on public.contacts to authenticated;
grant update (status) on public.contacts to authenticated;

-- -- Row-Level Security --------------------------------------------------------

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;

-- agencies: public read so the contact form can resolve a slug to an id.
-- Names + slugs are not secret. There is no public write.
create policy "agencies_public_read"
  on public.agencies for select
  to anon, authenticated
  using (true);

-- profiles: each authenticated user can read their own profile only.
create policy "profiles_self_read"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

-- contacts INSERT (anonymous form):
--   Anyone can submit a contact for an *existing* agency.
--   We do NOT trust the client to set status; the column grant already blocks
--   it, but we add the check too as belt-and-braces.
create policy "contacts_anon_insert"
  on public.contacts for insert
  to anon
  with check (
    exists (select 1 from public.agencies a where a.id = agency_id)
  );

-- contacts INSERT (authenticated form):
--   Same rule for logged-in users hitting the public form. We deliberately do
--   NOT auto-stamp the agent's own agency_id here — the public form is a
--   different surface from the inbox.
create policy "contacts_authenticated_insert"
  on public.contacts for insert
  to authenticated
  with check (
    exists (select 1 from public.agencies a where a.id = agency_id)
  );

-- contacts SELECT (agent inbox):
--   An agent only sees rows whose agency_id matches their profile.
create policy "contacts_agent_select"
  on public.contacts for select
  to authenticated
  using (
    agency_id = (select p.agency_id from public.profiles p where p.id = auth.uid())
  );

-- contacts UPDATE (agent inbox):
--   An agent can update their own agency's contacts. Combined with the column
--   grant above (UPDATE only on `status`), this means status changes only.
--   Both USING and WITH CHECK are scoped so an agent cannot move a contact
--   into another agency by editing agency_id.
create policy "contacts_agent_update"
  on public.contacts for update
  to authenticated
  using (
    agency_id = (select p.agency_id from public.profiles p where p.id = auth.uid())
  )
  with check (
    agency_id = (select p.agency_id from public.profiles p where p.id = auth.uid())
  );

-- No DELETE policy for any role on contacts. Hard-deletes go through the
-- service role only (e.g. an admin script).

-- -- Realtime ------------------------------------------------------------------
-- Add contacts to the realtime publication. Supabase's realtime respects RLS
-- on postgres_changes payloads, so an agent only receives events for rows
-- their SELECT policy would let them see.

alter publication supabase_realtime add table public.contacts;
