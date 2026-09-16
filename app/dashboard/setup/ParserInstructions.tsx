'use client';

import { useState, useTransition } from 'react';
import { saveParserInstructions } from './actions';
import { INSTRUCTIONS_MAX } from '@/lib/household-settings';

/**
 * Free text the household writes about itself, handed to the parser with
 * every email it reads.
 *
 * Deliberately not in the first-run wizard: a family on day one has no idea
 * yet what they want skipped. This is where they come back once a week of
 * mail has shown them.
 */
export function ParserInstructions({ initial }: { initial: string | null }) {
  const [text, setText] = useState(initial ?? '');
  const [state, setState] = useState<{ saved?: boolean; error?: string }>({});
  const [pending, startTransition] = useTransition();

  const over = text.trim().length > INSTRUCTIONS_MAX;
  const dirty = text.trim() !== (initial ?? '').trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        value={text}
        rows={4}
        placeholder={'We skip PTA fundraisers.\nThe after-school program emails are just reminders — no tasks from those.'}
        onChange={(e) => {
          setText(e.target.value);
          setState({});
        }}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          border: `1px solid ${over ? 'var(--danger)' : 'var(--border)'}`,
          background: 'var(--bg)',
          color: 'var(--text)',
          resize: 'vertical',
          lineHeight: 1.5,
        }}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn"
          disabled={pending || over || !dirty}
          onClick={() =>
            startTransition(async () => {
              setState(await saveParserInstructions(text));
            })
          }
        >
          {pending ? 'Saving…' : 'Save'}
        </button>

        {/* Only counts once it's close, so the field isn't nagging at you
            while you write two normal sentences. */}
        {text.trim().length > INSTRUCTIONS_MAX * 0.75 ? (
          <span className={over ? 'error' : 'muted'} style={{ fontSize: 13 }}>
            {text.trim().length} / {INSTRUCTIONS_MAX}
          </span>
        ) : null}

        {state.saved && !dirty ? (
          <span className="muted" style={{ fontSize: 13 }}>
            Saved.
          </span>
        ) : null}
      </div>

      {state.error ? <p className="error" style={{ margin: 0 }}>{state.error}</p> : null}
    </div>
  );
}
