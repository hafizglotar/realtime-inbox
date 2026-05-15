-- ============================================================================
-- Demo seed: two agencies + helper to wire users to them.
-- ============================================================================
-- Run this AFTER 0001_init.sql, and AFTER you've created the two demo users
-- in the Supabase Dashboard (Authentication -> Users -> Add user, with
-- "Auto Confirm User" enabled). See README for exact emails / passwords used
-- for the deliverable.
-- ============================================================================

insert into public.agencies (slug, name) values
  ('coastal-realty', 'Coastal Realty'),
  ('mountain-homes', 'Mountain Homes')
on conflict (slug) do nothing;

-- Wire each demo auth user to its agency. Replace nothing — this resolves the
-- user by email so it's idempotent and doesn't need uuids hard-coded.
insert into public.profiles (id, agency_id, email)
select u.id, a.id, u.email
from auth.users u
join public.agencies a on a.slug = 'coastal-realty'
where u.email = 'agent.coastal@example.com'
on conflict (id) do update set agency_id = excluded.agency_id;

insert into public.profiles (id, agency_id, email)
select u.id, a.id, u.email
from auth.users u
join public.agencies a on a.slug = 'mountain-homes'
where u.email = 'agent.mountain@example.com'
on conflict (id) do update set agency_id = excluded.agency_id;

-- A couple of pre-existing contacts so each inbox isn't empty on first login.
insert into public.contacts (agency_id, name, email, message, status)
select a.id, 'Alice Buyer', 'alice@example.com',
       'Interested in the beach house listing.', 'new'
from public.agencies a where a.slug = 'coastal-realty';

insert into public.contacts (agency_id, name, email, message, status)
select a.id, 'Bob Renter', 'bob@example.com',
       'Do you have anything pet friendly?', 'contacted'
from public.agencies a where a.slug = 'mountain-homes';
