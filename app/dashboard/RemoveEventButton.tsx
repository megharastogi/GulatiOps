'use client';

import { useTransition } from 'react';
import { hideEvent } from './actions';

/**
 * Takes an event off the calendar after a confirm. Unlike a task's checkbox
 * there is no undo anywhere in the app for this, and the target sits where a
 * thumb scrolling the list lands, so one stray tap shouldn't be enough.
 */
export default function RemoveEventButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm(`Remove "${title}" from your calendar?`)) return;
    startTransition(() => hideEvent(id));
  }

  return (
    <button
      type="button"
      className="btn-ghost event-remove"
      onClick={remove}
      disabled={pending}
      aria-label={`Remove "${title}" from calendar`}
      title="Remove from calendar"
    >
      {pending ? '…' : '✕'}
    </button>
  );
}
