'use server';

import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { getHousehold } from '@/lib/household';
import type { Kid } from '@/lib/members';
import { INSTRUCTIONS_MAX } from '@/lib/household-settings';

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

/** The children of the signed-in household, oldest row first. */
export async function listKids(): Promise<Kid[]> {
  const household = await getHousehold().catch(() => null);
  if (!household) return [];

  const { data } = await admin
    .from('household_members')
    .select('id, name, school, grade, birthdate')
    .eq('household_id', household.id)
    .eq('role', 'child')
    .order('created_at');

  return (data ?? []) as Kid[];
}

/**
 * Saves the children passed in and returns the household's full current set.
 *
 * Upsert by id, deliberately: a row with an `id` updates that row, a row
 * without one is inserted, and anything not mentioned in the call is left
 * exactly as it was. Nothing is ever deleted by omission — removing a child
 * is its own explicit action below.
 *
 * That shape matters more than it looks. school_calendar.child_member_id
 * references these rows `on delete set null`, so a delete-everything-then-
 * reinsert would quietly sever every event ever attributed to a child while
 * appearing to succeed.
 *
 * Returning the saved set is what keeps a second save from duplicating
 * everything: the form gets real ids back for the rows it just created.
 */
export async function saveKids(kids: Kid[]): Promise<{ kids?: Kid[]; error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  // Rows someone added and then didn't fill in. Skipping them is kinder than
  // refusing the whole save over a blank row they never meant to create.
  const filled = kids.filter((kid) => kid.name?.trim());

  for (const kid of filled) {
    const row = {
      name: kid.name.trim(),
      school: kid.school?.trim() || null,
      grade: kid.grade?.trim() || null,
      birthdate: kid.birthdate || null,
    };

    // household_id is in the filter as well as the values so a forged id
    // belonging to another family updates nothing instead of someone else's
    // child.
    const { error } = kid.id
      ? await admin
          .from('household_members')
          .update(row)
          .eq('id', kid.id)
          .eq('household_id', household.id)
      : await admin
          .from('household_members')
          .insert({ ...row, household_id: household.id, role: 'child' });

    // Truthfully: rows earlier in the loop are already saved. Say which one
    // failed rather than claiming nothing happened.
    if (error) return { error: `Could not save ${row.name}. Try again.`, kids: await listKids() };
  }

  revalidatePath('/dashboard/setup');
  return { kids: await listKids() };
}

/** Removes one child. Explicit and single-target, never a side effect of a save. */
export async function removeKid(id: string): Promise<{ kids?: Kid[]; error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  const { error } = await admin
    .from('household_members')
    .delete()
    .eq('id', id)
    .eq('household_id', household.id);

  if (error) return { error: 'Could not remove that child.' };

  revalidatePath('/dashboard/setup');
  return { kids: await listKids() };
}

/**
 * Saves the household's free-text parser preferences.
 *
 * This text is pasted into the prompt for every single email that arrives, so
 * it's capped rather than unbounded — a long enough blob would cost real money
 * per parse and start crowding out the email itself. Empty saves as null so
 * the parser omits the section entirely rather than being handed a blank
 * heading to interpret.
 */
export async function saveParserInstructions(
  text: string
): Promise<{ saved?: boolean; error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  const trimmed = text.trim();
  if (trimmed.length > INSTRUCTIONS_MAX) {
    return { error: `Keep it under ${INSTRUCTIONS_MAX} characters.` };
  }

  const { error } = await admin
    .from('households')
    .update({ parser_instructions: trimmed || null })
    .eq('id', household.id);

  if (error) return { error: 'Could not save that. Nothing changed.' };

  revalidatePath('/dashboard/setup');
  return { saved: true };
}
