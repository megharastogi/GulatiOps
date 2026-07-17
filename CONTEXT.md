# GulatiOps - Project Context Handoff

## What this project is

A personal "chief of staff" agent for the Gulati household. School emails get
forwarded to a dedicated address, parsed by Claude into structured data
(school events, action items), and made queryable via an MCP server connected
to a dedicated chat on claude.ai. Also manages Google Calendar with conflict
checks and trip planning.

As of 2026-07-17, there's also a proactive **dashboard PWA** (`app/dashboard`)
so Megha doesn't have to remember to ask the chat for status — home screen on
iOS, magic-link sign-in, tabs for upcoming/todo/groceries/trips. Chat (via
MCP) remains the interface for actions and conversational planning; the
dashboard is for glanceable status. See "Dashboard PWA" section below.

## Owner

Megha Gulati - solo developer-founder in Seattle. Builds with React Native,
Next.js, Supabase, Claude API, Vercel. This is one of her side projects.

## Architecture

```
School Email Sender
       |
       v
Megha's real Gmail (filter forwards school emails)
       |
       v
chief@gulatiops.org  (Cloudflare Email Routing)
       |
       v
Cloudflare Email Worker  (parses MIME, POSTs JSON)
       |
       v
Vercel: /api/inbound-email (app/api/inbound-email/route.ts)
       |
       +--> Supabase: inbound_emails (raw)
       +--> Anthropic API (Claude Opus 4.5 parser)
       +--> Supabase: school_calendar, action_items
       +--> Resend (per-email summary to Megha's inbox)

Conversational interaction:
       Megha on claude.ai (GulatiOps project)
              |
              v (MCP over HTTPS)
       Vercel: /api/mcp (app/api/mcp/route.ts)
              |
              +--> Supabase queries/mutations
              +--> Google Calendar API (freeBusy + events)

Proactive/glanceable interaction:
       Megha's iPhone home screen (installed PWA)
              |
              v
       Vercel: /dashboard/* (Next.js App Router, Supabase Auth magic link)
              |
              +--> Supabase queries/mutations (same tables as MCP tools)
```

The whole app is now a single Next.js project deployed to Vercel — the
`/api/*` endpoints above are Next.js Route Handlers (`app/api/*/route.ts`),
not standalone `@vercel/node` functions anymore (migrated 2026-07-17 so they
deploy unambiguously alongside the dashboard frontend).

## Current setup state

### Done
- Domain registered: `gulatiops.org` at Cloudflare
- Cloudflare Email Routing enabled, MX records active
- Custom address `chief@gulatiops.org` verified, currently forwards directly
  to Megha's Gmail (test email succeeded)
- Supabase project created, full `schema.sql` applied
- Vercel project created and deployed at `gulati-ops.vercel.app`
- GitHub repo: `megharastogi/GulatiOps`
- Google Cloud project `GulatiOps` created, OAuth consent screen configured
  (External, in Testing mode), Calendar API enabled
- Google OAuth credentials created with redirect URI
  `https://gulati-ops.vercel.app/api/google-callback`
- Anthropic API key obtained
- All Vercel env vars set EXCEPT possibly Resend (skipped for now)
- `vercel.json` was removed because it broke the build; Vercel auto-detects
  the project now (Next.js framework preset as of 2026-07-17)

### In progress
- Running `npm run seed` to insert household + members into Supabase
- Last error: `.env` file not being loaded by the seed script
- Fix applied to `package.json`:
  `"seed": "node --env-file=.env --import tsx ./scripts/seed.ts"`

### Not yet done
1. Successfully run seed script (next immediate step)
2. Visit `/api/google-oauth` to connect Calendar (writes refresh token to
   `google_oauth_tokens` table)
3. Deploy Cloudflare Email Worker, switch Email Routing rule from
   "forward to Gmail" to "send to Worker"
4. Set up Gmail filter to auto-forward school emails to `chief@gulatiops.org`
5. Add Resend API key, verify the `gulatiops.org` domain in Resend so
   per-email summaries can send
6. Connect MCP to claude.ai as custom connector, create "GulatiOps" project
7. End-to-end test with a real forwarded school email

## File structure

