<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import type { AnswerField, InputMode, ChallengeResult } from '$lib/types/index.js';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import MultipleChoice from '$lib/components/ui/MultipleChoice.svelte';
	import OpenText from '$lib/components/ui/OpenText.svelte';
	import YearInput from '$lib/components/ui/YearInput.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const teamColors: Record<string, string> = {
		blue: '#3b82f6', yellow: '#eab308', green: '#22c55e',
		red: '#ef4444', indigo: '#6366f1', black: '#1e293b'
	};
	const teamHex = $derived(teamColors[data.team.color] ?? '#ef4444');

	// ── Audio player ─────────────────────────────────────────────────────────
	let audio = $state<HTMLAudioElement | undefined>(undefined);
	let currentTime = $state(0);
	let duration = $state(0);
	let isPlaying = $state(false);

	const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const progressPct = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	const timeLabel = $derived(`${fmt(currentTime)} / ${fmt(duration || 0)}`);

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
	// Track bound values per field so we can gate the submit button for combobox
	let fieldValues = $state<Record<string, string>>({});
	let yearValue = $state(1990);
	let submitting = $state(false);

	const comboboxFields = $derived(
		data.variantFields.filter((f: AnswerField) => data.fieldModes[f] === 'combobox')
	);
	const canSubmit = $derived(
		!submitting &&
		comboboxFields.every((f: AnswerField) => (fieldValues[f] ?? '').length > 0)
	);

	// ── Result ───────────────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);
	const result = $derived<ChallengeResult | null>(
		f?.submitted ? (f.result as ChallengeResult) : (data.priorResult ?? null)
	);
	const formError = $derived<string | null>(f?.formError ?? null);
	const reviewError = $derived<string | null>(f?.reviewError ?? null);

	// Track which fields have had review requested in this page session
	let reviewedFields = $state<Set<string>>(new Set());
	$effect(() => {
		if (f?.reviewRequested && f.reviewedField) {
			reviewedFields.add(f.reviewedField);
		}
	});

	// ── Field label display ───────────────────────────────────────────────────
	const FIELD_LABELS: Record<AnswerField, string> = {
		artist: 'Artist', title: 'Title', year: 'Year',
		label: 'Record Label', festival: 'Festival', vocal_source: 'Vocal source'
	};

	function fieldLabel(f: AnswerField) { return FIELD_LABELS[f] ?? f; }

	// ── Review request expand state ───────────────────────────────────────────
	let reviewingField = $state<string | null>(null);
</script>

