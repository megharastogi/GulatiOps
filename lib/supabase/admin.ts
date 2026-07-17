import { createClient } from '@supabase/supabase-js';

// Service-role client for dashboard data queries. Never expose to the browser.
// Routes/pages that use this must sit behind the auth middleware.
export function createAdminClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
