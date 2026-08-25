'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTrip } from '../actions';

export default function DeleteTripButton({ tripId, destination }: { tripId: string; destination: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!window.confirm(`Delete the trip to "${destination}"? This removes all its days and activities and can't be undone.`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteTrip(tripId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.push('/dashboard/trips');
    });
  }

  return (
    <div>
      <button
        type="button"
        className="btn-ghost"
        style={{ color: 'var(--danger)', fontSize: 13 }}
        disabled={isPending}
        onClick={handleDelete}
      >
        {isPending ? 'Deleting…' : 'Delete trip'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