{#if result}
	<!-- ── Results screen ──────────────────────────────────────────────────── -->
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

		{#if reviewError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">
				{reviewError}
			</div>
		{/if}

		<div class="mb-6 rounded-2xl bg-zinc-900 p-5 space-y-1">
			{#each result.fields as fr, i}
				{@const isPartial = fr.score > 0 && fr.score < fr.maxScore}
				{@const isCorrect = fr.score === fr.maxScore}
				{@const isWrong = fr.score === 0}

				{#if i > 0}
					<div class="border-t border-zinc-800"></div>
				{/if}

				<div class="py-3">
					<div class="flex items-center justify-between">
						<div>
							<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
								{fieldLabel(fr.field)}
							</div>
							<div class="font-semibold">{fr.submitted || '—'}</div>
							{#if !isCorrect}
								<div class="text-xs text-zinc-500">Correct: {fr.correct}</div>
								{#if fr.fuzzyScore !== undefined}
									<div class="text-xs text-zinc-600">
										Match: {Math.round(fr.fuzzyScore * 100)}%
									</div>
								{/if}
							{/if}
						</div>
						<div class="text-right shrink-0 ml-4">
							<div
								class="text-xl font-black {isCorrect
									? 'text-green-400'
									: isPartial
										? 'text-yellow-400'
										: 'text-red-400'}"
							>
								{isCorrect ? '✓' : isPartial ? '~' : '✗'}
							</div>
							<div class="text-sm text-zinc-400">+{fr.score} / {fr.maxScore}</div>
						</div>
					</div>

					<!-- Review request (only for wrong open_text fields the player can dispute) -->
					{#if (isWrong || isPartial) && (data.fieldModes[fr.field] === 'open_text')}
						{@const alreadyRequested = reviewedFields.has(fr.field) || result.status === 'review_requested' || result.status === 'review_approved'}
						{#if alreadyRequested}
							<p class="mt-2 text-xs text-amber-400">Review requested ✓</p>
						{:else}
							<div class="mt-2">
								{#if reviewingField === fr.field}
									<form
										method="POST"
										action="?/requestReview"
										use:enhance={() => {
											return async ({ update }) => {
												reviewingField = null;
												await update();
											};
										}}
									>
										<input type="hidden" name="submission_id" value={result.submissionId} />
										<input type="hidden" name="team_id" value={data.team.id} />
										<input type="hidden" name="field_name" value={fr.field} />
										<textarea
											name="player_message"
											placeholder="Optional: explain why you think this is correct (leave blank to skip)"
											rows="2"
											class="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none"
										></textarea>
										<div class="flex gap-2">
											<button
												type="submit"
												class="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors hover:opacity-90"
												style="background-color: {teamHex};"
											>
												Send request
											</button>
											<button
												type="button"
												onclick={() => (reviewingField = null)}
												class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
											>
												Cancel
											</button>
										</div>
									</form>
								{:else}
									<button
										type="button"
										onclick={() => (reviewingField = fr.field)}
										class="text-xs font-medium underline underline-offset-2"
										style="color: {teamHex};"
									>
										Request manual review
									</button>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		<!-- Total score card -->
		<div
			class="mb-6 rounded-2xl border p-6 text-center"
			style="border-color: {teamHex}40; background-color: {teamHex}1a;"
		>
			<div class="mb-1 text-sm text-zinc-400">Total Score</div>
			<div class="tabular-nums text-6xl font-black text-white">{result.total}</div>
			<div class="mt-1 text-sm text-zinc-400">out of {result.maxTotal} pts</div>
		</div>

		<div class="text-center">
			<a
				href="/leaderboard"
				class="text-sm underline underline-offset-2"
				style="color: {teamHex};"
			>
				View leaderboard →
			</a>
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
							<path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
						</svg>
					{/if}
				</button>

				<div class="min-w-0 flex-1 space-y-1.5">
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

		<audio
			bind:this={audio}
			src={data.clipUrl}
			ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
			onloadedmetadata={() => (duration = audio?.duration ?? 0)}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
		></audio>

		{#if formError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">
				{formError}
			</div>
		{/if}

		<!-- Answer form -->
		<form
			method="POST"
			action="?/submit"
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

			{#each data.variantFields as field (field)}
				{@const mode = data.fieldModes[field] as InputMode}
				<div>
					<label class="mb-1.5 block text-sm font-semibold text-zinc-400">
						{fieldLabel(field)}
					</label>

					{#if mode === 'combobox'}
						<Combobox
							name={field}
							pool={data.pools[field] ?? []}
							{teamHex}
							bind:value={fieldValues[field]}
						/>
					{:else if mode === 'multiple_choice'}
						<MultipleChoice
							name={field}
							options={data.multipleChoiceOptions[field] ?? []}
							{teamHex}
							bind:value={fieldValues[field]}
						/>
					{:else if mode === 'open_text'}
						<OpenText name={field} {teamHex} />
					{:else if mode === 'slider'}
						<YearInput name={field} mode="slider" {teamHex} bind:value={yearValue} />
					{:else if mode === 'typeable_number'}
						<YearInput name={field} mode="typeable_number" {teamHex} bind:value={yearValue} />
					{/if}
				</div>
			{/each}

			<button
				type="submit"
				disabled={!canSubmit}
				class="w-full rounded-xl py-4 text-lg font-black uppercase tracking-widest text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				style="background-color: {teamHex};"
			>
				{submitting ? 'Submitting…' : 'Submit'}
			</button>

			{#if comboboxFields.length > 0 && !canSubmit && !submitting}
				<p class="text-center text-xs text-zinc-600">
					Select an artist from the list to enable submit
				</p>
			{/if}
		</form>
	</div>
{/if}
