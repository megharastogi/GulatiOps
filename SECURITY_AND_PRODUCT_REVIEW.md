# GulatiOps Security and Product Review

Reviewed: August 10, 2026

## Purpose and scope

This document converts the code review into a practical remediation backlog. It covers vulnerabilities visible through static repository inspection, dependency auditing, and a production build. It is not a guarantee that no other runtime, infrastructure, or deployed Supabase issues exist.

The production build completed successfully using Next.js 15.5.20. No application changes were made as part of the original review.

## Recommended order of work

- [x] Verify and lock down the deployed Supabase database. — verified 2026-07-31: RLS already on, no permissive policies.
- [x] Secure Google OAuth account binding. — fixed 2026-07-31, commit `15cd8e4`.
- [x] Make MCP authentication fail closed. — fixed 2026-07-31, commit `15cd8e4`.
- [ ] Upgrade vulnerable dependencies.
- [x] Enforce owner/household authorization in server code. — fixed 2026-07-31, commit `c5d5631` (middleware-level; per-Server-Action defense in depth still open).
- [~] Add validation, rate limits, idempotency, and transactions. — output validation done 2026-07-31, commit `750fa0b`; rate limits/idempotency/transactions still open.
- [~] Escape generated email HTML and restrict external fetching. — escaping done 2026-07-31, commit `750fa0b`; external fetching only partially restricted (query-string stripping, no domain allowlist).
- [ ] Add automated security and integration tests.
- [ ] Improve review, reminder, calendar-sync, task, and grocery features.

---

## Critical security issues

### 1. Sensitive Supabase tables may be publicly accessible

**Status:** [x] Verified not an issue (2026-07-31) — RLS is enabled on all 12 public tables (`pg_class.relrowsecurity = true`) with zero policies defined (`pg_policies` returns no rows). Under Postgres RLS default-deny, this means `anon`/`authenticated` get zero access, which matches the app's actual design (all data access goes through the service-role key server-side, which bypasses RLS regardless of policies). This was likely done directly in the Supabase dashboard rather than via `schema.sql`, which is why static inspection didn't catch it — `schema.sql` should be updated to document this (see note below) so it doesn't look unresolved to the next person reading the repo.

**Location:** `schema.sql`

The schema creates sensitive tables in the public schema without enabling Row Level Security or defining policies. The application also exposes a Supabase anon key to the browser for authentication. Depending on the deployed project's grants, a caller may be able to bypass the application and access Supabase directly.

Potentially exposed data includes:

- Raw email bodies and headers
- Household member names, birthdates, email addresses, and notes
- Trips, addresses, and reservation details
- Tasks and grocery lists
- Google access and refresh tokens

**Actions:**

- [ ] Inspect the deployed Supabase project's table grants immediately.
- [ ] Enable RLS on every application table.
- [ ] Revoke unnecessary `anon` and `authenticated` privileges.
- [ ] Keep application data server-only if the browser only needs Supabase Auth.
- [ ] Ensure the OAuth token table cannot be accessed through public APIs.
- [ ] Encrypt refresh tokens with a key stored outside Supabase, or use a dedicated token store.
- [ ] Add automated tests proving an anon client cannot read or mutate any application table.
- [ ] If tokens may have been exposed, revoke the Google authorization and rotate credentials.

### 2. Google OAuth can be rebound to an attacker's account

