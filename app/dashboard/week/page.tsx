import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { getDigest } from '@/lib/digest';
import { ActionCard, EventCard, daysUntil, formatDate, formatWhen, mailHref } from '../cards';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function WeekPage() {
  const household = await getHousehold();
  const supabase = await createClient();
  const digest = await getDigest(supabase, household.id);

  const { school_events_next_two_weeks: events, open_action_items: actions } = digest;
  const emails = digest.emails_past_week;

  // Split the fortnight so "this week" is genuinely this week.
  const thisWeek = events.filter((e: any) => daysUntil(e.start_date) <= 7);
  const later = events.filter((e: any) => daysUntil(e.start_date) > 7);

  const sectionStyle = { display: 'flex', flexDirection: 'column' as const, gap: 8 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 15, margin: '0 0 2px' }}>The week ahead</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {formatDate(digest.as_of)} · {actions.length} open{' '}
          {actions.length === 1 ? 'item' : 'items'} · {events.length} upcoming
        </p>
      </div>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Next 7 days</h3>
        {thisWeek.length ? (
          <div style={sectionStyle}>
            {thisWeek.map((e: any) => (
              <EventCard key={e.id} event={e} showTime />
            ))}
          </div>
        ) : (
          <p className="muted">Nothing on the school calendar this week.</p>
        )}
      </section>

      {later.length > 0 && (
        <section>
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>The week after</h3>
          <div style={sectionStyle}>
            {later.map((e: any) => (
              <EventCard key={e.id} event={e} showTime={false} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Still open</h3>
        {actions.length ? (
          <div style={sectionStyle}>
            {actions.map((a: any) => (
              <ActionCard key={a.id} item={a} />
            ))}
          </div>
        ) : (
          <p className="muted">Nothing open. Nice.</p>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Came in this week</h3>
        {emails.length ? (
          <div style={sectionStyle}>
            {emails.map((e: any) => (
              <Link key={e.id} href={mailHref(e.id)} className="card card-link">
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {e.source_name || e.from_name || 'Unknown sender'}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {e.summary || e.subject}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {formatWhen(e.received_at)}
                  {e.classification === 'action_required' ? ' · needs action' : ''}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">No email came in this week.</p>
        )}
      </section>
    </div>
  );
}
