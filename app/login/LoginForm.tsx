'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { requestMagicLink, verifyCode } from './actions';

const inputStyle = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
};

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending} style={{ width: '100%' }}>
      {pending ? busy : idle}
    </button>
  );
}

// Second step: the email has gone out with both a link and a code. The link
// is for a browser; the code is for the home screen app, where a link would
// open Safari and sign the wrong thing in.
function CodeForm({ email, onRestart }: { email: string; onRestart: () => void }) {
  const [state, formAction] = useFormState(verifyCode, { sent: true, email });

  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0 }}>
        We emailed <strong>{email}</strong> a sign-in link and a code. Tap the link, or enter the
        code here.
      </p>
      <input type="hidden" name="email" value={email} />
      <input
        type="text"
        name="token"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={10}
        placeholder="Code"
        required
        autoFocus
        style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, textAlign: 'center' }}
      />
      <SubmitButton idle="Sign in" busy="Signing in…" />
      {state.error && <p className="error">{state.error}</p>}
      <button type="button" className="btn-ghost" onClick={onRestart}>
        Use a different email or send a new code
      </button>
    </form>
  );
}

export default function LoginForm({ notice }: { notice?: string }) {
  // Remounting the email step is the simplest way back to a blank form: its
  // useFormState has no reset, and a stale `sent` would skip straight past it.
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="card" style={{ width: '100%', maxWidth: 360 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>GulatiOps</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 14 }}>
        Sign in with your email.
      </p>
      <EmailStep key={attempt} notice={notice} onRestart={() => setAttempt((n) => n + 1)} />
    </div>
  );
}

function EmailStep({ notice, onRestart }: { notice?: string; onRestart: () => void }) {
  const [state, formAction] = useFormState(requestMagicLink, {});

  if (state.sent && state.email) {
    return <CodeForm email={state.email} onRestart={onRestart} />;
  }

  return (
    <>
      {notice && (
        <p className="error" style={{ marginTop: 0 }}>
          {notice}
        </p>
      )}
      <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
          style={inputStyle}
        />
        <SubmitButton idle="Email me a sign-in code" busy="Sending…" />
        {state.error && <p className="error">{state.error}</p>}
      </form>
    </>
  );
}
