// /lib/household.ts
// Household resolvers. This app used to be single-household, keyed by the
// PRIMARY_DIGEST_EMAIL env var — one household, one owner, resolved the same
// way everywhere. It is now multi-tenant, and *how* you identify the household
// depends on who is calling:
//
//   getHousehold()                    — a signed-in person on the dashboard
//   getHouseholdByInboundAddress()    — the Cloudflare email webhook
//   getHouseholdByMcpToken()          — a claude.ai connector
//
// Each caller has exactly one of those signals, so there is no ambient
// "current household" any more. That's deliberate: the previous env-var
// lookup silently returned the same row no matter who was asking.

import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { createClient as createAuthClient } from '@/lib/supabase/server';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type Household = {
  id: string;
  name: string;
  timezone: string;
  digest_email: string;
  features: string[];
  inbound_address: string | null;
  parser_instructions: string | null;
  [key: string]: any;
};

/** Feature flags. Households opt into surfaces; absent means not available. */
export type Feature = 'email' | 'tasks' | 'groceries' | 'calendar' | 'trips';

export function hasFeature(household: Household, feature: Feature): boolean {
  return Array.isArray(household.features) && household.features.includes(feature);
}

/**
 * The signed-in user's household. Throws if there is no session or the user
 * isn't attached to a household — both are bugs by the time a dashboard page
 * renders, because middleware.ts redirects those cases to /login first.
 */
export async function getHousehold(): Promise<Household> {
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) throw new Error('Not signed in.');

  const household = await getHouseholdForUser(user.id);
  if (!household) throw new Error('Signed-in user is not attached to a household.');
  return household;
}

/**
 * Household for a Supabase auth user id, or null. Used by middleware to decide
 * whether a session is authorized at all, where throwing would be wrong.
 */
export async function getHouseholdForUser(authUserId: string): Promise<Household | null> {
  const { data } = await supabase
    .from('household_users')
    .select('households(*)')
    .eq('auth_user_id', authUserId)
    .limit(1)
    .maybeSingle();

  // Supabase types the embedded row as an array or object depending on the
  // relationship it infers; normalise both shapes.
  const row: any = (data as any)?.households;
  const household = Array.isArray(row) ? row[0] : row;
  return (household as Household) ?? null;
}

/** Household that owns a forwarding address, e.g. 'smith@yourdomain.xyz'. */
export async function getHouseholdByInboundAddress(
  address: string
): Promise<Household | null> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;

  const { data } = await supabase
    .from('households')
    .select('*')
    .ilike('inbound_address', normalized)
    .maybeSingle();

  return (data as Household) ?? null;
}

/** SHA-256 of an MCP token. Only the hash is ever stored. */
export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Household behind an MCP token. Returns null for unknown or revoked tokens —
 * callers must treat null as "unauthorized", never as "use the default".
 */
export async function getHouseholdByMcpToken(token: string): Promise<Household | null> {
  if (!token) return null;

  const { data } = await supabase
    .from('mcp_tokens')
    .select('households(*)')
    .eq('token_hash', hashMcpToken(token))
    .is('revoked_at', null)
    .maybeSingle();

  const row: any = (data as any)?.households;
  const household = Array.isArray(row) ? row[0] : row;
  return (household as Household) ?? null;
}

/**
 * Household for a page that belongs to a feature, 404-ing if this household
 * doesn't have it. Hiding the tab isn't enough on its own — the URL is still
 * typeable, and a family without `trips` should get a 404 rather than a page
 * that renders empty and looks broken.
 */
export async function requireFeature(feature: Feature): Promise<Household> {
  const household = await getHousehold();
  if (!hasFeature(household, feature)) notFound();
  return household;
}
