'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { requestMagicLink } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending} style={{ width: '100%' }}>
      {pending ? 'Sending…' : 'Send magic link'}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(requestMagicLink, {});

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>GulatiOps</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 14 }}>
          Sign in with a magic link.
        </p>

        {state.sent ? (
          <p>Check your email for a sign-in link. You can close this tab.</p>
        ) : (
          <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="email"
              name="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
              }}
            />
            <SubmitButton />
            {state.error && <p className="error">{state.error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
