// scripts/provision.ts
//
// Two jobs, both run against a database that has had the multi-household
// migration at the bottom of schema.sql applied:
//
//   npm run provision -- --upgrade-owner
//       One-time. Backfills your existing household with the columns the
//       multi-tenant code now expects (features, inbound_address,
//       invited_email) and links your existing Supabase auth user to it.
//       Run this BEFORE deploying, or you'll lock yourself out — middleware
//       authorizes on household membership now, and yours doesn't exist yet.
//
//   npm run provision -- --family "Smith" --email sarah@gmail.com --address smith
//       Per family. Creates the household, mints an MCP token, and prints the
//       two things they need. The token is shown once and only its SHA-256
//       hash is stored, so copy it before closing the terminal.
//
// Optional flags for --family:
//   --members '[{"name":"Ada","role":"child","notes":"Kindergarten, Ms. Chen"}]'
//   --instructions "We skip PTA fundraisers."
//   --timezone America/Los_Angeles

import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// The domain your Cloudflare Email Routing rules live on. Addresses are
// built as <address>@<MAIL_DOMAIN>.
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'yourdomain.xyz';
const APP_URL = process.env.APP_URL || 'https://gulati-ops.vercel.app';

// ---- your household, for --upgrade-owner ----
const OWNER = {
  digest_email: 'meghagulati30@gmail.com',
  inbound_address: `chief@${MAIL_DOMAIN}`,
  features: ['email', 'tasks', 'groceries', 'calendar', 'trips'],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function mintToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

async function upgradeOwner() {
  const { data: household, error } = await supabase
    .from('households')
    .update({
      features: OWNER.features,
      inbound_address: OWNER.inbound_address,
      invited_email: OWNER.digest_email,
    })
    .eq('digest_email', OWNER.digest_email)
    .select()
    .single();

  if (error || !household) {
    throw new Error(`Could not find your household by digest_email. ${error?.message ?? ''}`);
  }

  // Link the Supabase auth user you already sign in with. Without this row
  // middleware treats you as unauthorized and redirects to /login.
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;

  const me = users.users.find(
    (u) => u.email?.trim().toLowerCase() === OWNER.digest_email.toLowerCase()
  );

  if (!me) {
    console.log(
      `\n⚠  No Supabase auth user for ${OWNER.digest_email} yet.\n` +
        `   Sign in once at ${APP_URL}/login, then re-run this command.\n` +
        `   (invited_email is set, so the sign-in will attach you automatically.)`
    );
  } else {
    await supabase
      .from('household_users')
      .upsert(
        { household_id: household.id, auth_user_id: me.id, role: 'owner' },
        { onConflict: 'household_id,auth_user_id' }
      );
    console.log(`✓ Linked auth user ${me.email} to "${household.name}"`);
  }

  // Mint an MCP token to replace the shared MCP_SHARED_SECRET env var.
  const { token, hash } = mintToken();
  await supabase.from('mcp_tokens').insert({
    household_id: household.id,
    token_hash: hash,
    label: 'owner',
  });

  console.log(`✓ Upgraded household "${household.name}"`);
  console.log(`  features:        ${OWNER.features.join(', ')}`);
  console.log(`  inbound address: ${OWNER.inbound_address}`);
  console.log(`\n  New MCP URL (replaces your old connector — copy it now):`);
  console.log(`  ${APP_URL}/api/mcp?secret=${token}\n`);
}

async function provisionFamily() {
  const name = arg('family');
  const email = arg('email')?.trim().toLowerCase();
  const address = arg('address');

  if (!name || !email || !address) {
    throw new Error('--family, --email and --address are all required.');
  }

  const inboundAddress = address.includes('@') ? address : `${address}@${MAIL_DOMAIN}`;

  const { data: household, error } = await supabase
    .from('households')
    .insert({
      name,
      timezone: arg('timezone') || 'America/Los_Angeles',
      digest_email: email,
      invited_email: email,
      inbound_address: inboundAddress,
      parser_instructions: arg('instructions') || null,
      features: ['email', 'tasks'],
    })
    .select()
    .single();

  if (error || !household) throw new Error(`Insert failed: ${error?.message}`);

  const members = arg('members');
  if (members) {
    const rows = JSON.parse(members).map((m: any) => ({ ...m, household_id: household.id }));
    const { error: memberErr } = await supabase.from('household_members').insert(rows);
    if (memberErr) throw memberErr;
    console.log(`✓ Added ${rows.length} household members`);
  }

  const { token, hash } = mintToken();
  const { error: tokenErr } = await supabase
    .from('mcp_tokens')
    .insert({ household_id: household.id, token_hash: hash, label: 'primary' });
  if (tokenErr) throw tokenErr;

  console.log(`\n✓ Provisioned "${household.name}"\n`);
  console.log(`  Still to do by hand:`);
  console.log(`    Cloudflare → Email Routing → add ${inboundAddress} → the email worker\n`);
  console.log(`  Send them:`);
  console.log(`    Dashboard:  ${APP_URL}/login   (sign in as ${email})`);
  console.log(`    Forward to: ${inboundAddress}`);
  console.log(`    MCP URL:    ${APP_URL}/api/mcp?secret=${token}`);
  console.log(`\n  The MCP token is shown once — only its hash is stored.\n`);
}

async function main() {
  if (flag('upgrade-owner')) return upgradeOwner();
  if (arg('family')) return provisionFamily();
  console.log('Usage:\n  npm run provision -- --upgrade-owner\n  npm run provision -- --family "Smith" --email sarah@gmail.com --address smith');
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
