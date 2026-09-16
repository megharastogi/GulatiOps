'use client';

import { useState, useTransition } from 'react';
import { saveKids, removeKid } from './actions';
import { GRADES, ageOn, type Kid } from '@/lib/members';

// Row identity for React only. Saved rows key off their database id; new ones
// need something stable from the moment "Add another child" is clicked, and a
// counter avoids crypto.randomUUID's secure-context requirement.
let nextKey = 0;
type Row = Kid & { key: string };

function toRow(kid: Kid): Row {
  return { ...kid, key: kid.id ?? `new-${nextKey++}` };
}

function blankRow(): Row {
  return { key: `new-${nextKey++}`, name: '', school: '', grade: '', birthdate: '' };
}

const FIELD: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 150px' }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span className="muted" style={{ fontSize: 11 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Add and edit the household's children. Lives on the setup page and inside
 * the first-run wizard, which is why it takes its labels as props rather than
 * assuming either context.
 *
 * Date of birth rather than age, on purpose: the age shown beside the field is
 * derived, so it stays right next August instead of quietly ageing into a
 * false statement inside the email parser's prompt.
 */
export function KidsPanel({
  initialKids,
  submitLabel = 'Save',
  onSaved,
}: {
  initialKids: Kid[];
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    initialKids.length ? initialKids.map(toRow) : [blankRow()]
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const today = new Date().toISOString().slice(0, 10);

  function update(key: string, patch: Partial<Kid>) {
    setSaved(false);
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }

  function drop(row: Row) {
    setSaved(false);
    // An unsaved row is only ever in React state, so nothing to delete.
    if (!row.id) {
      setRows((current) => {
        const left = current.filter((r) => r.key !== row.key);
        return left.length ? left : [blankRow()];
      });
      return;
    }

    if (!window.confirm(`Remove ${row.name || 'this child'}?`)) return;

    startTransition(async () => {
      const result = await removeKid(row.id!);
      if (result.error) setError(result.error);
      else {
        setError(null);
        setRows(result.kids?.length ? result.kids.map(toRow) : [blankRow()]);
      }
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveKids(rows.map(({ key, ...kid }) => kid));
      // The server hands back real ids, so the next save updates these rows
      // instead of inserting a second copy of every child.
      if (result.kids) setRows(result.kids.length ? result.kids.map(toRow) : [blankRow()]);
      setError(result.error ?? null);
      if (!result.error) {
        setSaved(true);
        onSaved?.();
      }
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <datalist id="grade-options">
        {GRADES.map((grade) => (
          <option key={grade} value={grade} />
        ))}
      </datalist>

      {rows.map((row) => {
        const age = row.birthdate ? ageOn(row.birthdate, today) : null;
        return (
          <div key={row.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Name">
                <input
                  style={FIELD}
                  value={row.name}
                  placeholder="First name"
                  onChange={(e) => update(row.key, { name: e.target.value })}
                />
              </Field>
              <Field label="School">
                <input
                  style={FIELD}
                  value={row.school ?? ''}
                  placeholder="Which school they go to"
                  onChange={(e) => update(row.key, { school: e.target.value })}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Grade">
                <input
                  style={FIELD}
                  list="grade-options"
                  value={row.grade ?? ''}
                  placeholder="e.g. 2nd"
                  onChange={(e) => update(row.key, { grade: e.target.value })}
                />
              </Field>
              <Field
                label="Date of birth"
                hint={age !== null ? `${age} years old` : 'Their age is worked out from this.'}
              >
                <input
                  style={{ ...FIELD, colorScheme: 'light dark' }}
                  type="date"
                  max={today}
                  value={row.birthdate ?? ''}
                  onChange={(e) => update(row.key, { birthdate: e.target.value })}
                />
              </Field>
            </div>

            <div>
              <button
                type="button"
                className="btn-ghost"
                style={{ padding: 0 }}
                disabled={pending}
                onClick={() => drop(row)}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() => {
            setSaved(false);
            setRows((current) => [...current, blankRow()]);
          }}
        >
          Add another child
        </button>
        <button type="button" className="btn" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        {saved && !pending ? (
          <span className="muted" style={{ fontSize: 13 }}>
            Saved.
          </span>
        ) : null}
      </div>

      {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}
