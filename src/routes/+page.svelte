<script lang="ts">
	// Dev nav — remove or replace before the party
	const CHALLENGE_ID = 'cccccccc-1111-1111-1111-000000000001';
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
	<h1 class="text-4xl font-black uppercase tracking-tight">Hitster</h1>
	<p class="text-sm text-zinc-500">Dev links (session 3 seed data)</p>
	<nav class="space-y-3">
		<div>
			<a
				href="/challenge/{CHALLENGE_ID}"
				class="block rounded-xl border border-red-600/40 bg-red-900/20 px-6 py-3 font-semibold text-red-400 transition-colors hover:bg-red-900/40"
			>
				→ Challenge: Round 1 — Normal Hitster
			</a>
		</div>
		<div>
			<a
				href="/leaderboard"
				class="block rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
			>
				→ Leaderboard
			</a>
		</div>
	</nav>
</div>
