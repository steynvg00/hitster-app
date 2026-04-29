<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
	<div class="w-full max-w-sm">
		<div class="text-center mb-8">
			<div class="text-4xl font-black tracking-tight text-amber-400 mb-1">HITSTER</div>
			<div class="text-zinc-400 text-sm uppercase tracking-widest">Host Admin</div>
		</div>

		<form method="POST" use:enhance class="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
			{#if form?.error}
				<div class="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3">
					{form.error}
				</div>
			{/if}

			<div>
				<label for="password" class="block text-xs text-zinc-400 uppercase tracking-widest mb-2">
					Password
				</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
					placeholder="Host password"
				/>
			</div>

			<button
				type="submit"
				class="w-full bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold py-3 rounded-lg transition-colors"
			>
				Enter Admin
			</button>
		</form>
	</div>
</div>