```
GulatiOps/
├── README.md                       (setup instructions)
├── package.json                    (deps + scripts)
├── next.config.mjs
├── tsconfig.json
├── middleware.ts                    (Supabase Auth session refresh + /dashboard gate)
├── .gitignore
├── .env.example
├── .env                            (local only, not in git)
├── schema.sql                       (full DB schema, already applied)
├── app/
│   ├── layout.tsx / globals.css     (root layout, PWA meta tags)
│   ├── page.tsx                     (redirects to /dashboard)
│   ├── login/                       (magic-link sign-in form + server action)
│   ├── auth/callback/route.ts       (exchanges Supabase magic-link code for a session)
│   ├── dashboard/
│   │   ├── layout.tsx               (tab nav: Home/Todo/Groceries/Trips, sign out)
│   │   ├── page.tsx                 (home: upcoming events + open action items)
│   │   ├── todo/                    (action items list, add, mark done)
│   │   ├── groceries/               (grocery_pending list, add/remove/clear)
│   │   └── trips/                   (trip list + [id] itinerary view)
│   └── api/                         (Route Handlers — same URLs as before the migration)
│       ├── inbound-email/route.ts   (Cloudflare Worker POSTs here)
│       ├── mcp/route.ts             (MCP server for claude.ai)
│       ├── google-oauth/route.ts    (kicks off OAuth)
│       └── google-callback/route.ts (stores tokens)
├── lib/
│   ├── google-calendar.ts           (token refresh + freeBusy + createEvent)
│   ├── household.ts                 (shared single-household resolver)
│   └── supabase/
│       ├── browser.ts                (anon-key client for the login form)
│       ├── server.ts                 (anon-key client for Server Components/Actions)
│       ├── admin.ts                  (service-role client for dashboard data queries)
│       └── middleware.ts             (session refresh helper used by middleware.ts)
├── public/
│   └── manifest.webmanifest         (PWA manifest — icon PNGs not yet added, see below)
├── emails/
│   └── cloudflare-email-worker.js  (paste into CF Workers editor)
└── scripts/
    └── seed.ts                     (inserts household + members)
```

## Database schema summary

Key tables in Supabase (full DDL in `supabase/schema.sql`):

