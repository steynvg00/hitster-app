import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Database } from '$lib/types/database';

// Singleton browser client — anon key, subject to RLS.
// Only use for client-side operations (realtime subscriptions, etc.).
// For server-side data fetching use createPublicClient() from $lib/server/supabase.
export const supabaseBrowser = createClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);
