// See https://svelte.dev/docs/kit/types#app.d.ts
import type { User } from '@supabase/supabase-js';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			teamId: string | null;
			isAdmin: boolean;
			playerId: string | null;
			user: User | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
