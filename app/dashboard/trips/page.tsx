import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

function formatRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = new Date(`${start}T00:00:00`).toLocaleDateString('en-US', opts);
  const e = new Date(`${end}T00:00:00`).toLocaleDateString('en-US', opts);
  return `${s} – ${e}`;
}

const STATUS_LABEL: Record<string, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
};

export default async function TripsPage() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('household_id', household.id)
    .order('start_date', { ascending: false });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {trips?.length ? (
        trips.map((trip) => (
          <Link key={trip.id} href={`/dashboard/trips/${trip.id}`} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 600 }}>{trip.destination}</div>
              <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                {STATUS_LABEL[trip.status] ?? trip.status}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {formatRange(trip.start_date, trip.end_date)}
            </div>
          </Link>
        ))
      ) : (
        <p className="muted">No trips yet. Ask Claude to plan one.</p>
      )}
    </div>
  );
}
