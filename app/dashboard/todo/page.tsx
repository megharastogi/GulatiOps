import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';
import { markDone, addActionItem } from './actions';

export const dynamic = 'force-dynamic';

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export default async function TodoPage() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const { data: items } = await supabase
    .from('action_items')
    .select('*')
    .eq('household_id', household.id)
    .eq('status', 'open')
    .order('due_date', { ascending: true, nullsFirst: false });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form
        action={addActionItem}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <input
          type="text"
          name="title"
          placeholder="New action item"
          required
          style={{
            flex: '1 1 160px',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
        <input
          type="date"
          name="due_date"
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
        <button type="submit" className="btn">
          Add
        </button>
      </form>

      {items?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              className="card"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{item.title}</div>
                {(item.due_date || item.category) && (
                  <div className="muted" style={{ fontSize: 13 }}>
                    {item.due_date ? `Due ${formatDate(item.due_date)}` : null}
                    {item.due_date && item.category ? ' · ' : null}
                    {item.category && item.category !== 'other' ? item.category : null}
                  </div>
                )}
              </div>
              <form action={markDone.bind(null, item.id)}>
                <button type="submit" className="btn-secondary">
                  Done
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Nothing open.</p>
      )}
    </div>
  );
}
