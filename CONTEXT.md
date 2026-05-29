# GulatiOps - Project Context Handoff

## What this project is

A personal "chief of staff" agent for the Gulati household. School emails get
forwarded to a dedicated address, parsed by Claude into structured data
(school events, action items), and made queryable via an MCP server connected
to a dedicated chat on claude.ai. Also manages Google Calendar with conflict
checks.

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
Vercel: /api/inbound-email
       |
       +--> Supabase: inbound_emails (raw)
       +--> Anthropic API (Claude Opus 4.5 parser)
       +--> Supabase: school_calendar, action_items
       +--> Resend (per-email summary to Megha's inbox)

User interaction:
       Megha on claude.ai (GulatiOps project)
              |
              v (MCP over HTTPS)
       Vercel: /api/mcp
              |
              +--> Supabase queries/mutations
              +--> Google Calendar API (freeBusy + events)
```

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
  `api/` directory now

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
├── package.json                    (deps + seed script)
├── tsconfig.json
├── .gitignore
├── .env.example
├── .env                           (local only, not in git)
├── supabase/
│   └── schema.sql                  (full DB schema, already applied)
├── api/
│   ├── inbound-email.ts            (Cloudflare Worker POSTs here)
│   ├── mcp.ts                      (MCP server for claude.ai)
│   ├── google-oauth.ts             (kicks off OAuth)
│   └── google-callback.ts          (stores tokens)
├── lib/
│   └── google-calendar.ts          (token refresh + freeBusy + createEvent)
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

Defined in `api/mcp.ts`:

- `list_action_items` - filter by status/due date
- `list_school_events` - date range, event types
- `weekly_digest` - combined view: 2 weeks of events + open actions + recent emails
- `recent_emails` - filter by classification
- `add_action_item`, `mark_action_done`
- `add_grocery_item`, `list_grocery_pending`
- `check_calendar_busy` - Google freeBusy check
- `create_calendar_event` - creates event, only invites when explicitly passed
- `list_household_members`

## Env vars (Vercel)

All set EXCEPT possibly RESEND_API_KEY:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
RESEND_API_KEY                 (not yet)
PRIMARY_DIGEST_EMAIL           (Megha's real Gmail)
INBOUND_SHARED_SECRET          (openssl rand -hex 32, also goes to CF Worker)
MCP_SHARED_SECRET              (openssl rand -hex 32, also goes to claude.ai connector header)
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI=https://gulati-ops.vercel.app/api/google-callback
```

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

## Known quirks

- Node 25 + `tsx` + ESM resolution needed `./` prefix on script paths
- `.env` files not auto-loaded by Node, requires `--env-file=.env` flag
- `vercel.json` with explicit functions config broke the build; removed,
  Vercel auto-detects api/ directory now
- Google OAuth shows "unverified app" warning since it's in Testing mode -
  this is fine for personal use, just click Advanced → Continue
