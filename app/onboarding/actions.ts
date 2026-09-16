'use server';

import { createClient } from '@supabase/supabase-js';
import { getHousehold } from '@/lib/household';

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Marks the household as having been through the wizard, so sign-in stops
 * routing them here.
 *
 * Called both by "Finish" and by "I'll do this later" — deliberately the same
 * thing. Everything the wizard covers also lives on the setup page, so a
 * family that skips loses nothing except the guided pass, and a wizard with no
 * way out is worse than one someone leaves early.
 */
export async function finishOnboarding(): Promise<{ error?: string }> {
  const household = await getHousehold().catch(() => null);
  if (!household) return { error: 'Not signed in.' };

  const { error } = await admin
    .from('households')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', household.id);

  return error ? { error: 'Could not finish setup.' } : {};
}
