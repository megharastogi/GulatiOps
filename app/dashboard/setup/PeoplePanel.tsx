'use client';

import { useState, useTransition } from 'react';
import { addLogin, removeLogin, type Login } from './actions';

const FIELD: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
};

/**
 * Who can sign in to this household.
 *
 * Everyone listed here has the same access once they're in, so the list is
 * flat — no roles to pick, no permissions to reason about. The only asymmetry
 * is that the owner has no Remove button, because a household that deletes its
 * own last login can't get back in without database access.
 */
export function PeoplePanel({
  initialLogins,
  signInUrl,
}: {
  initialLogins: Login[];
  signInUrl: string;
}) {
  const [logins, setLogins] = useState<Login[]>(initialLogins);
  const [email, setEmail] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    if (!email.trim()) return;
    startTransition(async () => {
      const result = await addLogin(email);
      if (result.logins) setLogins(result.logins);
      setError(result.error ?? null);
      if (!result.error) {
        setAdded(email.trim().toLowerCase());
        setEmail('');
      }
    });
  }

  function drop(login: Login) {
    if (!window.confirm(`Remove ${login.email}? They lose access immediately.`)) return;

    startTransition(async () => {
      const result = await removeLogin(login.id);
      if (result.logins) setLogins(result.logins);
      setError(result.error ?? null);
      if (!result.error) setAdded(null);
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {logins.map((login) => (
        <div
          key={login.id}
          className="card"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ wordBreak: 'break-all' }}>{login.email}</div>
            <span className="muted" style={{ fontSize: 12 }}>
              {login.role === 'owner' ? 'Owner · ' : ''}
              {login.claimed_at ? 'has signed in' : 'hasn’t signed in yet'}
            </span>
          </div>

          {login.role === 'owner' ? (
            <span className="muted" style={{ fontSize: 12 }}>
              Can&apos;t be removed
            </span>
          ) : (
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: 0 }}
              disabled={pending}
              onClick={() => drop(login)}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Their email address
          </span>
          <input
            style={FIELD}
            type="email"
            value={email}
            placeholder="name@example.com"
            disabled={pending}
            onChange={(e) => {
              setEmail(e.target.value);
              setAdded(null);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </label>
        <button type="button" className="btn" disabled={pending || !email.trim()} onClick={add}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {added ? (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Added. Nothing was emailed to them — tell them to go to {signInUrl} and
          sign in with <strong>{added}</strong>.
        </p>
      ) : null}

      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
