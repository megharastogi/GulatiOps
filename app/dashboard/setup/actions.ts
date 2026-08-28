'use server';

import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getHousehold } from '@/lib/household';

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type State = { url?: string; error?: string };

/**
 * Mints a fresh MCP connector token and revokes every previous one.
 *
 * Only the SHA-256 hash is stored, so an existing token can never be shown
 * again — which means "show me my connector link" has to be "issue me a new
 * one". That's the right trade: a leaked database yields no usable
 * credentials, and re-issuing costs the user one paste into Claude settings.
 *
 * Revoking the old tokens is what makes this safe to expose as a button:
 * whoever holds the previous link loses access the moment a new one is made.
 */
export async function regenerateConnector(): Promise<State> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const { error: revokeError } = await admin
    .from('mcp_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('household_id', household.id)
    .is('revoked_at', null);

  if (revokeError) return { error: 'Could not revoke the old link. Nothing changed.' };

  const { error } = await admin.from('mcp_tokens').insert({
    household_id: household.id,
    token_hash: tokenHash,
    label: 'dashboard',
  });

  if (error) return { error: 'Could not create a new link. Try again.' };

  const appUrl = process.env.APP_URL || '';
  return { url: `${appUrl}/api/mcp?secret=${token}` };
}
