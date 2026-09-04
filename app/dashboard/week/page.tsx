import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { getDigest } from '@/lib/digest';
import { buildBrief, briefToText } from '@/lib/brief';
import BriefCard from './BriefCard';
import { ActionCard, EventDays, daysUntil, formatDate, formatWhen, mailHref } from '../cards';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function WeekPage() {
  const household = await getHousehold();
  const supabase = await createClient();
  const digest = await getDigest(supabase, household.id);

  const { school_events_next_two_weeks: events, open_action_items: actions } = digest;
  const emails = digest.emails_past_week;
  const brief = buildBrief(digest);

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

      {!brief.isEmpty && <BriefCard brief={brief} text={briefToText(brief, household.name)} />}

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>This week</h3>
        {thisWeek.length ? (
          <EventDays events={thisWeek} />
        ) : (
          <p className="muted">Nothing on the school calendar this week.</p>
        )}
      </section>

      {later.length > 0 && (
        <section>
          <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Looking ahead</h3>
          <EventDays events={later} />
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Open items</h3>
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

      <details className="week-mail">
        <summary>
          Came in this week
          <span className="muted"> · {emails.length}</span>
        </summary>
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
      </details>
    </div>
  );
}
