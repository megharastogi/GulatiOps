'use client';

import { useState, useTransition } from 'react';
import { regenerateConnector } from './actions';

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard is blocked in some browsers without a user gesture or
          // over http. The value is on screen either way, so say so rather
          // than failing silently.
          setCopied(false);
          window.prompt('Copy this:', value);
        }
      }}
      style={{ whiteSpace: 'nowrap' }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CopyRow({ value }: { value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <code
        style={{
          flex: '1 1 220px',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          fontSize: 13,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </code>
      <CopyButton value={value} />
    </div>
  );
}

export function ConnectorPanel({ hasToken }: { hasToken: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ url?: string; error?: string }>({});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {state.url ? (
        <>
          <CopyRow value={state.url} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Copy this now — it won&apos;t be shown again. Any previous link has
            stopped working.
          </p>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {hasToken
              ? 'Your link is stored encrypted, so it can’t be shown again. Generating a new one replaces the old.'
              : 'Generate a link, then paste it into Claude → Settings → Connectors.'}
          </p>
          <div>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setState(await regenerateConnector());
                })
              }
            >
              {pending
                ? 'Generating…'
                : hasToken
                  ? 'Generate a new link'
                  : 'Generate connector link'}
            </button>
          </div>
        </>
      )}
      {state.error && <p className="error">{state.error}</p>}
    </div>
  );
}
