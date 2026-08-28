// scripts/verify.ts
//
// Read-only health check for the multi-household setup. Writes nothing.
// Run it after applying the migration, after provisioning, and any time you
// want to see who exists:
//
//   npm run verify
//
// It confirms the schema landed, that your own household is wired up, and
// that RLS is denying anonymous reads. The one thing it can't check from
// here is whether the *policies* are correct for a signed-in user — that
// needs a real JWT, so run the `set local role authenticated` check in the
// Supabase SQL editor for that.

import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Same key the browser gets. Anything readable with this is readable by
// anyone who views source.
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

let failures = 0;

function ok(label: string, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}
function bad(label: string, detail = '') {
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function checkSchema() {
  console.log('\nSchema');

  const probes: [string, string][] = [
    ['households', 'features, inbound_address, parser_instructions, invited_email'],
    ['household_users', 'household_id, auth_user_id, role'],
    ['mcp_tokens', 'household_id, token_hash, revoked_at'],
    ['inbound_emails', 'message_id'],
  ];

  for (const [table, columns] of probes) {
    const { error } = await admin.from(table).select(columns).limit(1);
    if (error) bad(`${table} (${columns})`, error.message);
    else ok(`${table}`, columns);
  }
}

async function checkHouseholds() {
  console.log('\nHouseholds');

  const { data, error } = await admin
    .from('households')
    .select('id, name, digest_email, inbound_address, invited_email, features')
    .order('created_at');

  if (error) return bad('could not list households', error.message);
  if (!data?.length) return bad('no households exist');

  for (const h of data) {
    const { count: users } = await admin
      .from('household_users')
      .select('auth_user_id', { count: 'exact', head: true })
      .eq('household_id', h.id);

    const { count: tokens } = await admin
      .from('mcp_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id)
      .is('revoked_at', null);

    const { count: emails } = await admin
      .from('inbound_emails')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', h.id);

    console.log(`\n  ${h.name}`);
    console.log(`    features:   ${(h.features || []).join(', ') || '(none)'}`);
    console.log(`    forwards to: ${h.inbound_address || '⚠ not set'}`);
    console.log(`    invited:     ${h.invited_email || '⚠ not set — they cannot sign in'}`);
    console.log(`    logins:      ${users ?? 0}`);
    console.log(`    mcp tokens:  ${tokens ?? 0} active`);
    console.log(`    emails:      ${emails ?? 0}`);

    if (!h.inbound_address) bad(`${h.name} has no inbound_address`, 'mail for it cannot route');
    if (!h.invited_email) bad(`${h.name} has no invited_email`, 'nobody can sign in');
    if ((users ?? 0) === 0) {
      console.log(`    ⚠ no login attached yet — they get "not attached to a household" until first sign-in`);
    }
  }

  // Two households sharing an address would make routing ambiguous. The
  // unique index should prevent it; this catches a index that didn't apply.
  const addresses = data.map((h) => h.inbound_address).filter(Boolean);
  if (new Set(addresses).size !== addresses.length) {
    bad('duplicate inbound_address across households', 'routing is ambiguous');
  }
}

async function checkRls() {
  console.log('\nRLS (anonymous reads must return nothing)');

  const tables = [
    'households',
    'household_members',
    'inbound_emails',
    'school_calendar',
    'action_items',
    'grocery_items',
    'grocery_pending',
    'notifications_sent',
    'trips',
    'trip_days',
    'trip_activities',
    'household_users',
    'mcp_tokens',
    'google_oauth_tokens',
  ];

  for (const table of tables) {
    const { data, error } = await anon.from(table).select('*').limit(1);
    if (error) {
      // A permission error is a pass: the table refused outright.
      ok(table, 'denied');
    } else if (data && data.length > 0) {
      bad(table, `LEAKING — anon key returned ${data.length} row(s)`);
    } else {
      ok(table, 'empty for anon');
    }
  }
}

async function main() {
  console.log('GulatiOps verification (read-only)');
  await checkSchema();
  await checkHouseholds();
  await checkRls();

  console.log(
    failures === 0
      ? '\n✓ All checks passed.\n'
      : `\n✗ ${failures} problem${failures === 1 ? '' : 's'} above.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
