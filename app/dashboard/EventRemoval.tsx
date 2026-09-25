'use client';

import { useState, useTransition } from 'react';
import { hideEvent } from './actions';

/**
 * The right-hand side of an event card: its details and a ✕, or — once the
 * ✕ is tapped — the confirm, shown in place of the details so nothing pops
 * over the page. There is no undo anywhere in the app for this, and the ✕
 * sits where a thumb scrolling the list lands, so one stray tap shouldn't be
 * enough. The date tile stays put either way, so it is still clear which
 * event you are about to remove.
 *
 * The details arrive as children so they keep rendering on the server.
 */
export default function EventRemoval({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <>
        <div className="grow">{children}</div>
        <button
          type="button"
          className="btn-ghost event-remove"
          onClick={() => setConfirming(true)}
          aria-label={`Remove "${title}" from calendar`}
          title="Remove from calendar"
        >
          ✕
        </button>
      </>
    );
  }

  return (
    <div
      className="grow"
      role="group"
      aria-label={`Remove "${title}"?`}
      onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
    >
      <div style={{ fontWeight: 600 }}>Remove this event?</div>
      <div className="muted" style={{ fontSize: 13 }}>
        {title}
      </div>
      <div className="event-confirm">
        <button
          type="button"
          className="btn btn-remove"
          disabled={pending}
          onClick={() => startTransition(() => hideEvent(id))}
        >
          {pending ? 'Removing…' : 'Remove'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          autoFocus
          onClick={() => setConfirming(false)}
        >
          Keep
        </button>
      </div>
    </div>
  );
}