- `households` - one row per household (Megha's family)
- `household_members` - parents, kids, with optional emails for invites
- `inbound_emails` - raw email + parsed metadata + classification
- `school_calendar` - days off, early pickup, spirit days, events
- `action_items` - volunteer signups, forms, RSVPs, with due dates
- `google_oauth_tokens` - access + refresh tokens per household
- `grocery_items`, `grocery_pending` - schema ready, not wired yet
- `notifications_sent` - audit log

## MCP tools exposed

Defined in `app/api/mcp/route.ts` (21 tools):

- `list_action_items` - filter by status/due date
- `list_school_events` - date range, event types
- `weekly_digest` - combined view: 2 weeks of events + open actions + recent emails
- `recent_emails` - filter by classification
- `add_action_item`, `mark_action_done`
- `add_grocery_item`, `list_grocery_pending`, `clear_grocery_list`, `remove_grocery_item`
- `check_calendar_busy` - Google freeBusy check
- `create_calendar_event` - creates event, only invites when explicitly passed
- `list_calendar_events`, `delete_calendar_event`
- `list_household_members`
- `create_trip`, `save_trip_day_activities`, `get_trip_itinerary`,
  `update_trip_activity`, `list_trips`, `delete_trip` - trip planning (see
  memory `project-trip-planning-spec` for the full spec)

## Env vars (Vercel)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL       (same value as SUPABASE_URL, exposed to browser — dashboard login)
NEXT_PUBLIC_SUPABASE_ANON_KEY  (Supabase Project Settings -> API -> "anon public" key, NOT service role)
ANTHROPIC_API_KEY
RESEND_API_KEY                 (not yet)
PRIMARY_DIGEST_EMAIL           (Megha's real Gmail — also the only email allowed to request a dashboard magic link)
INBOUND_SHARED_SECRET          (openssl rand -hex 32, also goes to CF Worker)
MCP_SHARED_SECRET              (openssl rand -hex 32, also goes to claude.ai connector header)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://gulati-ops.vercel.app/api/google-callback
```

`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` are new as of the
dashboard PWA (2026-07-17) and still need to be added in Vercel — see
"Dashboard PWA" section below.

## Key design decisions made along the way

1. **Email intake via webhook, not Gmail API polling.** Cleaner, lower cost,
   doesn't require granting Gmail API access. Trade-off was buying a cheap
   domain ($10/yr at Cloudflare for `.org`).

2. **Email parser classifies as action_required / informational / noise.**
   Only the first two get per-email summary sent. Megha can override via MCP
   chat ("show me everything from this week including noise").

3. **No Sunday cron yet — pull-based digest.** Megha asks "what's coming up
   this week" in the GulatiOps project chat and Claude calls `weekly_digest`.
   Can add cron + Resend Sunday-morning email later if she wants push.

4. **No auto-sync of school events to Google Calendar.** They live in
   `school_calendar` table, queryable via MCP, but don't clutter the actual
   Google Calendar unless Megha explicitly asks. Possible future tool:
   `sync_school_event_to_calendar`.

5. **Calendar invites require explicit opt-in.** Project instructions on
   claude.ai will tell Claude to only pass `invite_emails` when Megha says
   "invite my husband" etc. No hard code-level enforcement (could add later).

6. **Whole Foods grocery automation deferred.** Schema has `grocery_pending`
   ready but no browser automation built. Plan is to just maintain the list
   in Supabase and use Claude in Chrome to add items when ordering.

## Immediate next task

Run the seed script successfully. Current command after fix:

```bash
npm run seed
```

Expected output:
```
Created household: <uuid>
Added member: Megha
Added member: <husband>
Added member: <kid1>
Added member: <kid2>
```

If `.env` is correct and the fix is in `package.json`, this should work. If
not, troubleshoot the env file loading.

After seed succeeds:

1. Visit `https://gulati-ops.vercel.app/api/google-oauth` in browser, approve
   calendar access. Confirm `google_oauth_tokens` table has a row.

2. Set up Cloudflare Email Worker:
   - Cloudflare → Workers & Pages → Create Worker
   - Paste `emails/cloudflare-email-worker.js`
   - Add `postal-mime` npm dependency
   - Set env vars: `VERCEL_INBOUND_URL`, `INBOUND_SHARED_SECRET`
   - Enable Email trigger
   - Email Routing → change `chief@gulatiops.org` rule from "send to email" to
     "send to Worker" (pointing at this Worker)

3. Set up Resend:
   - Sign up at resend.com
   - Add `gulatiops.org` as a sending domain
   - Add the DNS records Resend gives you (TXT + CNAME, easy via Cloudflare)
   - Verify domain
   - Create API key, set as `RESEND_API_KEY` in Vercel
   - Redeploy

4. Gmail forwarding filter:
   - Gmail Settings → Forwarding → add `chief@gulatiops.org` as forwarding
     address, verify
   - Create filter: `from:(@yourschool.org OR schoolmessenger.com OR ptboard.com)`
     → Forward to `chief@gulatiops.org`
   - (Start by manually forwarding a few real school emails first to test
     parser before enabling the auto-filter)

5. Connect MCP to claude.ai:
   - Settings → Connectors → Add custom connector
   - URL: `https://gulati-ops.vercel.app/api/mcp`
   - Custom header: `x-mcp-secret: <value of MCP_SHARED_SECRET>`
   - Create Project "GulatiOps" with this connector enabled
   - Add project instructions about Megha's preferences (terse, logistical,
     don't auto-invite husband, etc.)

## Dashboard PWA (built 2026-07-17, not yet deployed/configured)

Code is done and builds cleanly, but needs manual setup before it works in
production:

1. **Add env vars in Vercel**: `NEXT_PUBLIC_SUPABASE_URL` (same value as
   `SUPABASE_URL`) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase dashboard ->
   Project Settings -> API -> "anon public" key). Redeploy after adding.
2. **Enable magic-link email in Supabase**: Supabase dashboard -> Authentication
   -> Providers -> Email should be enabled by default, but confirm "Confirm
   email" / OTP settings are on. Authentication -> URL Configuration -> set
   **Site URL** to `https://gulati-ops.vercel.app` and add
   `https://gulati-ops.vercel.app/auth/callback` to **Redirect URLs**
   (magic-link sign-in will fail with a redirect mismatch otherwise).
3. **Restrict/disable public signup** (defense in depth): the login server
   action already rejects any email that isn't `PRIMARY_DIGEST_EMAIL`, but
   consider also turning off "Allow new user signups" in Supabase Auth
   settings since this is single-user.
4. **App icons**: `public/manifest.webmanifest` references
   `/icons/icon-192.png`, `/icons/icon-512.png`, and layout metadata
   references `/icons/apple-touch-icon.png` — none of these image files
   exist yet. Add real PNGs at those paths for a proper home-screen icon;
   until then iOS "Add to Home Screen" will fall back to a page screenshot.
5. **Install on iPhone**: visit `https://gulati-ops.vercel.app/dashboard` in
   Safari, sign in via magic link, then Share -> Add to Home Screen.

Push notifications for urgent items (the original motivation for going
native/PWA) are **not built yet** — this phase only gets the dashboard
installable and pull-based (open it, see status). Push requires its own
design pass: what counts as "urgent," VAPID keys + service worker push
handler, and a backend job/cron to trigger sends.

## Known quirks

- Node 25 + `tsx` + ESM resolution needed `./` prefix on script paths
- `.env` files not auto-loaded by Node, requires `--env-file=.env` flag
- `vercel.json` with explicit functions config broke the build; removed,
  Vercel auto-detects api/ directory now
- Google OAuth shows "unverified app" warning since it's in Testing mode -
  this is fine for personal use, just click Advanced → Continue
- Because the OAuth consent screen is still in Testing mode, Google expires
  the refresh token after 7 days. If calendar reads/writes start erroring
  (e.g. "Token refresh failed"), re-auth at
  `https://gulati-ops.vercel.app/api/google-oauth` and try again. To stop
  this recurring, switch the consent screen from Testing to "In production"
  in Google Cloud Console → APIs & Services → OAuth consent screen.
