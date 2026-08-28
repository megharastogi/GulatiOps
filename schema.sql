-- House Chief of Staff schema
-- Designed for a single household but multi-household-ready

-- ============================================================
-- HOUSEHOLDS & PEOPLE
-- ============================================================

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Los_Angeles',
  digest_email text not null,           -- where Sunday digest goes
  digest_day int not null default 0,     -- 0=Sunday
  digest_hour int not null default 7,    -- 7am local
  created_at timestamptz default now()
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  name text not null,
  role text not null,                    -- 'parent', 'child', 'grandparent'
  email text,                            -- for calendar invites (parents only typically)
  birthdate date,
  notes text,                            -- "allergic to peanuts", "kindergarten at X"
  created_at timestamptz default now()
);

-- ============================================================
-- EMAIL INTAKE
-- ============================================================

-- Every email forwarded in lands here as raw record first.
-- Parser runs against it, writes structured rows, marks parsed.
create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  received_at timestamptz default now(),
  from_address text,
  from_name text,
  to_address text,
  subject text,
  body_text text,
  body_html text,
  raw_headers jsonb,
  -- Parser output:
  parsed_at timestamptz,
  classification text,                   -- 'action_required' | 'informational' | 'noise'
  source_type text,                      -- 'school' | 'activity' | 'grocery' | 'other'
  source_name text,                      -- "Lincoln Elementary", "Soccer League", etc.
  summary text,                          -- 1-2 sentence summary for digests
  parse_error text                       -- if parsing failed
);

create index on inbound_emails (household_id, received_at desc);
create index on inbound_emails (parsed_at) where parsed_at is null;

-- ============================================================
-- SCHOOL CALENDAR (days off, early pickup, events)
-- ============================================================

create table school_calendar (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  source_email_id uuid references inbound_emails(id) on delete set null,
  child_member_id uuid references household_members(id) on delete set null,
  event_type text not null,              -- 'day_off' | 'early_pickup' | 'late_start' | 'event' | 'fundraiser' | 'spirit_day' | 'conference'
  title text not null,
  description text,
  start_date date not null,
  end_date date,                         -- null = same as start_date
  start_time time,                       -- null for all-day
  end_time time,
  location text,
  -- Reminder scheduling:
  remind_two_weeks_before boolean default false,
  remind_one_week_before boolean default true,
  remind_day_before boolean default true,
  created_at timestamptz default now()
);

create index on school_calendar (household_id, start_date);

-- ============================================================
-- ACTION ITEMS (volunteer slots, forms, signups, things due)
-- ============================================================

create table action_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  source_email_id uuid references inbound_emails(id) on delete set null,
  title text not null,
  description text,
  details_url text,                      -- signup link, form link
  due_date date,
  priority text default 'normal',        -- 'urgent' | 'normal' | 'low'
  category text,                         -- 'volunteer' | 'form' | 'payment' | 'rsvp' | 'supply' | 'other'
  status text default 'open',            -- 'open' | 'done' | 'snoozed' | 'dismissed'
  done_at timestamptz,
  created_at timestamptz default now()
);

create index on action_items (household_id, status, due_date);

-- ============================================================
-- CALENDAR OAUTH (Google)
-- ============================================================

create table google_oauth_tokens (
  household_id uuid primary key references households(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  updated_at timestamptz default now()
);

-- ============================================================
-- GROCERIES (stub for later phase, schema ready)
-- ============================================================

create table grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  name text not null,                    -- "organic strawberries"
  canonical_name text,                   -- normalized for matching
  category text,                         -- 'produce', 'dairy', 'pantry', etc.
  typical_quantity text,                 -- "1 lb", "2 cartons"
  last_ordered_at date,
  order_count int default 0,
  notes text,
  created_at timestamptz default now()
);

create index on grocery_items (household_id, last_ordered_at desc);

create table grocery_pending (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  item_name text not null,
  quantity text,
  added_at timestamptz default now(),
  added_via text,                        -- 'chat' | 'auto_suggest' | 'digest'
  ordered boolean default false,
  ordered_at timestamptz
);

-- ============================================================
-- TRIP PLANNING
-- ============================================================

