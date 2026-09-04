import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';

export const dynamic = 'force-dynamic';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  action_required: 'Needs action',
  informational: 'Info',
  noise: 'Noise',
};

/**
 * `?open=<id>` comes from a card on /dashboard/week: land on this page with
 * that email already expanded and scrolled to, rather than on a list of fifty
 * subjects with no indication which one was meant.
 */
export default async function MailPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open: openId } = await searchParams;
  const household = await getHousehold();
  const supabase = await createClient();

  const COLUMNS =
    'id, from_name, from_address, subject, summary, classification, source_name, received_at, parsed_at, parse_error, body_text';

  const { data } = await supabase
    .from('inbound_emails')
    .select(COLUMNS)
    .eq('household_id', household.id)
    .order('received_at', { ascending: false })
    .limit(50);

  const emails = data ?? [];

  // The list stops at 50, but an event on /dashboard/week can cite an email
  // older than that — a June newsletter announcing a September date. Fetch the
  // linked one on its own and put it at the top, rather than sending the
  // browser to an anchor that isn't on the page.
  if (openId && !emails.some((e) => e.id === openId)) {
    const { data: linked } = await supabase
      .from('inbound_emails')
      .select(COLUMNS)
      .eq('household_id', household.id)
      .eq('id', openId)
      .maybeSingle();
    if (linked) emails.unshift(linked);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 15, margin: '0 0 2px' }}>Mail</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Everything forwarded to this household, newest first. Open one to read
          the original — that&apos;s where a Gmail confirmation code shows up.
        </p>
      </div>

      {emails.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {emails.map((e) => (
            <details
              key={e.id}
              id={`email-${e.id}`}
              className={e.id === openId ? 'card card--linked' : 'card'}
              open={e.id === openId}
            >
              <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                <div style={{ fontWeight: 600 }}>{e.subject || '(no subject)'}</div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {e.source_name || e.from_name || e.from_address}
                  {' · '}
                  {formatWhen(e.received_at)}
                  {e.classification ? ` · ${CLASSIFICATION_LABEL[e.classification] ?? e.classification}` : ''}
                  {!e.parsed_at && !e.parse_error ? ' · not parsed yet' : ''}
                </div>
                {e.summary && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {e.summary}
                  </div>
                )}
              </summary>

              {e.parse_error && (
                <p className="error" style={{ fontSize: 13 }}>
                  Couldn&apos;t parse this one. The original is still below.
                </p>
              )}

              {/* body_text only, never body_html — this is forwarded mail from
                  outside, and rendering its HTML here would run whatever it
                  contains. Plain text in a <pre> is inert. */}
              <pre
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 420,
                  overflowY: 'auto',
                }}
              >
                {e.body_text?.trim() || '(no plain-text version of this email)'}
              </pre>
            </details>
          ))}
        </div>
      ) : (
        <p className="muted">
          Nothing yet. Once you set up forwarding, mail shows up here within a
          minute or two.
        </p>
      )}
    </div>
  );
}
