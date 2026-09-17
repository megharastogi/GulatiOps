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

/** Someone who may sign in to this household. */
export type Login = {
  id: string;
  email: string;
  role: 'owner' | 'member';
  claimed_at: string | null;
};

/** Everyone allowed to sign in to this household, owner first. */
export async function listLogins(): Promise<Login[]> {
  const household = await getHousehold().catch(() => null);
  if (!household) return [];

  const { data } = await admin
    .from('household_invites')
    .select('id, email, role, claimed_at')
    .eq('household_id', household.id)
    .order('created_at');

  const rows = (data ?? []) as Login[];
  return rows.sort((a, b) => (a.role === b.role ? 0 : a.role === 'owner' ? -1 : 1));
}

/**
 * Lets another person sign in to this household.
 *
 * Always a member: owner is conferred by provisioning, never handed out from
 * here, because an owner row can't be removed afterwards. A member sees
 * exactly what an owner sees, so this grants full access to the household's
 * mail, tasks and connector — there is no lesser tier to offer.
 *
 * No email is sent. The person is told by whoever added them to go to the
 * sign-in page and ask for a link; the row is what makes that link work.
 */
export async function addLogin(email: string): Promise<{ logins?: Login[]; error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  const normalized = email.trim().toLowerCase();

  // Deliberately loose. The real test is whether a magic link arrives, and a
  // stricter pattern would reject valid addresses to no benefit.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: 'That doesn’t look like an email address.' };
  }

  const { data: mine } = await admin
    .from('household_invites')
    .select('id')
    .eq('household_id', household.id)
    .eq('email', normalized)
    .maybeSingle();

  if (mine) return { error: 'That person can already sign in.', logins: await listLogins() };

  const { error } = await admin
    .from('household_invites')
    .insert({ household_id: household.id, email: normalized, role: 'member' });

  // household_invites_email_key is global, so a conflict here means another
  // household already claimed the address. Say so rather than leaking whose.
  if (error?.code === '23505') {
    return { error: 'That address is already signed up with another household.' };
  }
  if (error) return { error: 'Could not add that person. Try again.' };

  revalidatePath('/dashboard/setup');
  return { logins: await listLogins() };
}

/**
 * Takes away someone's access.
 *
 * Refuses on an owner, whoever is asking. That guard is the one thing in the
 * app that reads role, and it isn't about privilege — it's what stops a
 * household deleting its own last way back in. Changing or removing an owner
 * is a database-level operation on purpose.
 *
 * The membership row goes first and the invite second. Middleware re-reads
 * household_users on every request, so dropping it is an immediate lock-out;
 * if the second delete then failed, the leftover invite would simply re-attach
 * them on their next sign-in. The other order fails badly: an invite deleted
 * while the membership row survives leaves someone with working access and no
 * record of why.
 */
export async function removeLogin(id: string): Promise<{ logins?: Login[]; error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  // household_id is in the filter as well as the id so a forged id belonging
  // to another family matches nothing instead of removing their login.
  const { data: invite } = await admin
    .from('household_invites')
    .select('id, role, claimed_by')
    .eq('id', id)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!invite) return { error: 'That person is not on this household.' };
  if (invite.role === 'owner') {
    return { error: 'The owner can’t be removed.', logins: await listLogins() };
  }

  if (invite.claimed_by) {
    const { error: userErr } = await admin
      .from('household_users')
      .delete()
      .eq('auth_user_id', invite.claimed_by)
      .eq('household_id', household.id);

    if (userErr) return { error: 'Could not remove their access. Nothing changed.' };
  }

  const { error } = await admin
    .from('household_invites')
    .delete()
    .eq('id', invite.id)
    .eq('household_id', household.id);

  if (error) return { error: 'Their access is gone, but the row could not be cleared.' };

  revalidatePath('/dashboard/setup');
  return { logins: await listLogins() };
}