create table trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  destination text not null,
  start_date date not null,
  end_date date not null,
  participant_names text[],
  adult_count int,
  kid_count int,
  constraints jsonb default '{}'::jsonb,  -- { nap_start, nap_end, date_night_days: [...], accommodation_address }
  status text not null default 'planning',  -- 'planning' | 'active' | 'completed'
  notes text,                            -- free-form: links, Airbnb reviews, general trip notes
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on trips (household_id, start_date desc);

create table trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  date date not null,
  day_number int not null,
  is_date_night boolean default false,
  notes text,
  created_at timestamptz default now()
);

create index on trip_days (trip_id, date);

create table trip_activities (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  trip_day_id uuid references trip_days(id) on delete cascade,
  household_id uuid references households(id) on delete cascade,
  slot text not null,                    -- 'morning' | 'afternoon' | 'evening'
  type text not null,                    -- 'activity' | 'restaurant' | 'date_night_restaurant'
  name text not null,
  description text,
  address text,
  url text,
  hours text,                            -- free-text fallback (e.g. "9am-5pm") when start_time/end_time aren't set
  start_time time,                       -- for the hourly grid view; null = shows in "Unscheduled"
  end_time time,                         -- must be > start_time; cross-midnight activities can't be represented, use hours instead
  participants text not null default 'everyone',  -- 'everyone' | 'adults_only' | 'kids_only' | 'kids_with_nanny' — drives grid color + conflict detection; supersedes is_adults_only below
  is_adults_only boolean default false,  -- legacy; kept for back-compat, prefer participants
  reservation_info text,                 -- confirmation numbers, notes
  priority text not null default 'primary',  -- 'primary' | 'alternate_1' | 'alternate_2'
  status text not null default 'planned',    -- 'planned' | 'confirmed' | 'completed' | 'cancelled'
  sort_order int default 0,
  created_at timestamptz default now()
);

create index on trip_activities (trip_day_id, slot, priority);

-- ============================================================
-- AUDIT / NOTIFICATION LOG
-- ============================================================

create table notifications_sent (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  kind text not null,                    -- 'per_email' | 'weekly_digest' | 'reminder'
  subject text,
  body_preview text,
  sent_at timestamptz default now(),
  related_email_id uuid references inbound_emails(id) on delete set null
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Every table gets RLS enabled and deliberately gets NO policies. Under
-- Postgres's RLS default-deny, that means the anon/authenticated roles
-- (reachable via the anon key shipped to the browser) get zero access.
-- This app only ever reads/writes these tables server-side using the
-- Supabase service-role key, which bypasses RLS regardless of policies —
-- so this doesn't change how the app behaves, it just closes off direct
-- access via the public Supabase REST API to anyone with the anon key.
-- (This was previously enabled directly in the Supabase dashboard and
-- never captured here — re-running this block is safe/idempotent.)

alter table households enable row level security;
alter table household_members enable row level security;
alter table inbound_emails enable row level security;
alter table school_calendar enable row level security;
alter table action_items enable row level security;
alter table google_oauth_tokens enable row level security;
alter table grocery_items enable row level security;
alter table grocery_pending enable row level security;
alter table notifications_sent enable row level security;
alter table trips enable row level security;
alter table trip_days enable row level security;
alter table trip_activities enable row level security;

-- ============================================================
-- MIGRATION: run this in the Supabase SQL editor if schema.sql
-- was already applied before the trip notes/hourly-grid feature.
-- Safe to skip if applying schema.sql fresh (columns above already
-- include these).
-- ============================================================
-- alter table trips add column notes text;
-- alter table trip_activities add column start_time time;
-- alter table trip_activities add column end_time time;
-- alter table trip_activities add column participants text not null default 'everyone';

-- ============================================================
-- MULTI-HOUSEHOLD MIGRATION
-- ============================================================
-- Turns the single-household app into a multi-tenant one. Everything here
-- is additive and idempotent — apply it to a live database with no downtime.
-- Existing behaviour is unchanged on application: the service-role key
-- bypasses RLS entirely, so every current code path keeps working until it
-- is deliberately moved to the user-scoped client.

-- ---------- per-household configuration ----------

-- Which parts of the app this household can see. Read in three places:
-- the MCP tools/list response, the dashboard tab list, and page guards.
alter table households add column if not exists features text[] not null default '{email,tasks}';

-- The address school email is forwarded to, e.g. 'smith@yourdomain.xyz'.
-- The inbound webhook routes on this instead of a single env var.
alter table households add column if not exists inbound_address text;

-- Free-text appended to the parser prompt, written by the household itself:
-- "we skip PTA fundraisers", "our 2nd grader is in Mr. Alvarez's class".
alter table households add column if not exists parser_instructions text;

-- Set before a family's first sign-in. The auth callback consumes it to
-- attach their new Supabase user to this household exactly once.
alter table households add column if not exists invited_email text;

create unique index if not exists households_inbound_address_key
  on households (lower(inbound_address)) where inbound_address is not null;
create unique index if not exists households_invited_email_key
  on households (lower(invited_email)) where invited_email is not null;

-- ---------- logins ----------

-- Deliberately separate from household_members: that table models the family
-- (kids, grandparents, birthdays, allergy notes), this one models who can log
-- in. A 6-year-old is a member, not a user. Both parents can be users of one
-- household, which the previous single-email allowlist couldn't express.
create table if not exists household_users (
  household_id uuid not null references households(id) on delete cascade,
  auth_user_id uuid not null,
  role text not null default 'member',   -- 'owner' | 'member'
  created_at timestamptz default now(),
  primary key (household_id, auth_user_id)
);

create index if not exists household_users_auth_user_idx
  on household_users (auth_user_id);

-- ---------- MCP access ----------

-- One token per household, replacing the single MCP_SHARED_SECRET. Only the
-- SHA-256 hash is stored: a database leak doesn't hand over live credentials.
create table if not exists mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz default now(),
  revoked_at timestamptz
);

