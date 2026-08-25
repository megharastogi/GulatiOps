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

type Trip = {
  id: string;
  destination: string;
  start_date: string;
  end_date: string;
};

function TripCard({ trip, badge }: { trip: Trip; badge: string }) {
  return (
    <Link href={`/dashboard/trips/${trip.id}`} className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 600 }}>{trip.destination}</div>
        <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>
          {badge}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {formatRange(trip.start_date, trip.end_date)}
      </div>
    </Link>
  );
}

export default async function TripsPage() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const { data: trips } = await supabase
    .from('trips')
    .select('*')
    .eq('household_id', household.id);

  if (!trips?.length) {
    return <p className="muted">No trips yet. Ask Claude to plan one.</p>;
  }

  // Derived from dates rather than the stored `status` column — nothing in
  // the app ever transitions that column automatically, so it's stuck at
  // whatever it was set to on creation and can't be trusted for grouping.
  const today = new Date().toISOString().slice(0, 10);
  const active = trips.filter((t) => t.start_date <= today && today <= t.end_date);
  const planning = trips
    .filter((t) => t.start_date > today)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1)); // soonest first
  const past = trips
    .filter((t) => t.end_date < today)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1)); // most recent first

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {active.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Active</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map((trip) => (
              <TripCard key={trip.id} trip={trip} badge="Active" />
            ))}
          </div>
        </section>
      )}

      {planning.length > 0 && (
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 8 }}>Planning</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {planning.map((trip) => (
              <TripCard key={trip.id} trip={trip} badge="Planning" />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            Past ({past.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {past.map((trip) => (
              <TripCard key={trip.id} trip={trip} badge="Past" />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
