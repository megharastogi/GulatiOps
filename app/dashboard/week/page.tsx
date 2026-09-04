import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { getDigest, type SourceEmail } from '@/lib/digest';

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

/** Opens /dashboard/mail scrolled to that email, with its body expanded. */
function mailHref(emailId: string) {
  return `/dashboard/mail?open=${emailId}#email-${emailId}`;
}

/** Reads better than "Open the link" when we know what kind of thing it is. */
const DETAILS_LABEL: Record<string, string> = {
  volunteer: 'Sign up',
  form: 'Open the form',
  payment: 'Pay',
  rsvp: 'RSVP',
  supply: 'Open the list',
};

/**
 * `details_url` is a signup or form link the parser lifted out of forwarded
 * email — third-party text we're about to make tappable. Only http(s) gets
 * through: a `javascript:` href is a script that runs on tap, and `data:` is
 * a page we'd be rendering on our own origin. The host is shown next to the
 * label so you can see where a link goes before following it.
 */
function detailsLink(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { href: parsed.toString(), host: parsed.hostname.replace(/^www\./, '') };
  } catch {
    return null; // not a URL at all
  }
}

/**
 * What a card is actually about, and who said so. A title and a date alone
 * leave you guessing what "Spirit Day" asks of you, so the parser's own
 * description sits underneath and the email behind it is one tap away — the
 * answer to "wait, who said this and did I read it right?".
 *
 * A missing source isn't an error. Events lose theirs if the email is deleted
 * (`on delete set null`), and action items added through the todo form or the
 * MCP never had one.
 */
function Provenance({
  blurb,
  source,
  action,
}: {
  blurb?: string | null;
  source?: SourceEmail | null;
  action?: React.ReactNode;
}) {
  return (
    <>
      {blurb && <p className="blurb">{blurb}</p>}
      {action}
      {source && (
        <Link className="source-link" href={mailHref(source.id)}>
          {source.source_name || source.from_name || 'Original email'} ·{' '}
          {formatWhen(source.received_at)} →
        </Link>
      )}
    </>
  );
}

function EventCard({ event, showTime }: { event: any; showTime: boolean }) {
  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{event.title}</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {formatDate(event.start_date)}
        {showTime && event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}
        {event.location ? ` · ${event.location}` : ''}
      </div>
      <Provenance
        blurb={event.description || event.source_email?.summary}
        source={event.source_email}
      />
    </div>
  );
}

function ActionCard({ item }: { item: any }) {
  const due = dueLabel(item.due_date);
  const details = detailsLink(item.details_url);

  return (
    <div className="card">
      <div style={{ fontWeight: 600 }}>{item.title}</div>
      {due && (
        <div
          className={due.urgent ? undefined : 'muted'}
          style={{ fontSize: 13, color: due.urgent ? 'var(--danger)' : undefined }}
        >
          {due.text}
        </div>
      )}
      <Provenance
        blurb={item.description || item.source_email?.summary}
        source={item.source_email}
        action={
          // Opens away from the dashboard on purpose: in standalone PWA mode a
          // same-tab navigation to an outside site replaces the app with a
          // window that has no back button.
          details && (
            <div>
              <a
                className="btn-secondary details-link"
                href={details.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {DETAILS_LABEL[item.category] ?? 'Open the link'}{' '}
                <span className="details-host">{details.host} ↗</span>
              </a>
            </div>
          )
        }
      />
    </div>
  );
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
