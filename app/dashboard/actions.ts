'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Every surface that lists an open action item can now close it, so this
 * lives here rather than under todo/. The household filter is not redundant
 * with RLS — it is the same check stated twice on purpose, since an id is
 * the only thing the caller supplies.
 */
export async function markDone(id: string) {
  const supabase = await createClient();
  const household = await getHousehold();

  await supabase
    .from('action_items')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', id)
    .eq('household_id', household.id);

  for (const path of ['/dashboard', '/dashboard/week', '/dashboard/todo']) {
    revalidatePath(path);
  }
}

/**
 * Takes an event off the dashboard. Hidden rather than deleted so the email
 * parser still sees it: the next newsletter mentioning the same event merges
 * into this row and it stays gone, where a deleted row would simply come back.
 */
export async function hideEvent(id: string) {
  const supabase = await createClient();
  const household = await getHousehold();

  await supabase
    .from('school_calendar')
    .update({ hidden_at: new Date().toISOString() })
    .eq('id', id)
    .eq('household_id', household.id);

  for (const path of ['/dashboard', '/dashboard/week']) {
    revalidatePath(path);
  }
}
