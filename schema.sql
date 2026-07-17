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
  hours text,
  is_adults_only boolean default false,
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
