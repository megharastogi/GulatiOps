import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { getDigest } from '@/lib/digest';

export const dynamic = 'force-dynamic';

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400_000);
}

/** Overdue and today read differently from "next week sometime". */
function dueLabel(dueDate: string | null) {
  if (!dueDate) return null;
  const days = daysUntil(dueDate);
  if (days < 0) return { text: `Overdue — was ${formatDate(dueDate)}`, urgent: true };
  if (days === 0) return { text: 'Due today', urgent: true };
  if (days === 1) return { text: 'Due tomorrow', urgent: true };
  return { text: `Due ${formatDate(dueDate)}`, urgent: false };
}

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
              <div key={e.id} className="card">
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(e.start_date)}
                  {e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ''}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
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
              <div key={e.id} className="card">
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatDate(e.start_date)}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Still open</h3>
        {actions.length ? (
          <div style={sectionStyle}>
            {actions.map((a: any) => {
              const due = dueLabel(a.due_date);
              return (
                <div key={a.id} className="card">
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  {due && (
                    <div
                      className={due.urgent ? undefined : 'muted'}
                      style={{
                        fontSize: 13,
                        color: due.urgent ? 'var(--danger)' : undefined,
                      }}
                    >
                      {due.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">Nothing open. Nice.</p>
        )}
      </section>

      <section>
        <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Came in this week</h3>
        {emails.length ? (
          <div style={sectionStyle}>
            {emails.map((e: any, i: number) => (
              <div key={i} className="card">
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
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No email came in this week.</p>
        )}
      </section>
    </div>
  );
}
