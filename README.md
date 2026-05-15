# Realtime Inbox

A mini multi-tenant inbox for a real estate agency. Public visitors leave a
message at `/c/:agencySlug`; agents see those messages appear live in
`/inbox` after signing in.

Stack: Vite + React + React Router + Tailwind, Supabase (Postgres + Auth +
Realtime). Started from `npm create vite@latest -- --template react`, then
trimmed and rewired by hand.

## Demo

- **App:** _<paste your Cloudflare Pages URL here after deploy>_
- **Coastal Realty form:** `/c/coastal-realty`
- **Mountain Homes form:** `/c/mountain-homes`
- **Agent sign in:** `/login`

Demo accounts (different agencies — sign in to one, then the other, to verify
isolation):

| Agency         | Email                          | Password    |
| -------------- | ------------------------------ | ----------- |
| Coastal Realty | `agent.coastal@example.com`    | `Coastal!1` |
| Mountain Homes | `agent.mountain@example.com`   | `Mountain!1`|

## Run locally

```bash
git clone <this-repo>
cd realtime-inbox
npm install
cp .env.example .env
# fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

### Supabase setup (one-time)

1. Create a project at <https://supabase.com>.
2. In **Project Settings → API**, copy the **Project URL** and the **anon
   public** key into `.env`.
3. Open the **SQL Editor** and run `supabase/migrations/0001_init.sql`. This
   creates tables, grants, RLS policies, and adds `contacts` to the realtime
   publication.
4. Create the two demo users in **Authentication → Users → Add user**, with
   *Auto Confirm User* checked:
   - `agent.coastal@example.com` / `Coastal!1`
   - `agent.mountain@example.com` / `Mountain!1`
5. Run `supabase/migrations/0002_seed_demo.sql`. It inserts the two agencies
   and links each demo user to the right one via `public.profiles`.

That's it. `npm run dev` and visit `/c/coastal-realty` to drop a message,
then sign in at `/login` to watch it land.

## How RLS is set up — and why

Two audiences hit `public.contacts`:

- **Anonymous form visitor.** Has no JWT, runs as the `anon` Postgres role.
  Should be able to *insert one row* tied to a real agency, and nothing else.
  Cannot see anyone else's messages, cannot see their own after submitting,
  cannot pick the `status`.
- **Authenticated agent.** Has a JWT, runs as `authenticated`. Should be able
  to *read and update* only their own agency's contacts. Should not be able
  to rename a contact or change its email — only the workflow status.

I enforced this with two layers:

**Layer 1 — column-level GRANTs.** Supabase auto-grants
`SELECT/INSERT/UPDATE/DELETE` on `public.*` to `anon` and `authenticated`. I
revoke that and re-grant only what each role needs:

```sql
grant insert (agency_id, name, email, message) on public.contacts to anon, authenticated;
grant select on public.contacts to authenticated;
grant update (status) on public.contacts to authenticated;
```

So even if I write a sloppy RLS policy later, an anonymous user *physically
cannot* set `status`, and an agent *physically cannot* edit a contact's
`name`/`email`/`message`.

**Layer 2 — RLS policies.** Insert is allowed for either role as long as the
target `agency_id` actually exists. Select and update for `authenticated`
are scoped to the agent's own agency via a subquery against
`public.profiles`:

```sql
agency_id = (select p.agency_id from public.profiles p where p.id = auth.uid())
```

`auth.uid()` returns the JWT's user id; the subquery resolves their agency.
Tenant isolation is therefore proved by the database, not by a `WHERE`
clause in the React code (the React code never even mentions `agency_id` on
the inbox query).

There's no `DELETE` policy for either role. Anything destructive runs as the
service role from a server-side script. The two columns I do want to keep
under closer guard (`name`, `email`, `message` on update) are blocked by the
column grant, not the policy — that's intentional, since column-grants can't
be accidentally widened by adding another permissive `FOR UPDATE` policy
elsewhere.

## How the inbox avoids duplicates from realtime + initial fetch

Classic race: if you `select()` first and then `subscribe()`, any row
inserted between the two arrives nowhere. If you subscribe first and then
fetch, the same row may appear in *both* the channel callback and the fetch
result.

Approach used here (`src/pages/Inbox.jsx`):

1. **Subscribe first.** The realtime channel is created and `.subscribe()`
   is called. Any `INSERT`/`UPDATE` from this point onward gets handed to
   the same handler.
2. **Fetch only after `SUBSCRIBED`.** The initial `.select()` runs inside
   the subscription's status callback. By the time it fires, the channel is
   live, so we won't drop anything.
3. **Merge into a `Map<id, row>`.** Both sources call `setRowsById` which
   does `next.set(row.id, row)`. The id is the dedup key — if realtime
   already inserted the row, the fetch's `if (!next.has(id))` skips it; if
   the fetch ran first, a later realtime `INSERT` for the same id is a
   harmless overwrite with the same data.
4. **Sort at render.** `useMemo` turns the Map into a date-desc array.
   Adding sort there (instead of in state) avoids re-sorting on every event.

For `UPDATE` events I overwrite unconditionally — Postgres CDC ships the
full new row, so even if the fetch hadn't loaded that id yet, the update
populates it. `DELETE` removes by `payload.old.id`, but I left no DELETE
policy in place so this branch is dead today; it's there for the day someone
adds one.

## What I left out and why

- **No agent self-signup or agency creation flow.** The take-home is about
  the inbox, not onboarding. Profiles are seeded by SQL.
- **No password reset / email confirmation UI.** Supabase ships these; not
  the point of the exercise.
- **No pagination.** A real inbox would cursor on `(created_at, id)` once
  it has thousands of rows. For a demo with a handful, fetching them all
  keeps the realtime merge logic simple.
- **No optimistic UI for the public form.** The agent inbox does optimistic
  status updates with rollback; the form just shows a confirmation. Avoids
  surfacing a "sent!" message that might not have actually persisted.
- **No tests.** Skipped for time. The bits I'd unit-test first are the
  Map-based dedup reducer and the RLS policies (with `pg_tap` or a small
  `psql` script that switches roles).
- **No rate limiting on the public form.** Real production needs Captcha or
  per-IP throttling; that would live in an Edge Function in front of the
  insert.
- **No column to track which agent moved a status.** Out of scope, but the
  natural extension is `last_updated_by uuid references auth.users(id)`
  set by trigger.

## Where AI helped, and where it tripped me up

Helped:

- Drafting the RLS policies — I knew the shape I wanted (column grants +
  per-role policies + subquery for tenant scope) and the AI translated that
  into clean SQL faster than I would by hand.
- The subscribe-first / fetch-second / merge-by-Map pattern. Wrote it once,
  let the AI restate it as a comment so the intent is in the file, not just
  in my head.

Tripped me up:

- First pass had the `contacts_agent_update` policy with `using` only and
  no `with check`. That would let an agent change a row's `agency_id`,
  smuggling a contact into another tenant. Added `with check` on the same
  predicate. (The column grant on `update (status)` would also block this
  in practice — defense in depth.)
- AI suggested `select(...).single()` for the agency lookup. `.single()`
  errors if zero rows match, which is exactly the "unknown slug" case I want
  to render gracefully. Switched to `.maybeSingle()`.
- It also suggested doing the initial fetch before subscribing — the more
  obvious order, and the one with the duplicate/loss problem above. Caught
  during review.

## Project structure

```
realtime-inbox/
├── supabase/migrations/
│   ├── 0001_init.sql         # schema, grants, RLS, realtime publication
│   └── 0002_seed_demo.sql    # 2 agencies + profile wiring + sample contacts
├── src/
│   ├── lib/supabase.js       # single client instance
│   ├── auth/
│   │   ├── AuthContext.jsx   # session state via onAuthStateChange
│   │   └── ProtectedRoute.jsx
│   └── pages/
│       ├── ContactForm.jsx   # /c/:agencySlug, anonymous insert
│       ├── Login.jsx         # email + password
│       ├── Inbox.jsx         # /inbox, realtime + dedup
│       └── NotFound.jsx
├── public/_redirects         # SPA fallback for Cloudflare Pages
├── .env.example
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
└── package.json
```

## Deploying to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to
   Git**. Point at the repo.
3. Build command: `npm run build` · Build output directory: `dist`.
4. **Settings → Environment variables**: add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` for the Production environment.
5. Deploy. The `public/_redirects` file makes React Router's client-side
   routes work (otherwise `/inbox` and `/c/...` would 404 on hard refresh).
6. In Supabase **Authentication → URL Configuration**, add your Pages URL to
   *Site URL* and *Redirect URLs*.
