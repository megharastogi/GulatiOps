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

/**
 * The connector is the one part of setup that happens in someone else's app,
 * so a bare URL and "paste it into Claude" left the hard half unexplained.
 * The steps run start to finish, with the link appearing inside step 4 where
 * it is actually used rather than above them as a loose credential.
 *
 * `examples` come from the server because they depend on which tools this
 * household has: suggesting "add milk to the groceries" to a family without
 * the groceries feature teaches them the app is broken.
 */
export function ConnectorPanel({
  hasToken,
  householdName,
  examples,
}: {
  hasToken: boolean;
  householdName: string;
  examples: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ url?: string; error?: string }>({});

  return (
    <ol className="steps">
      <li>
        <span className="step-title">Open Claude&apos;s connector settings</span>
        <span className="step-body">
          On a computer, go to{' '}
          <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer">
            claude.ai → Settings → Connectors
          </a>
          . This part is easier on a desktop browser than on a phone.
        </span>
      </li>

      <li>
        <span className="step-title">Choose &ldquo;Add custom connector&rdquo;</span>
        <span className="step-body">
          It&apos;s usually at the bottom of the connectors list, past the
          ready-made ones.
        </span>
      </li>

      <li>
        <span className="step-title">Name it</span>
        <span className="step-body">
          Anything you&apos;ll recognise — <code>{householdName}</code> works.
        </span>
      </li>

      <li>
        <span className="step-title">Paste this as the URL</span>
        {state.url ? (
          <>
            <CopyRow value={state.url} />
            <span className="step-body">
              Copy it now — it isn&apos;t shown again, and any previous link has
              just stopped working.
            </span>
          </>
        ) : (
          <>
            <span className="step-body">
              {hasToken
                ? 'A link already exists, but only a scrambled copy is stored, so it can’t be shown again. Generating a new one replaces it — do that if you no longer have it.'
                : 'Generate your link and it appears here.'}
            </span>
            <span>
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
            </span>
          </>
        )}
        {state.error && <span className="error">{state.error}</span>}
      </li>

      <li>
        <span className="step-title">Save, then switch it on in a chat</span>
        <span className="step-body">
          Start a new chat and enable the connector for it — usually the tools
          or attachments control near the message box. Claude only sees your
          household when it&apos;s switched on.
        </span>
      </li>

      <li>
        <span className="step-title">Try asking</span>
        <ul className="step-examples">
          {examples.map((e) => (
            <li key={e}>&ldquo;{e}&rdquo;</li>
          ))}
        </ul>
      </li>
    </ol>
  );
}
