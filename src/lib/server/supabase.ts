import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';
import type { Database } from '$lib/types/database';

/**
 * Public client — anon key, subject to RLS.
 * Call this in +page.server.ts load functions and +server.ts routes.
 * Requires `cookies` from the SvelteKit request event so Supabase can
 * read/write auth session cookies if we add auth later.
 */
export function createPublicClient(cookies: Cookies) {
	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});
}

/**
 * Admin client — service role key, bypasses RLS entirely.
 * Server-only. Use for: scoring submissions, updating team scores,
 * managing challenges/tracks/clips from the admin panel.
 * Never pass this client to the browser or expose its key.
 */
export function createAdminClient() {
	return createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