**Status:** [x] Fixed (2026-07-31, commit `15cd8e4`) — both routes now require a logged-in session (added to `middleware.ts`'s matcher, which previously excluded all of `/api`), verify the session email against `PRIMARY_DIGEST_EMAIL`, and round-trip a `state` cookie to block CSRF-style flow hijacking. Also stopped nulling out a working `refresh_token` when Google omits one, and stopped echoing Google's raw error text to the browser. Verified: an unauthenticated request to `/api/google-oauth` redirects to `/login`.

**Locations:**

- `app/api/google-oauth/route.ts`
- `app/api/google-callback/route.ts`
- `middleware.ts`

The OAuth routes are unauthenticated. The authorization request has no `state`, PKCE verifier, authenticated owner binding, or household binding. The callback writes the returned token into the configured household unconditionally.

An attacker could authorize the app with their Google account and overwrite the household's stored calendar credentials.

**Actions:**

- [ ] Require an authenticated owner on both OAuth routes.
- [ ] Verify the signed-in user's normalized email against the owner or membership record.
- [ ] Generate and verify a cryptographically random, short-lived OAuth `state` value.
- [ ] Add PKCE.
- [ ] Bind the pending OAuth flow to the authenticated user and household server-side.
- [ ] Verify the identity of the authorized Google account before saving tokens.
- [ ] Do not overwrite a working refresh token when Google omits `refresh_token`.
- [ ] Return generic errors to the browser and log only sanitized details.

### 3. MCP authentication fails open

**Status:** [x] Fixed (2026-07-31, commit `15cd8e4`) — a missing `MCP_SHARED_SECRET` now always returns 401 instead of silently allowing all requests, and the comparison uses `timingSafeEqual` instead of `===`. Query-string auth is intentionally kept (the claude.ai connector UI doesn't support custom headers) — that residual risk (leakage via logs/history) is unchanged. Verified via curl: no secret → 401, wrong secret → 401, correct secret → 200.

**Location:** `app/api/mcp/route.ts`

The endpoint authenticates only when `MCP_SHARED_SECRET` is configured. A missing or misspelled environment variable makes the MCP server public. Its tools can expose household information and perform destructive operations.

It also accepts the secret in the query string, where it can leak through browser history, access logs, monitoring systems, referrer headers, and screenshots.

**Actions:**

- [ ] Refuse requests or fail startup when the MCP secret is missing.
- [ ] Remove query-string authentication.
- [ ] Use a constant-time comparison for secrets.
- [ ] Prefer OAuth or signed, scoped, expiring credentials over a permanent shared secret.
- [ ] Separate read-only tools from mutating/destructive tools.
- [ ] Add rate limiting and request-size limits.
- [ ] Add audit records for MCP mutations.
- [ ] Add a secret-rotation procedure.

---

## High-risk issues

### 4. Google OAuth tokens are stored in plaintext

**Status:** [x] Fixed (2026-07-31, commit `c5d5631`) — tokens are now AES-256-GCM encrypted (`lib/token-crypto.ts`) before being written, with the key held only in `TOKEN_ENCRYPTION_KEY` (set in Vercel + local `.env`, never in Supabase). Existing plaintext tokens still read correctly (legacy passthrough, no key needed for that path) and get upgraded to encrypted automatically on their next refresh or reconnect. Verified: encrypt/decrypt round-trips correctly and a tampered ciphertext is rejected via GCM's auth tag.

**Location:** `schema.sql`, table `google_oauth_tokens`

Access and refresh tokens are stored as ordinary text. A database leak, overly broad grant, backup exposure, or service-role compromise could expose long-lived calendar access.

**Actions:**

- [ ] Encrypt refresh tokens using an application-managed key stored separately.
- [ ] Restrict token-table access to the smallest possible server-side role.
- [ ] Redact tokens from all logs and errors.
- [ ] Document revocation and recovery procedures.

### 5. Any authenticated Supabase user can reach the household dashboard

**Status:** [x] Fixed (2026-07-31, commit `c5d5631`) — `lib/supabase/middleware.ts` now verifies the session's email against `PRIMARY_DIGEST_EMAIL`, not just that a session exists, and signs out + redirects anyone else. This covers every dashboard page and Server Action gated by the same matcher (Server Actions invoked from an authorized page are POST requests to that page's own route, so they pass through the same middleware check). Not yet done: repeating authorization inside individual Server Actions as defense in depth, and building out real roles/membership if multiple users are ever supported (still relevant if this app grows beyond a single owner — see #26).

**Locations:**

- `lib/supabase/middleware.ts`
- Dashboard pages and Server Actions under `app/dashboard`

Middleware checks that a Supabase user exists but does not verify that the user is the configured owner or a member of the household. The magic-link form restricts link requests, but that is not a durable authorization boundary.

Because dashboard code uses the service-role client, an unauthorized authenticated user would inherit access to the configured household.

**Actions:**

- [ ] Add an explicit `auth.users.id` to household-membership mapping.
- [ ] Verify membership or owner email in middleware.
- [ ] Repeat authorization inside every Server Action and protected route.
- [ ] Replace the global household resolver with an authorized-user-to-household resolver.
- [ ] Add owner, adult, and read-only roles if multiple users will be supported.

### 6. Untrusted content is inserted into notification HTML

**Status:** [x] Fixed (2026-07-31, commit `750fa0b`) — every free-text value (title, summary, subject, sender name) is now HTML-escaped before going into the notification email; `details_url` only renders as a link if it parses as a plain `https:` URL.

**Location:** `app/api/inbound-email/route.ts`

Email-derived and model-derived fields are interpolated directly into outgoing HTML. A malicious email could inject misleading markup, tracking content, malformed attributes, or deceptive links.

**Actions:**

- [ ] HTML-escape all text values.
- [ ] Build links using a safe renderer rather than string interpolation.
- [ ] Permit only validated `https:` URLs.
- [ ] Consider linking to a trusted dashboard review page instead of embedding arbitrary URLs.
- [ ] Add tests using hostile subjects, titles, summaries, locations, and URLs.

### 7. Email prompt injection can corrupt trusted records

**Status:** [~] Partially addressed (2026-07-31, commit `750fa0b`) — the model's output is now validated server-side before it reaches the database (`normalizeParsedOutput`): classification/event_type/priority must be a known value, dates/times must match the expected format or get dropped, free text is length-capped, arrays capped at 20 items. This closes off the "corrupt trusted records with garbage" risk. Not done: clearly delimiting email/webpage content as untrusted quoted data in the prompt itself, structured-output/schema-constrained model responses, confidence/evidence tracking, or a review step before trusting anything — deferred per user request to keep this pass lightweight (personal-use app).

**Location:** `app/api/inbound-email/route.ts`

Raw email and fetched webpage content are sent directly to the model. A sender can place instructions in the message that attempt to override the parser. The model output is parsed and stored without runtime schema validation.

**Actions:**

- [ ] Clearly delimit email and webpage content as untrusted quoted data.
- [ ] Use structured-output or schema-constrained model responses.
- [ ] Validate classifications, enums, dates, times, URLs, lengths, and array sizes server-side.
- [ ] Record extraction confidence and source evidence.
- [ ] Add a review step before trusting payment, medical, or other sensitive requests.
- [ ] Ensure parsed email content can never automatically trigger calendar or financial actions.

### 8. Private newsletter links are disclosed to a third-party reader

**Status:** [~] Partially addressed (2026-07-31, commit `750fa0b`) — query strings (the usual home for signed/personalized recipient tokens) are now stripped before a link is sent to Jina Reader. Not done: domain allowlisting, making enrichment opt-in, or logging only the destination domain — deferred per user request to keep this pass lightweight.

**Location:** `app/api/inbound-email/route.ts`

The parser submits links extracted from email HTML to Jina Reader. Newsletter links may contain recipient IDs, signed document tokens, private identifiers, or tracking parameters.

**Actions:**

- [ ] Allowlist supported newsletter domains.
- [ ] Strip tracking and unnecessary query parameters.
- [ ] Reject signed, authenticated, private-network, and unexpected URLs.
- [ ] Make external enrichment opt-in.
- [ ] Document the external service as a data processor.
- [ ] Log only the destination domain, not the full URL.

### 9. Email ingestion lacks cost and abuse controls

**Status:** [ ] Not started

**Locations:**

- `cloudflare-email-worker.js`
- `app/api/inbound-email/route.ts`

Each accepted request may store large content, fetch three external pages, and invoke an expensive model. There is no message-level deduplication, strict request limit, rate limit, or cost quota.

*Side note (2026-07-31, commit `750fa0b`): `INBOUND_SHARED_SECRET` comparison was switched to the same fail-closed, `timingSafeEqual` pattern used for MCP (same secret value, not a new finding from the original review, but the same class of issue as #3). The abuse-control items below are still open.*

**Actions:**

- [ ] Enforce content type and body-size limits in both the Worker and API route.
- [ ] Limit text, HTML, header, subject, and address lengths.
- [ ] Deduplicate using normalized `Message-ID` plus recipient.
- [ ] Add a unique database constraint for message identity.
- [ ] Queue processing and make every stage idempotent.
- [ ] Add per-source rate limits and daily model-spend limits.
- [ ] Alert on unusual email volume, parse failures, or cost.

### 10. Known dependency vulnerabilities

**Status:** [ ] Not started

The review-time `npm audit` reported 13 vulnerable package entries:

- 1 critical
- 9 high
- 3 moderate

Affected packages included Next.js 15.5.20, `tar`, `@vercel/node`, `sharp`, `postcss`, `undici`, `path-to-regexp`, and `form-data`.

**Actions:**

- [ ] Remove `@vercel/node` if it remains unused.
- [ ] Upgrade Next.js beyond all reported affected ranges.
- [ ] Upgrade direct dependencies and regenerate `package-lock.json`.
- [ ] Run `npm audit` again.
- [ ] Run the production build and test suite after upgrading.
- [ ] Add dependency auditing or automated update PRs to CI.

### 11. MCP schemas are documented but not enforced

**Status:** [ ] Not started

**Location:** `app/api/mcp/route.ts`

The endpoint publishes JSON schemas but does not validate incoming calls against them. Tool arguments flow directly into queries and mutations. Very large trip date ranges, malformed dates, invalid UUIDs, arbitrary email addresses, and oversized values are possible.

**Actions:**

- [ ] Add runtime validation using Zod, Ajv, or an equivalent library.
- [ ] Reject unknown fields where practical.
- [ ] Add maximum string, list, and date-range sizes.
- [ ] Validate UUIDs, ISO dates, time zones, emails, and URLs.
- [ ] Require explicit confirmation for deletions, calendar invitations, and bulk clearing.
- [ ] Limit list-query windows and result counts.

---

## Data integrity and reliability

### 12. Compound operations can leave partial data

**Status:** [ ] Not started

Several database operations ignore errors or perform related writes separately. Examples include parsing an email and writing its events/actions, creating a trip and its days, swapping activity priorities, and sending a notification before recording its audit row.

**Actions:**

- [ ] Check every Supabase `error` result.
- [ ] Return failures instead of reporting success with null data.
- [ ] Use database transactions or RPC functions for compound writes.
- [ ] Make retries idempotent.
- [ ] Store processing state for received, parsing, parsed, notifying, completed, and failed.

### 13. Cross-table relationships are not fully enforced

**Status:** [ ] Not started

Rows can potentially contain inconsistent `household_id`, `trip_id`, and `trip_day_id` relationships.

**Actions:**

- [ ] Make required foreign-key columns `NOT NULL`.
- [ ] Add composite constraints ensuring days and activities belong to the same trip and household.
- [ ] Add uniqueness for `households.digest_email`.
- [ ] Add uniqueness for `(trip_id, date)` and `(trip_id, day_number)`.
- [ ] Add normalized uniqueness or merge behavior for pending groceries.

### 14. Enum-like values and ranges lack database constraints

**Status:** [ ] Not started

Statuses, roles, classifications, priorities, event types, and participant categories are unrestricted text in the database.

**Actions:**

- [ ] Add `CHECK` constraints or PostgreSQL enums.
- [ ] Enforce `end_date >= start_date`.
- [ ] Enforce nonnegative participant counts.
- [ ] Enforce valid digest day and hour ranges.
- [ ] Enforce valid time ranges where both times exist.

### 15. Swaps and reordering are not atomic

**Status:** [ ] Not started

Activity priority and sort-order swaps use two independent updates. A failure between them can corrupt the intended ordering. MCP priority swaps also need to ensure both activities belong to the same relevant trip or day.

**Actions:**

- [ ] Move swap operations into transactional database functions.
- [ ] Verify both records belong to the expected household, trip, and day.
- [ ] Add concurrency tests.

### 16. Configuration is not validated centrally

**Status:** [ ] Not started

Environment variables are generally accessed with TypeScript non-null assertions. Missing values result in delayed or confusing failures, and MCP currently becomes unauthenticated.

**Actions:**

- [ ] Validate all environment variables at application startup.
- [ ] Separate required and optional configuration.
- [ ] Fail closed for all security-related configuration.
- [ ] Avoid logging secret values.

### 17. Security headers are not configured explicitly

**Status:** [ ] Not started

**Location:** `next.config.mjs`

**Actions:**

- [ ] Add a Content Security Policy.
- [ ] Set `frame-ancestors` or equivalent clickjacking protection.
- [ ] Add a strict referrer policy.
- [ ] Add a permissions policy.
- [ ] Confirm HSTS is enabled at the hosting layer.

### 18. Data retention and deletion are undefined

**Status:** [ ] Not started

Raw emails, headers, household notes, trips, and reservation details are retained indefinitely.

**Actions:**

- [ ] Define retention periods by data type.
- [ ] Redact or delete raw email bodies after successful extraction when feasible.
- [ ] Add household data export and deletion workflows.
- [ ] Add an audit trail for important reads and mutations.
- [ ] Document backup retention and deletion behavior.

---

## Product improvement backlog

### 19. Add a parser review inbox

**Priority:** High  
**Status:** [ ] Not started

Show the source email alongside extracted events and tasks, with:

- [ ] Confidence indicators
- [ ] Source evidence for every extraction
- [ ] Approve, edit, reject, and merge controls
- [ ] Duplicate warnings
- [ ] Reprocess capability

This creates a safe boundary between probabilistic parsing and trusted household records.

### 20. Add proactive reminders and digests

**Priority:** High  
**Status:** [ ] Not started

- [ ] Morning summary
- [ ] Weekly digest
- [ ] Due-today and overdue reminders
- [ ] Event reminders based on existing reminder flags
- [ ] Quiet hours and notification preferences
- [ ] Retry and delivery status
- [ ] Email, push, and optional SMS channels

### 21. Add controlled Google Calendar synchronization

**Priority:** High  
**Status:** [ ] Not started

- [ ] Per-event “Add to calendar” action
- [ ] Select personal or school calendar
- [ ] Duplicate detection
- [ ] Store the Google event ID on the source event
- [ ] Show sync status
- [ ] Update or remove synchronized events safely
- [ ] Require explicit confirmation before inviting attendees

### 22. Expand task management

**Priority:** Medium  
**Status:** [ ] Not started

- [ ] Edit, dismiss, snooze, reopen, and delete
- [ ] Assign to a household member or child
- [ ] Recurring tasks
- [ ] Search and filters
- [ ] Attachments and source-email navigation
- [ ] Overdue grouping
- [ ] Completion history
- [ ] Convert tasks into calendar reminders

### 23. Finish grocery history and organization

**Priority:** Medium  
**Status:** [ ] Not started

- [ ] Use the existing `grocery_items` history table
- [ ] Merge duplicates and quantities
- [ ] Categories and aisle sorting
- [ ] Frequent-purchase suggestions
- [ ] Buy-again history
- [ ] Multiple stores or named lists
- [ ] Shared household check-off
- [ ] Order/archive history

### 24. Expand trip planning

**Priority:** Medium  
**Status:** [ ] Not started

- [ ] Create, edit, and delete trips from the dashboard
- [ ] Display alternative activities
- [ ] Track reservation and confirmation status
- [ ] Map view and travel time
- [ ] Lodging and flight records
- [ ] Packing lists and trip tasks
- [ ] Calendar export
- [ ] Offline PWA support
- [ ] Conflict detection based on overlapping people, not only identical participant labels

### 25. Add processing observability

**Priority:** Medium  
**Status:** [ ] Not started

Create an operations view showing:

- [ ] Received, queued, parsed, failed, and notified states
- [ ] Parser model and version
- [ ] Token usage and estimated cost
- [ ] Domains fetched for enrichment
- [ ] Duplicate status
- [ ] Retry control
- [ ] Notification delivery status

### 26. Build household membership and roles

**Priority:** High before multi-user use  
**Status:** [ ] Not started

- [ ] Link Supabase users to households
- [ ] Owner, adult, and read-only roles
- [ ] Invitations and membership removal
- [ ] Household-scoped authorization policies
- [ ] Audit events showing who changed what

---

## Engineering quality backlog

- [ ] Unit tests for input validation, time extraction, and trip conflict logic.
- [ ] Authorization tests for every page, route, and Server Action.
- [ ] Supabase integration tests using anon, authenticated, and service roles.
- [ ] End-to-end tests for login, OAuth state, webhook idempotency, dashboard mutations, and MCP authentication.
- [ ] Add ESLint and formatting scripts.
- [ ] Add CI for build, typecheck, lint, tests, dependency audit, and migration validation.
- [ ] Adopt versioned database migrations rather than editing one monolithic schema file.
- [ ] Add structured logs with request IDs and sensitive-data redaction.
- [ ] Add error monitoring and volume/cost alerts.
- [ ] Add backup and recovery tests.

## Suggested milestones

### Milestone 1: Prevent data exposure

- [ ] RLS and database grants
- [ ] Token rotation and encrypted storage
- [ ] OAuth authentication/state/PKCE
- [ ] Fail-closed MCP authentication
- [ ] Owner authorization in all server code

### Milestone 2: Prevent abuse and corruption

- [ ] Runtime input validation
- [ ] Request and rate limits
- [ ] Email idempotency
- [ ] Transactions and database constraints
- [ ] Safe HTML rendering and controlled external fetching
- [ ] Dependency upgrades

### Milestone 3: Establish confidence

- [ ] Automated authorization and security tests
- [ ] CI checks
- [ ] Processing observability
- [ ] Parser review inbox
- [ ] Audit logging and alerts

### Milestone 4: Improve daily usefulness

- [ ] Reminders and digests
- [ ] Calendar synchronization
- [ ] Better task workflows
- [ ] Grocery history and organization
- [ ] Expanded trip planning

