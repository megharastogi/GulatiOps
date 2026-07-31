// One-off backfill: some trip_activities have a time embedded in their
// reservation_info/name text (e.g. "CONFIRMED: 11:00 AM, 2 guests") but no
// structured start_time, so they never showed up on the hourly grid.
// Usage:
//   node --env-file=.env --import tsx/esm scripts/backfill-activity-times.ts            (dry run, prints what would change)
//   node --env-file=.env --import tsx/esm scripts/backfill-activity-times.ts --apply     (actually writes)

import { createClient } from '@supabase/supabase-js';
import { extractTimeFromText } from '../lib/extract-time';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const APPLY = process.argv.includes('--apply');

async function main() {
  const { data: rows, error } = await supabase
    .from('trip_activities')
    .select('id, trip_id, name, reservation_info, start_time')
    .is('start_time', null);
  if (error) throw error;

  const candidates = (rows || [])
    .map((r) => ({
      ...r,
      inferred: extractTimeFromText(r.reservation_info) || extractTimeFromText(r.name),
    }))
    .filter((r) => r.inferred);

  if (!candidates.length) {
    console.log('No activities with a recoverable time found.');
    return;
  }

  console.log(`${candidates.length} activit${candidates.length === 1 ? 'y' : 'ies'} with a time in text but no start_time:\n`);
  for (const c of candidates) {
    console.log(`  ${c.inferred}  —  ${c.name}  (id: ${c.id})`);
  }

  if (!APPLY) {
    console.log('\nDry run only — nothing written. Re-run with --apply to write these start_time values.');
    return;
  }

  for (const c of candidates) {
    const { error: updateError } = await supabase
      .from('trip_activities')
      .update({ start_time: c.inferred })
      .eq('id', c.id);
    if (updateError) {
      console.error(`  FAILED ${c.id}: ${updateError.message}`);
    } else {
      console.log(`  updated ${c.id}`);
    }
  }
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
