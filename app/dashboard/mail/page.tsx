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

export default async function MailPage() {
  const household = await getHousehold();
  const supabase = await createClient();

  const { data: emails } = await supabase
    .from('inbound_emails')
    .select(
      'id, from_name, from_address, subject, summary, classification, source_name, received_at, parsed_at, parse_error, body_text'
    )
    .eq('household_id', household.id)
    .order('received_at', { ascending: false })
    .limit(50);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 15, margin: '0 0 2px' }}>Mail</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Everything forwarded to this household, newest first. Open one to read
          the original — that&apos;s where a Gmail confirmation code shows up.
        </p>
      </div>

      {emails?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {emails.map((e) => (
            <details key={e.id} className="card">
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
