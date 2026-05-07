<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let showEmail = $state(false);
	let loading = $state(false);
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-1 text-4xl font-black tracking-tight text-amber-400">MixUp!</div>
			<div class="text-xs uppercase tracking-widest text-zinc-400">Host Admin</div>
		</div>

		<div class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
			{#if form?.error}
				<div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
					{form.error}
				</div>
			{/if}

			{#if (form as { sent?: boolean })?.sent}
				<div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
					Magic link sent to <strong>{(form as { email?: string })?.email}</strong>. Check your
					inbox.
				</div>
			{:else if !showEmail}
				<!-- Google sign-in -->
				<form
					method="POST"
					action="?/google"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							await update();
							loading = false;
						};
					}}
				>
					<button
						type="submit"
						disabled={loading}
						class="flex w-full items-center justify-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
					>
						<svg class="h-5 w-5" viewBox="0 0 24 24">
							<path
								fill="#4285F4"
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							/>
							<path
								fill="#34A853"
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							/>
							<path
								fill="#FBBC05"
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							/>
							<path
								fill="#EA4335"
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							/>
						</svg>
						Continue with Google
					</button>
				</form>

				<div class="flex items-center gap-3">
					<div class="h-px flex-1 bg-zinc-800"></div>
					<span class="text-xs text-zinc-600">or</span>
					<div class="h-px flex-1 bg-zinc-800"></div>
				</div>

				<button
					onclick={() => (showEmail = true)}
					class="w-full rounded-lg border border-zinc-700 px-4 py-3 text-sm text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
				>
					Continue with email
				</button>
			{:else}
				<!-- Email magic link -->
				<form
					method="POST"
					action="?/email"
					use:enhance={() => {
						loading = true;
						return async ({ update }) => {
							await update();
							loading = false;
						};
					}}
					class="space-y-3"
				>
					<div>
						<label for="email" class="mb-2 block text-xs uppercase tracking-widest text-zinc-400">
							Email
						</label>
						<input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							autofocus
							class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 focus:outline-none"
							placeholder="you@example.com"
						/>
					</div>

					<button
						type="submit"
						disabled={loading}
						class="w-full rounded-lg bg-amber-400 py-3 font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
					>
						{loading ? 'Sending…' : 'Send magic link'}
					</button>

					<button
						type="button"
						onclick={() => (showEmail = false)}
						class="w-full text-sm text-zinc-500 hover:text-zinc-300"
					>
						← Back
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>
