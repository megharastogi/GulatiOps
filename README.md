# House Chief of Staff

A personal MCP-based household agent. Forwards school emails into a structured
inbox, lets you query and act through a dedicated chat on claude.ai, and
manages Google Calendar.

## Architecture in one paragraph

You forward school emails (via a Gmail filter) to a dedicated address on your
own cheap domain. Cloudflare Email Routing → Cloudflare Email Worker → POSTs
to a Vercel webhook. The webhook stores the raw email, asks Claude to parse it
into structured rows (school events, action items, classification), writes
those to Supabase, and emails you a per-email summary if it's action-required.
An MCP server on the same Vercel project exposes tools to claude.ai so you can
query your data, add grocery items, mark things done, and create Google
Calendar events with conflict checks.

---

## Setup — do these in order

### 1. Supabase

1. Create a new project at supabase.com.
2. Open SQL editor, paste `supabase/schema.sql`, run.
3. Copy your project URL, anon key, and **service role key** (the powerful one).
   You'll put the service role key in Vercel env vars — never client-side.

### 2. Domain + Cloudflare Email Routing

1. Buy a cheap domain (`.xyz` or `.click` is ~$1/yr at Cloudflare or Namecheap).
   Anything works — `meghahouse.xyz`, `cofstaff.click`, whatever.
2. Add the domain to Cloudflare (free plan).
3. Cloudflare dashboard → Email → Email Routing → Enable. Add a destination
   address (your real Gmail), verify it via the email Cloudflare sends.
4. Don't add a routing rule yet — we'll point it at the Worker in step 6.

### 3. Vercel project

1. `gh repo create chief-of-staff --private` and push this folder.
2. `vercel link` to a new Vercel project.
3. In Vercel project settings → Environment Variables, paste all variables from
   `.env.example` (you'll fill in Google ones in step 5).
4. Deploy. Note your URL, e.g. `https://chief-of-staff.vercel.app`.

### 4. Seed your household

Locally:
```
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY at minimum
# edit scripts/seed.ts with your name, kids, husband's email
npm install
npm run seed
```

### 5. Google Calendar OAuth (one-time)

1. https://console.cloud.google.com → new project "chief-of-staff".
2. APIs & Services → Enable APIs → enable **Google Calendar API**.
3. Credentials → Create Credentials → OAuth client ID → Web application.
4. Authorized redirect URI: `https://chief-of-staff.vercel.app/api/google-callback`
   (use your real Vercel URL).
5. Copy client ID and client secret → Vercel env vars
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
6. Redeploy Vercel so env vars take effect.
7. In your browser, visit `https://chief-of-staff.vercel.app/api/google-oauth`.
   Approve calendar access. You should see "Calendar connected ✓".

For development, your OAuth app will be in "Testing" mode — add your Gmail as
a test user under OAuth consent screen.

### 6. Cloudflare Email Worker

1. Cloudflare dashboard → Workers & Pages → Create Worker.
2. Paste contents of `emails/cloudflare-email-worker.js`.
3. Add a dependency: in `wrangler.toml`, ensure `postal-mime` is installed.
   Or, in the Worker editor, click "Add npm package" → `postal-mime`.
4. Settings → Variables → add:
   - `VERCEL_INBOUND_URL` = `https://chief-of-staff.vercel.app/api/inbound-email`
   - `INBOUND_SHARED_SECRET` = same value you used in Vercel
5. Settings → Triggers → enable **Email** trigger.
6. Email Routing → Routing Rules → Create rule:
   `chief@yourdomain.xyz` → Send to a Worker → pick this Worker.

### 7. Gmail forwarding filter

1. In your real Gmail, Settings → Forwarding → add `chief@yourdomain.xyz` as a
   forwarding address. Gmail sends a verification code there — pull it from
   the Supabase `inbound_emails` table (it'll show up after step 6 is live).
2. Once verified, create a filter:
   `from:(@yourschool.org OR schoolmessenger.com OR ptboard.com)` → "Forward to
   chief@yourdomain.xyz". You can also forward by labels.

Tip: start by manually forwarding a few real school emails first to test the
parser, *then* enable the filter.

### 8. Connect the MCP to claude.ai

1. claude.ai → Settings → Connectors → Add custom connector.
2. URL: `https://chief-of-staff.vercel.app/api/mcp`
3. Custom header: `x-mcp-secret: <your MCP_SHARED_SECRET>`
4. Name it "House Chief of Staff".
5. Create a Project on claude.ai, name it "House Chief of Staff", attach this
   connector. Add a project instruction like:

   > You are my household chief of staff. Be terse and logistical. When I ask
   > "what's coming up," call `weekly_digest`. When I ask to create a calendar
   > event, always call `check_calendar_busy` first and warn me about conflicts
   > before creating. Only invite my husband when I explicitly say so. Today's
   > date is always the current date.

That project's chat is now your interface. Voice-message it from mobile.

---

## Daily use

- "What's coming up this week?" → calls `weekly_digest`
- "Add eggs and avocados to the grocery list" → calls `add_grocery_item` twice
- "Create a calendar event Tuesday 6pm dinner with the Smiths, invite my husband"
  → calls `check_calendar_busy`, then `create_calendar_event` with
  `invite_emails`
- "I signed up for the Teacher Appreciation lunch, mark it done" →
  `mark_action_done` with title_match
- "Show me all school emails from this week including the noisy ones" →
  `recent_emails` with `include_noise: true`

## Cost ballpark

- Supabase free tier: $0
- Vercel hobby: $0 (well under limits for this volume)
- Cloudflare Email Routing + Worker: $0
- Resend free tier: 3,000 emails/month, $0
- Anthropic API: ~$0.01 per parsed email at Opus pricing — even at 10 emails
  a day, ~$3/mo
- Domain: ~$1/yr

Roughly $3–5/mo running cost.

## What's not built yet

- Whole Foods grocery automation (deferred — list is captured, ordering manual)
- Sunday push digest (you ask on demand for now)
- SMS reminders for urgent deadlines

## Troubleshooting

**Parser stored email but no summary arrived.** Check `inbound_emails` — if
`classification = 'noise'` we don't send a summary. Override by querying with
the MCP.

**MCP can't reach calendar.** Hit `/api/google-oauth` again in your browser to
re-authorize. The refresh_token is stored in Supabase but if you revoked the
app in Google Account → Security, you need to re-grant.

**Cloudflare Worker not firing.** Verify the Email Routing rule points at the
Worker, not at "Forward to address." Check the Worker's Tail logs for errors.
