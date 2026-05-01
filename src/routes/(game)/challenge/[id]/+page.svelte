<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import type { AnswerField, InputMode, ChallengeResult } from '$lib/types/index.js';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import MultipleChoice from '$lib/components/ui/MultipleChoice.svelte';
	import OpenText from '$lib/components/ui/OpenText.svelte';
	import YearInput from '$lib/components/ui/YearInput.svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const teamColors: Record<string, string> = {
		blue: '#3b82f6', yellow: '#eab308', green: '#22c55e',
		red: '#ef4444', indigo: '#6366f1', black: '#1e293b'
	};
	const teamHex = $derived(teamColors[data.team.color] ?? '#ef4444');

	// ── Draft persistence (localStorage) ─────────────────────────────────────
	// draft[trackId][field] = value; persists across page refreshes
	const DRAFT_KEY = `hitster_draft_${data.team.id}_${data.challenge.id}`;

	function loadDraft(): Record<string, Record<string, string>> {
		if (typeof localStorage === 'undefined') return {};
		try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}'); } catch { return {}; }
	}

	const savedDraft = loadDraft();

	// Per-track string field state (all fields except year)
	let allFieldValues = $state<Record<string, string>[]>(
		data.challengeTracks.map((ct) => {
			const saved = savedDraft[ct.trackId] ?? {};
			return Object.fromEntries(data.variantFields.map((f: AnswerField) => [f, saved[f] ?? '']));
		})
	);

	// Year is numeric — bindable as number, stored separately
	const hasYear = data.variantFields.includes('year' as AnswerField);
	let allYearValues = $state<number[]>(
		data.challengeTracks.map((ct) => {
			const saved = savedDraft[ct.trackId] ?? {};
			return parseInt(saved['year'] ?? '1990', 10);
		})
	);

	// Persist to localStorage on any state change
	$effect(() => {
		const d: Record<string, Record<string, string>> = {};
		for (let i = 0; i < data.challengeTracks.length; i++) {
			d[data.challengeTracks[i].trackId] = {
				...allFieldValues[i],
				...(hasYear ? { year: String(allYearValues[i]) } : {})
			};
		}
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
		}
	});

	function buildAnswersForSubmit(): Record<string, Record<string, string>> {
		const d: Record<string, Record<string, string>> = {};
		for (let i = 0; i < data.challengeTracks.length; i++) {
			d[data.challengeTracks[i].trackId] = {
				...allFieldValues[i],
				...(hasYear ? { year: String(allYearValues[i]) } : {})
			};
		}
		return d;
	}

	// ── Multi-track tab state ─────────────────────────────────────────────────
	let activeTrackIndex = $state(0);
	const activeTrack = $derived(data.challengeTracks[activeTrackIndex]);
	const isMultiTrack = $derived(data.challengeTracks.length > 1);

	// ── Audio player ─────────────────────────────────────────────────────────
	let audio = $state<HTMLAudioElement | undefined>(undefined);
	let currentTime = $state(0);
	let duration = $state(0);
	let isPlaying = $state(false);

	$effect(() => {
		// Reset playback state when switching tracks
		const _ = activeTrack;
		currentTime = 0;
		duration = 0;
		isPlaying = false;
	});

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

	// ── Timer ─────────────────────────────────────────────────────────────────
	let timerMs = $state<number | null>(null);

	function fmtMs(ms: number): string {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	// ── Form + auto-submit ────────────────────────────────────────────────────
	let formEl = $state<HTMLFormElement | undefined>(undefined);
	let submitting = $state(false);

	function triggerSubmit() {
		if (submitting || result) return;
		submitting = true;
		formEl?.requestSubmit();
	}

	onMount(() => {
		if (!data.timerEndsAt) return;
		const update = () => {
			const remaining = Math.max(0, data.timerEndsAt! - Date.now());
			timerMs = remaining;
			if (remaining === 0 && !result && !submitting) triggerSubmit();
		};
		update();
		const iv = setInterval(update, 500);
		return () => clearInterval(iv);
	});

	// ── Result (declared before canSubmit so it can be referenced) ───────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);
	const result = $derived<ChallengeResult | null>(
		f?.submitted ? (f.result as ChallengeResult) : (data.priorResult ?? null)
	);

	// ── Validation ────────────────────────────────────────────────────────────
	const comboboxFields = $derived(
		data.variantFields.filter((f: AnswerField) => data.fieldModes[f] === 'combobox')
	);

	const canSubmit = $derived(
		!submitting &&
		!result &&
		(timerMs === null || timerMs > 0) &&
		data.challengeTracks.every((_, i) =>
			comboboxFields.every((f: AnswerField) => (allFieldValues[i]?.[f] ?? '').length > 0)
		)
	);
	const formError = $derived<string | null>(f?.formError ?? null);
	const reviewError = $derived<string | null>(f?.reviewError ?? null);

	let resultTrackIndex = $state(0);
	const resultTrack = $derived(result?.tracks[resultTrackIndex] ?? null);

	let reviewedKeys = $state<Set<string>>(new Set()); // `${trackId}:${field}`
	$effect(() => {
		if (f?.reviewRequested && f.reviewedField) reviewedKeys.add(f.reviewedField);
	});

	// ── Field label display ───────────────────────────────────────────────────
	const FIELD_LABELS: Record<AnswerField, string> = {
		artist: 'Artist', title: 'Title', year: 'Year',
		label: 'Record Label', festival: 'Festival', vocal_source: 'Vocal source'
	};
	function fieldLabel(field: AnswerField) { return FIELD_LABELS[field] ?? field; }

	let reviewingKey = $state<string | null>(null); // `${trackId}:${field}`

	// ── Live result (realtime submissions subscription) ───────────────────────
	let liveScore = $state<number | null>(null);
	let liveStatus = $state<string | null>(null);
	let reviewJustResolved = $state(false);
	let pointsAwarded = $state(0);

	$effect(() => {
		const submissionId = result?.submissionId;
		if (!submissionId) return;

		liveScore = result!.total;
		liveStatus = result!.status;
		reviewJustResolved = false;
		pointsAwarded = 0;

		const channel = supabaseBrowser
			.channel(`submission-${submissionId}`)
			.on('postgres_changes', {
				event: 'UPDATE', schema: 'public', table: 'submissions',
				filter: `id=eq.${submissionId}`
			}, async () => {
				const { data: sub } = await supabaseBrowser
					.from('submissions').select('score, status').eq('id', submissionId).single();
				if (sub) {
					const oldScore = liveScore ?? 0;
					liveScore = sub.score ?? liveScore;
					liveStatus = sub.status;
					if (sub.status === 'review_approved' || sub.status === 'review_rejected') {
						reviewJustResolved = true;
						pointsAwarded = (sub.score ?? 0) - oldScore;
					}
				}
			})
			.subscribe();

		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

{#if result}
	<!-- ── Results screen ──────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pb-6 pt-4">
			<span class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest text-white"
				style="background-color: {teamHex};">
				{data.team.display_name}
			</span>
		</div>

		<h1 class="mb-1 text-2xl font-black">Results</h1>
		<p class="mb-4 text-sm text-zinc-400">{data.challenge.title}</p>

		{#if reviewError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">{reviewError}</div>
		{/if}

		{#if reviewJustResolved && liveStatus === 'review_approved'}
			<div class="mb-4 rounded-xl border border-green-600/50 bg-green-900/30 p-3 text-sm text-green-300">
				✓ Review approved{pointsAwarded > 0 ? ` — +${pointsAwarded} points added!` : ''}
			</div>
		{:else if reviewJustResolved && liveStatus === 'review_rejected'}
			<div class="mb-4 rounded-xl border border-zinc-600/50 bg-zinc-800/60 p-3 text-sm text-zinc-400">
				Review rejected — your original score stands.
			</div>
		{/if}

		<!-- Track tabs (multi-track only) -->
		{#if result.tracks.length > 1}
			<div class="mb-4 flex gap-1 overflow-x-auto pb-1">
				{#each result.tracks as tr, i}
					<button type="button" onclick={() => (resultTrackIndex = i)}
						class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
							{resultTrackIndex === i ? 'text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
						style={resultTrackIndex === i ? `background-color: ${teamHex};` : ''}>
						Track {tr.trackIndex}
						<span class="ml-1 text-xs opacity-70">{tr.total}/{tr.maxTotal}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if resultTrack}
			<div class="mb-6 rounded-2xl bg-zinc-900 p-5 space-y-1">
				{#each resultTrack.fields as fr, i}
					{@const isPartial = fr.score > 0 && fr.score < fr.maxScore}
					{@const isCorrect = fr.score === fr.maxScore}
					{@const isWrong = fr.score === 0}
					{@const reviewKey = `${resultTrack.trackId}:${fr.field}`}

					{#if i > 0}<div class="border-t border-zinc-800"></div>{/if}

					<div class="py-3">
						<div class="flex items-center justify-between">
							<div>
								<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{fieldLabel(fr.field)}</div>
								<div class="font-semibold">{fr.submitted || '—'}</div>
								{#if !isCorrect}
									<div class="text-xs text-zinc-500">Correct: {fr.correct}</div>
									{#if fr.fuzzyScore !== undefined}
										<div class="text-xs text-zinc-600">Match: {Math.round(fr.fuzzyScore * 100)}%</div>
									{/if}
								{/if}
							</div>
							<div class="ml-4 shrink-0 text-right">
								<div class="text-xl font-black {isCorrect ? 'text-green-400' : isPartial ? 'text-yellow-400' : 'text-red-400'}">
									{isCorrect ? '✓' : isPartial ? '~' : '✗'}
								</div>
								<div class="text-sm text-zinc-400">+{fr.score} / {fr.maxScore}</div>
							</div>
						</div>

						{#if (isWrong || isPartial) && data.fieldModes[fr.field] === 'open_text'}
							{@const effectiveStatus = liveStatus ?? result.status}
							{@const alreadyRequested = reviewedKeys.has(reviewKey) || effectiveStatus === 'review_requested' || effectiveStatus === 'review_approved' || effectiveStatus === 'review_rejected'}
							{#if alreadyRequested}
								<p class="mt-2 text-xs text-amber-400">Review requested ✓</p>
							{:else}
								<div class="mt-2">
									{#if reviewingKey === reviewKey}
										<form method="POST" action="?/requestReview"
											use:enhance={() => async ({ update }) => { reviewingKey = null; await update(); }}>
											<input type="hidden" name="submission_id" value={result.submissionId} />
											<input type="hidden" name="team_id" value={data.team.id} />
											<input type="hidden" name="field_name" value={fr.field} />
											<input type="hidden" name="track_id" value={resultTrack.trackId} />
											<textarea name="player_message"
												placeholder="Optional: explain why you think this is correct"
												rows="2"
												class="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none">
											</textarea>
											<div class="flex gap-2">
												<button type="submit"
													class="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors hover:opacity-90"
													style="background-color: {teamHex};">
													Send request
												</button>
												<button type="button" onclick={() => (reviewingKey = null)}
													class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
													Cancel
												</button>
											</div>
										</form>
									{:else}
										<button type="button" onclick={() => (reviewingKey = reviewKey)}
											class="text-xs font-medium underline underline-offset-2"
											style="color: {teamHex};">
											Request manual review
										</button>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="mb-6 rounded-2xl border p-6 text-center"
			style="border-color: {teamHex}40; background-color: {teamHex}1a;">
			<div class="mb-1 text-sm text-zinc-400">Total Score</div>
			<div class="tabular-nums text-6xl font-black text-white">{liveScore ?? result.total}</div>
			<div class="mt-1 text-sm text-zinc-400">out of {result.maxTotal} pts</div>
		</div>

		<div class="text-center">
			<a href="/leaderboard" class="text-sm underline underline-offset-2" style="color: {teamHex};">
				View leaderboard →
			</a>
		</div>
	</div>
{:else}
	<!-- ── Challenge form ───────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="flex items-center justify-between pb-6 pt-4">
			<span class="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest text-white"
				style="background-color: {teamHex};">
				{data.team.display_name}
			</span>

			{#if timerMs !== null}
				<span class="font-mono text-sm font-bold tabular-nums
					{timerMs < 30_000 ? 'text-red-400' : timerMs < 60_000 ? 'text-yellow-400' : 'text-zinc-400'}">
					{fmtMs(timerMs)}
				</span>
			{/if}
		</div>

		<h1 class="mb-4 text-2xl font-black">{data.challenge.title}</h1>

		<!-- Track tabs (multi-track only) -->
		{#if isMultiTrack}
			<div class="mb-4 flex gap-1 overflow-x-auto pb-1">
				{#each data.challengeTracks as _ct, i}
					<button type="button" onclick={() => (activeTrackIndex = i)}
						class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors
							{activeTrackIndex === i ? 'text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
						style={activeTrackIndex === i ? `background-color: ${teamHex};` : ''}>
						Track {i + 1}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Audio player -->
		<div class="mb-6 rounded-2xl bg-zinc-900 p-5">
			<div class="flex items-center gap-4">
				<button type="button" onclick={togglePlay}
					class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90"
					style="background-color: {teamHex};"
					aria-label={isPlaying ? 'Pause' : 'Play'}>
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
					<button type="button" aria-label="Seek audio"
						class="relative block h-2 w-full cursor-pointer rounded-full bg-zinc-700"
						onclick={seek}>
						<div class="h-full rounded-full transition-all duration-100"
							style="background-color: {teamHex}; width: {progressPct}%"></div>
					</button>
					<div class="font-mono text-xs text-zinc-500">{timeLabel}</div>
				</div>
			</div>
		</div>

		<audio bind:this={audio} src={activeTrack?.clipUrl}
			ontimeupdate={() => (currentTime = audio?.currentTime ?? 0)}
			onloadedmetadata={() => (duration = audio?.duration ?? 0)}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}>
		</audio>

		{#if formError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">{formError}</div>
		{/if}

		{#if timerMs === 0}
			<div class="mb-4 rounded-xl border border-amber-600/50 bg-amber-900/30 p-3 text-sm text-amber-300">
				Time's up — submitting your answers…
			</div>
		{/if}

		<form bind:this={formEl} method="POST" action="?/submit"
			use:enhance={({ formData }) => {
				submitting = true;
				formData.set('answers_json', JSON.stringify(buildAnswersForSubmit()));
				return async ({ update }) => { await update(); submitting = false; };
			}}
			class="space-y-5">
			<input type="hidden" name="team_id" value={data.team.id} />

			<!-- {#key} forces components to remount when switching tracks, so inputText resets correctly -->
			{#key activeTrackIndex}
				{#each data.variantFields as field (field)}
					{@const mode = data.fieldModes[field] as InputMode}
					<div>
						<label class="mb-1.5 block text-sm font-semibold text-zinc-400">{fieldLabel(field)}</label>

						{#if mode === 'combobox'}
							<Combobox
								name={field}
								pool={data.pools[field] ?? []}
								{teamHex}
								bind:value={allFieldValues[activeTrackIndex][field]}
							/>
						{:else if mode === 'multiple_choice'}
							<MultipleChoice
								name={field}
								options={data.multipleChoiceOptions[field] ?? []}
								{teamHex}
								bind:value={allFieldValues[activeTrackIndex][field]}
							/>
						{:else if mode === 'open_text'}
							<OpenText name={field} {teamHex} bind:value={allFieldValues[activeTrackIndex][field]} />
						{:else if mode === 'slider'}
							<YearInput name={field} mode="slider" {teamHex} bind:value={allYearValues[activeTrackIndex]} />
						{:else if mode === 'typeable_number'}
							<YearInput name={field} mode="typeable_number" {teamHex} bind:value={allYearValues[activeTrackIndex]} />
						{/if}
					</div>
				{/each}
			{/key}

			<button type="submit" disabled={!canSubmit}
				class="w-full rounded-xl py-4 text-lg font-black uppercase tracking-widest text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				style="background-color: {teamHex};">
				{submitting ? 'Submitting…' : 'Submit'}
			</button>

			{#if comboboxFields.length > 0 && !canSubmit && !submitting}
				<p class="text-center text-xs text-zinc-600">Fill in all fields to enable submit</p>
			{/if}
		</form>
	</div>
{/if}
