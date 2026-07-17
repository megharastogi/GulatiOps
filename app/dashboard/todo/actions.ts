'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getHousehold } from '@/lib/household';

export async function markDone(id: string) {
  const supabase = createAdminClient();
  const household = await getHousehold();

  await supabase
    .from('action_items')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('id', id)
    .eq('household_id', household.id);

  revalidatePath('/dashboard/todo');
  revalidatePath('/dashboard');
}

export async function addActionItem(formData: FormData) {
  const title = String(formData.get('title') || '').trim();
  if (!title) return;

  const dueDate = String(formData.get('due_date') || '').trim();
  const supabase = createAdminClient();
  const household = await getHousehold();

  await supabase.from('action_items').insert({
    household_id: household.id,
    title,
    due_date: dueDate || null,
    priority: 'normal',
    category: 'other',
  });

  revalidatePath('/dashboard/todo');
  revalidatePath('/dashboard');
}
