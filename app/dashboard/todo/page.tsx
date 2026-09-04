import { createClient } from '@/lib/supabase/server';
import { getHousehold } from '@/lib/household';
import { SOURCE_EMAIL } from '@/lib/digest';
import { addActionItem } from './actions';
import { ActionCard } from '../cards';

export const dynamic = 'force-dynamic';

export default async function TodoPage() {
  const household = await getHousehold();
  // User-scoped client: reads go through the RLS policies rather than
  // relying on the .eq('household_id') filter below being remembered.
  const supabase = await createClient();

  const { data: items } = await supabase
    .from('action_items')
    .select(`*, ${SOURCE_EMAIL}`)
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
            <ActionCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <p className="muted">Nothing open.</p>
      )}
    </div>
  );
}
