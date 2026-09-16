'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KidsPanel } from '@/app/dashboard/setup/KidsPanel';
import { ConnectorPanel, CopyRow } from '@/app/dashboard/setup/ConnectorPanel';
import { finishOnboarding } from './actions';
import type { Kid } from '@/lib/members';

const STEPS = ['Your kids', 'Forward your email', 'Connect Claude'];

/**
 * First run, once per household.
 *
 * Steps two and three import the setup page's own components rather than
 * restating them. That's the whole risk with a separate wizard — two places
 * explaining forwarding, drifting apart the first time one is edited — and
 * sharing the components is what removes it.
 */
export function Wizard({
  householdName,
  kids,
  forwardingAddress,
  hasToken,
  examples,
}: {
  householdName: string;
  kids: Kid[];
  forwardingAddress: string | null;
  hasToken: boolean;
  examples: string[];
}) {
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function leave() {
    startTransition(async () => {
      const result = await finishOnboarding();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Welcome, {householdName}</h1>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Step {step + 1} of {STEPS.length} — {STEPS[step]}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6 }} aria-hidden>
        {STEPS.map((label, i) => (
          <span
            key={label}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 2,
              background: i <= step ? 'var(--accent)' : 'var(--border)',
            }}
          />
        ))}
      </div>

      {step === 0 && (
        <section>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Tell us who the school email is about. Names, schools and grades all
            end up in the summaries, so a newsletter comes back as
            &ldquo;permission slip for Ada&rdquo; rather than something generic.
            Kids at different schools each get their own row.
          </p>
          {/* Advancing on save rather than on a separate Next means the step
              can't be left with typed-but-unsaved children. */}
          <KidsPanel
            initialKids={kids}
            submitLabel="Save and continue"
            onSaved={() => setStep(1)}
          />
        </section>
      )}

      {step === 1 && (
        <section>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            In Gmail, go to Settings → Forwarding and POP/IMAP → Add a
            forwarding address, and enter:
          </p>

          {forwardingAddress ? (
            <CopyRow value={forwardingAddress} />
          ) : (
            <p className="error" style={{ marginTop: 0 }}>
              No forwarding address is set up for this household yet. Ask Megha.
            </p>
          )}

          <p className="muted" style={{ fontSize: 13 }}>
            Gmail sends a confirmation code to that address. It won&apos;t reach
            your inbox — it lands in this app, under Mail. Read it there, paste
            it back into Gmail, then add a filter so school email forwards on its
            own.
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button type="button" className="btn" onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Lets you ask Claude about this household in plain English instead of
            opening the dashboard. Needs a paid Claude plan — Pro or above, and
            it&apos;s optional: everything here works without it.
          </p>
          <ConnectorPanel hasToken={hasToken} examples={examples} />
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Treat that link like a password — anyone who has it can read this
            household&apos;s email and to-dos.
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn" disabled={pending} onClick={leave}>
              {pending ? 'Finishing…' : 'Finish'}
            </button>
          </div>
        </section>
      )}

      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}

      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        <button
          type="button"
          className="btn-ghost"
          style={{ padding: 0 }}
          disabled={pending}
          onClick={leave}
        >
          I&apos;ll do this later
        </button>{' '}
        — it&apos;s all on the Setup page too.
      </p>
    </div>
  );
}
