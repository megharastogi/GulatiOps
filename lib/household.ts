// /lib/household.ts
// Shared household resolver — this app is single-household, keyed by digest email.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getHousehold() {
  const { data } = await supabase
    .from('households')
    .select('*')
    .eq('digest_email', process.env.PRIMARY_DIGEST_EMAIL!)
    .single();
  if (!data) throw new Error('Household not seeded.');
  return data;
}