create index if not exists mcp_tokens_household_idx on mcp_tokens (household_id);

-- ---------- inbound idempotency ----------

-- The Cloudflare email worker throws on a non-OK response so Cloudflare
-- retries. Without a dedupe key, a function that inserted rows and then timed
-- out before returning 200 would re-parse and duplicate every event and
-- action item on the retry.
alter table inbound_emails add column if not exists message_id text;

create unique index if not exists inbound_emails_message_id_key
  on inbound_emails (household_id, message_id) where message_id is not null;

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================
-- Until now every table had RLS enabled with no policies — correct for a
-- single household reached only through the service-role key, but with more
-- than one family in the database, application-level `.eq('household_id')`
-- filters become the only thing separating them. These policies make the
-- database enforce it, so a forgotten filter fails closed instead of leaking.
--
-- The service-role key bypasses RLS, so paths with no user session (the
-- inbound webhook, the MCP route, Google token storage) are unaffected.

alter table household_users enable row level security;
alter table mcp_tokens enable row level security;

-- Resolves the calling user's households. SECURITY DEFINER so it can read
-- household_users without the policy on that table recursing into itself.
create or replace function auth_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from household_users where auth_user_id = auth.uid()
$$;

revoke all on function auth_household_ids() from public;
grant execute on function auth_household_ids() to authenticated;

-- A user sees their own membership rows and nothing else.
drop policy if exists household_users_self on household_users;
create policy household_users_self on household_users
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

-- The household record itself.
drop policy if exists households_member_read on households;
create policy households_member_read on households
  for select to authenticated
  using (id in (select auth_household_ids()));

-- Every household-scoped table gets the same policy shape. Uniformity is the
-- point: one rule to verify rather than a map of which tables are protected.
do $$
declare t text;
begin
  foreach t in array array[
    'household_members', 'inbound_emails', 'school_calendar', 'action_items',
    'grocery_items', 'grocery_pending', 'notifications_sent',
    'trips', 'trip_days', 'trip_activities'
  ]
  loop
    execute format('drop policy if exists %I on %I', t || '_household_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (household_id in (select auth_household_ids())) with check (household_id in (select auth_household_ids()))',
      t || '_household_rw', t
    );
  end loop;
end $$;

-- google_oauth_tokens and mcp_tokens deliberately get NO policy. They hold
-- credential material and are only ever touched server-side with the
-- service-role key; under RLS default-deny, `authenticated` gets nothing.
