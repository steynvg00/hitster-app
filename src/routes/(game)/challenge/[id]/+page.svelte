<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const teamColors: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#1e293b'
	};
	const teamHex = $derived(teamColors[data.team.color] ?? '#ef4444');

	// ── Audio player ─────────────────────────────────────────────────────────
	let audio = $state<HTMLAudioElement | undefined>(undefined);
	let currentTime = $state(0);
	let duration = $state(0);
	let isPlaying = $state(false);

	const fmt = (s: number) =>
		`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

	let progressPct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	let timeLabel = $derived(`${fmt(currentTime)} / ${fmt(duration || 0)}`);

	function togglePlay() {
		if (!audio) return;
		isPlaying ? audio.pause() : audio.play();
	}

	function seek(e: MouseEvent) {
		if (!audio || !duration) return;
		const bar = e.currentTarget as HTMLElement;
		const pct = (e.clientX - bar.getBoundingClientRect().left) / bar.clientWidth;
		audio.currentTime = Math.max(0, Math.min(1, pct)) * duration;
	}

	// ── Form state ───────────────────────────────────────────────────────────
	const artistOptions = $derived(
		data.answerOptions.filter((o) => o.field === 'artist').map((o) => o.value)
	);
	const titleOptions = $derived(
		data.answerOptions.filter((o) => o.field === 'title').map((o) => o.value)
	);

	let selectedYear = $state(1990);
	let submitting = $state(false);

	// ── Result resolution ────────────────────────────────────────────────────
	interface SubmitResult {
		score: number;
		breakdown: { artist: number; title: number; year: number };
		correct: { artist: string; title: string; year: number };
		answers: { artist: string; title: string; year: number };
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);
	let result = $derived<SubmitResult | null>(
		f?.submitted ? (f as SubmitResult) : (data.priorResult ?? null)
	);
	let formError = $derived<string | null>(f?.formError ?? null);
</script>

{#if result}
	<!-- ── Results screen ─────────────────────────────────────────��─────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pb-6 pt-4">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest text-white"
				style="background-color: {teamHex};"
			>
				{data.team.display_name}
			</span>
		</div>

		<h1 class="mb-1 text-2xl font-black">Results</h1>
		<p class="mb-6 text-sm text-zinc-400">{data.challenge.title}</p>

		<div class="mb-6 rounded-2xl bg-zinc-900 p-5">
			<!-- Artist -->
			<div class="flex items-center justify-between py-3">
				<div>
					<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
						Artist
					</div>
					<div class="font-semibold">{result.answers.artist}</div>
					{#if result.breakdown.artist === 0}
						<div class="text-xs text-zinc-500">Correct: {result.correct.artist}</div>
					{/if}
				</div>
				<div class="text-right">
					<div
						class="text-xl font-black {result.breakdown.artist > 0
							? 'text-green-400'
							: 'text-red-400'}"
					>
						{result.breakdown.artist > 0 ? '✓' : '✗'}
					</div>
					<div class="text-sm text-zinc-400">+{result.breakdown.artist} pts</div>
				</div>
			</div>

			<div class="border-t border-zinc-800"></div>

			<!-- Title -->
			<div class="flex items-center justify-between py-3">
				<div>
					<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
						Title
					</div>
					<div class="font-semibold">{result.answers.title}</div>
					{#if result.breakdown.title === 0}
						<div class="text-xs text-zinc-500">Correct: {result.correct.title}</div>
					{/if}
				</div>
				<div class="text-right">
					<div
						class="text-xl font-black {result.breakdown.title > 0
							? 'text-green-400'
							: 'text-red-400'}"
					>
						{result.breakdown.title > 0 ? '✓' : '✗'}
					</div>
					<div class="text-sm text-zinc-400">+{result.breakdown.title} pts</div>
				</div>
			</div>

			<div class="border-t border-zinc-800"></div>

			<!-- Year -->
			<div class="flex items-center justify-between py-3">
				<div>
					<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
						Year
					</div>
					<div class="font-semibold">{result.answers.year}</div>
					{#if result.breakdown.year < 10}
						<div class="text-xs text-zinc-500">Correct: {result.correct.year}</div>
					{/if}
				</div>
				<div class="text-right">
					<div
						class="text-xl font-black {result.breakdown.year === 10
							? 'text-green-400'
							: result.breakdown.year > 0
								? 'text-yellow-400'
								: 'text-red-400'}"
					>
						{result.breakdown.year === 10 ? '✓' : result.breakdown.year > 0 ? '~' : '✗'}
					</div>
					<div class="text-sm text-zinc-400">+{result.breakdown.year} pts</div>
				</div>
			</div>
		</div>

		<!-- Total score card -->
		<div class="mb-6 rounded-2xl border p-6 text-center" style="border-color: {teamHex}40; background-color: {teamHex}1a;">
			<div class="mb-1 text-sm text-zinc-400">Total Score</div>
			<div class="tabular-nums text-6xl font-black text-white">{result.score}</div>
			<div class="mt-1 text-sm text-zinc-400">out of 20 pts</div>
		</div>

		<div class="text-center">
			<a href="/leaderboard" class="text-sm underline underline-offset-2" style="color: {teamHex};"
				>View leaderboard →</a
			>
		</div>
	</div>
{:else}
	<!-- ── Challenge form ───────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pb-6 pt-4">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest text-white"
				style="background-color: {teamHex};"
			>
				{data.team.display_name}
			</span>
		</div>

		<h1 class="mb-6 text-2xl font-black">{data.challenge.title}</h1>

		<!-- Audio player card -->
		<div class="mb-6 rounded-2xl bg-zinc-900 p-5">
			<div class="flex items-center gap-4">
				<!-- Play / Pause button -->
				<button
					type="button"
					onclick={togglePlay}
					class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90"
					style="background-color: {teamHex};"
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					{#if isPlaying}
						<svg class="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 20 20">
							<rect x="5" y="4" width="3" height="12" rx="1" />
							<rect x="12" y="4" width="3" height="12" rx="1" />
						</svg>
					{:else}
						<svg class="ml-0.5 h-5 w-5 text-white" fill="currentColor" viewBox="0 0 20 20">
							<path
								d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
							/>
						</svg>
					{/if}
				</button>

				<div class="min-w-0 flex-1 space-y-1.5">
					<!-- Seek bar -->
					<button
						type="button"
						aria-label="Seek audio"
						class="relative block h-2 w-full cursor-pointer rounded-full bg-zinc-700"
						onclick={seek}
					>
						<div
							class="h-full rounded-full transition-all duration-100"
							style="background-color: {teamHex}; width: {progressPct}%"
						></div>
					</button>
					<div class="font-mono text-xs text-zinc-500">{timeLabel}</div>
				</div>
			</div>
		</div>

		<!-- Hidden HTML5 audio element -->
		<audio
			bind:this={audio}
			src={data.clipUrl}
			ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
			onloadedmetadata={() => (duration = audio?.duration ?? 0)}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
		></audio>

		<!-- Form error banner -->
		{#if formError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">
				{formError}
			</div>
		{/if}

		<!-- Answer form -->
		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="space-y-5"
		>
			<input type="hidden" name="team_id" value={data.team.id} />

			<!-- Artist dropdown -->
			<div>
				<label for="artist" class="mb-1.5 block text-sm font-semibold text-zinc-400">Artist</label>
				<select
					id="artist"
					name="artist"
					class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 transition-colors focus:border-red-500 focus:outline-none"
				>
					{#each artistOptions as opt}
						<option value={opt}>{opt}</option>
					{/each}
				</select>
			</div>

			<!-- Title dropdown -->
			<div>
				<label for="title" class="mb-1.5 block text-sm font-semibold text-zinc-400">Title</label>
				<select
					id="title"
					name="title"
					class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 transition-colors focus:border-red-500 focus:outline-none"
				>
					{#each titleOptions as opt}
						<option value={opt}>{opt}</option>
					{/each}
				</select>
			</div>

			<!-- Year slider -->
			<div>
				<label for="year-slider" class="mb-2 block text-sm font-semibold text-zinc-400"
					>Year</label
				>
				<div class="mb-3 text-center tabular-nums text-7xl font-black text-white">
					{selectedYear}
				</div>
				<input
					id="year-slider"
					type="range"
					name="year"
					min="1950"
					max="2025"
					value={selectedYear}
					oninput={(e) => (selectedYear = +(e.currentTarget as HTMLInputElement).value)}
					class="w-full"
					style="accent-color: {teamHex};"
				/>
				<div class="mt-1 flex justify-between text-xs text-zinc-600">
					<span>1950</span>
					<span>2025</span>
				</div>
			</div>

			<!-- Submit -->
			<button
				type="submit"
				disabled={submitting}
				class="w-full rounded-xl py-4 text-lg font-black uppercase tracking-widest text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				style="background-color: {teamHex};"
			>
				{submitting ? 'Submitting…' : 'Submit'}
			</button>
		</form>
	</div>
{/if}
