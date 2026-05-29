// scripts/seed.ts
// Run once after applying schema.sql to insert your household + members.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ====== EDIT THESE ======
const HOUSEHOLD = {
  name: 'Megha Household',
  timezone: 'America/Los_Angeles',
  digest_email: 'megha@example.com', // your real Gmail
};

const MEMBERS = [
  { name: 'Megha', role: 'parent', email: 'megha@example.com', notes: 'solo dev / founder' },
  { name: 'Husband', role: 'parent', email: 'husband@example.com' },
  { name: 'Kid 1', role: 'child', notes: 'school: ?' },
  { name: 'Kid 2', role: 'child', notes: 'school: ?' },
];
// ========================

async function main() {
  // Idempotent: only insert household if missing
  const existing = await supabase
    .from('households')
    .select('id')
    .eq('digest_email', HOUSEHOLD.digest_email)
    .maybeSingle();

  let householdId: string;
  if (existing.data) {
    householdId = existing.data.id;
    console.log('Household already exists, id:', householdId);
  } else {
    const { data, error } = await supabase
      .from('households')
      .insert(HOUSEHOLD)
      .select()
      .single();
    if (error) throw error;
    householdId = data.id;
    console.log('Created household:', householdId);
  }

  for (const m of MEMBERS) {
    const exists = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('name', m.name)
      .maybeSingle();
    if (exists.data) {
      console.log(`Member ${m.name} already exists`);
      continue;
    }
    await supabase.from('household_members').insert({ household_id: householdId, ...m });
    console.log(`Added member: ${m.name}`);
  }

  console.log('\nDone. Set this in Vercel env vars:');
  console.log(`PRIMARY_DIGEST_EMAIL=${HOUSEHOLD.digest_email}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
