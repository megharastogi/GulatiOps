import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';
import { addGroceryItem, removeGroceryItem, clearGroceryList } from './actions';

export const dynamic = 'force-dynamic';

export default async function GroceriesPage() {
  const household = await getHousehold();
  const supabase = createAdminClient();

  const { data: items } = await supabase
    .from('grocery_pending')
    .select('*')
    .eq('household_id', household.id)
    .eq('ordered', false)
    .order('added_at', { ascending: false });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <form action={addGroceryItem} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          name="item_name"
          placeholder="Item"
          required
          style={{
            flex: '1 1 140px',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
        <input
          type="text"
          name="quantity"
          placeholder="Qty (optional)"
          style={{
            flex: '0 1 120px',
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
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item) => (
              <div
                key={item.id}
                className="card"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.item_name}</div>
                  {item.quantity && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {item.quantity}
                    </div>
                  )}
                </div>
                <form action={removeGroceryItem.bind(null, item.id)}>
                  <button type="submit" className="btn-ghost">
                    Remove
                  </button>
                </form>
              </div>
            ))}
          </div>

          <form action={clearGroceryList}>
            <button type="submit" className="btn-secondary" style={{ width: '100%' }}>
              Mark all as ordered
            </button>
          </form>
        </>
      ) : (
        <p className="muted">Nothing pending.</p>
      )}
    </div>
  );
}
