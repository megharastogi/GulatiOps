'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';

export async function addGroceryItem(formData: FormData) {
  const itemName = String(formData.get('item_name') || '').trim();
  if (!itemName) return;
  const quantity = String(formData.get('quantity') || '').trim();

  const supabase = createAdminClient();
  const household = await getHousehold();

  await supabase.from('grocery_pending').insert({
    household_id: household.id,
    item_name: itemName,
    quantity: quantity || null,
    added_via: 'chat',
  });

  revalidatePath('/dashboard/groceries');
}

export async function removeGroceryItem(id: string) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  await supabase
    .from('grocery_pending')
    .delete()
    .eq('id', id)
    .eq('household_id', household.id);

  revalidatePath('/dashboard/groceries');
}

export async function clearGroceryList() {
  const supabase = createAdminClient();
  const household = await getHousehold();

  await supabase
    .from('grocery_pending')
    .update({ ordered: true, ordered_at: new Date().toISOString() })
    .eq('household_id', household.id)
    .eq('ordered', false);

  revalidatePath('/dashboard/groceries');
}
