<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import type { AnswerField, InputMode, ChallengeResult } from '$lib/types/index.js';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import MultipleChoice from '$lib/components/ui/MultipleChoice.svelte';
	import OpenText from '$lib/components/ui/OpenText.svelte';
	import YearInput from '$lib/components/ui/YearInput.svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Waveform from '$lib/components/ui/Waveform.svelte';
	import BonusTracker from '$lib/components/game/BonusTracker.svelte';
	import TutorialOverlay from '$lib/components/game/TutorialOverlay.svelte';
	import HeldPowerups from '$lib/components/game/HeldPowerups.svelte';
	import ActiveEffectsBanner from '$lib/components/game/ActiveEffectsBanner.svelte';
	import PowerupRevealModal from '$lib/components/game/PowerupRevealModal.svelte';
	import { getTypeIcon, getTypeColor } from '$lib/variants';

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

	// ── Draft (localStorage) ──────────────────────────────────────────────────
	// New shape: Record<tabPosition, SlotDraft[]>
	// SlotDraft = { fieldValues: Record<string, string>, fragments?: number[] }
	const DRAFT_KEY = `hitster_draft_${data.team.id}_${data.challenge.id}`;

	type SlotDraft = { fieldValues: Record<string, string>; fragments?: number[] };

	function loadDraft(): Record<string, SlotDraft[]> {
		if (typeof localStorage === 'undefined') return {};
		try {
			const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
			// Detect and discard old shape (keyed by track UUID, not tab position)
			const keys = Object.keys(raw);
			if (keys.length > 0 && keys[0].includes('-') && keys[0].length === 36) {
				localStorage.removeItem(DRAFT_KEY);
				return {};
			}
			return raw;
		} catch {
			return {};
		}
	}

	const savedDraft = loadDraft();

	const variantFields = data.variantFields as AnswerField[];
	const hasYear = variantFields.includes('year' as AnswerField);
	const hasGrouping = variantFields.includes('grouping' as AnswerField);
	const isFragments = data.challenge.variant === 'fragments';
	const isMashup = data.challenge.variant === 'mashup';
	const isEffects = data.challenge.variant === 'effects';
	const isMultiSource = isFragments || isMashup;

	// ── Field state: per-tab, per-slot ───────────────────────────────────────
	// allDrafts[tabIdx][slotIdx].fieldValues[field]
	let allDrafts = $state<SlotDraft[][]>(
		data.tabs.map((tab) => {
			const tabDraft = savedDraft[String(tab.position)] ?? [];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			return Array.from({ length: slotCount }, (_, si) => {
				const saved = tabDraft[si] ?? { fieldValues: {} };
				return {
					fieldValues: Object.fromEntries(
						variantFields
							.filter((f) => f !== 'year' && f !== 'grouping')
							.map((f) => [f, saved.fieldValues?.[f] ?? ''])
					),
					fragments: saved.fragments ?? []
				};
			});
		})
	);

	// Year values: per-tab, per-slot
	let allYearValues = $state<number[][]>(
		data.tabs.map((tab) => {
			const tabDraft = savedDraft[String(tab.position)] ?? [];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			return Array.from({ length: slotCount }, (_, si) => {
				const y = parseInt(tabDraft[si]?.fieldValues?.['year'] ?? '1990', 10);
				return isNaN(y) ? 1990 : y;
			});
		})
	);

	// Multi-artist collab: per-tab, per-slot
	const hasArtistCombobox = $derived(
		variantFields.includes('artist' as AnswerField) && data.fieldModes['artist'] === 'combobox'
	);
	let collabArtists = $state<string[][][]>(
		data.tabs.map((tab) => {
			const tabDraft = savedDraft[String(tab.position)] ?? [];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			return Array.from({ length: slotCount }, (_, si) => {
				const saved = tabDraft[si]?.fieldValues?.['artist'] ?? '';
				return saved ? saved.split(' & ') : [''];
			});
		})
	);

	function addArtistSlot(tabIdx: number, slotIdx: number) {
		if (collabArtists[tabIdx][slotIdx].length < 3) {
			collabArtists[tabIdx][slotIdx] = [...collabArtists[tabIdx][slotIdx], ''];
		}
	}
	function removeArtistSlot(tabIdx: number, slotIdx: number, artistIdx: number) {
		collabArtists[tabIdx][slotIdx] = collabArtists[tabIdx][slotIdx].filter(
			(_, i) => i !== artistIdx
		);
		if (collabArtists[tabIdx][slotIdx].length === 0) collabArtists[tabIdx][slotIdx] = [''];
		allDrafts[tabIdx][slotIdx].fieldValues['artist'] = collabArtists[tabIdx][slotIdx]
			.filter(Boolean)
			.join(' & ');
	}

	// Fragment chip toggle
	function toggleFragment(tabIdx: number, slotIdx: number, fragNum: number) {
		const frags = allDrafts[tabIdx][slotIdx].fragments ?? [];
		if (frags.includes(fragNum)) {
			allDrafts[tabIdx][slotIdx].fragments = frags.filter((n) => n !== fragNum);
		} else {
			allDrafts[tabIdx][slotIdx].fragments = [...frags, fragNum].sort((a, b) => a - b);
		}
	}

	// Persist draft to localStorage on any state change
	$effect(() => {
		const d: Record<string, SlotDraft[]> = {};
		for (let ti = 0; ti < data.tabs.length; ti++) {
			const tab = data.tabs[ti];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			d[String(tab.position)] = Array.from({ length: slotCount }, (_, si) => {
				const artistVal = hasArtistCombobox
					? (collabArtists[ti]?.[si]?.filter((a) => a.trim()).join(' & ') ?? '')
					: (allDrafts[ti]?.[si]?.fieldValues['artist'] ?? '');
				return {
					fieldValues: {
						...allDrafts[ti]?.[si]?.fieldValues,
						...(hasArtistCombobox ? { artist: artistVal } : {}),
						...(hasYear ? { year: String(allYearValues[ti]?.[si] ?? 1990) } : {})
					},
					fragments: allDrafts[ti]?.[si]?.fragments
				};
			});
		}
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
		}
	});

	function buildAnswersForSubmit(): Record<string, SlotDraft[]> {
		const d: Record<string, SlotDraft[]> = {};
		for (let ti = 0; ti < data.tabs.length; ti++) {
			const tab = data.tabs[ti];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			d[String(tab.position)] = Array.from({ length: slotCount }, (_, si) => {
				const artistVal = hasArtistCombobox
					? (collabArtists[ti]?.[si]?.filter((a) => a.trim()).join(' & ') ?? '')
					: (allDrafts[ti]?.[si]?.fieldValues['artist'] ?? '');
				return {
					fieldValues: {
						...allDrafts[ti]?.[si]?.fieldValues,
						...(hasArtistCombobox ? { artist: artistVal } : {}),
						...(hasYear ? { year: String(allYearValues[ti]?.[si] ?? 1990) } : {})
					},
					fragments: allDrafts[ti]?.[si]?.fragments
				};
			});
		}
		return d;
	}

	// ── Tab state ─────────────────────────────────────────────────────────────
	let activeTabIndex = $state(0);
	const activeTab = $derived(data.tabs[activeTabIndex]);
	const isMultiTab = $derived(data.tabs.length > 1);
	// Answer slot tabs (mashup + fragments only)
	let activeSlotIndex = $state(0);

	// ── Audio player ──────────────────────────────────────────────────────────
	let waveformRef = $state<Waveform | undefined>(undefined);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	// For fragments: which clip index is active in the current tab
	let activeClipIndex = $state(0);

	const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const timeLabel = $derived(`${fmt(currentTime)} / ${fmt(duration || 0)}`);

	function togglePlay() {
		waveformRef?.playPause();
	}

	// Reset clip + slot index when tab changes
	$effect(() => {
		void activeTabIndex;
		activeClipIndex = 0;
		activeSlotIndex = 0;
		isPlaying = false;
	});

	// ── Powerup state ─────────────────────────────────────────────────────────
	let timerBoostMs = $state(0);
	let freeAnswerReveals = $state<Record<string, string>>({ ...data.freeAnswerReveal });

	function onPowerupActivated(revealedValue?: string, revealedField?: string) {
		if (!revealedField || !revealedValue) return;
		freeAnswerReveals = { ...freeAnswerReveals, [revealedField]: revealedValue };
		// Pre-fill the draft for all tabs/slots
		for (let ti = 0; ti < data.tabs.length; ti++) {
			const slotCount = allDrafts[ti]?.length ?? 1;
			for (let si = 0; si < slotCount; si++) {
				if (allDrafts[ti]?.[si]) {
					allDrafts[ti][si].fieldValues[revealedField] = revealedValue;
				}
			}
		}
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
	let startingChallenge = $state(false);

	function triggerSubmit() {
		if (submitting || result) return;
		submitting = true;
		formEl?.requestSubmit();
	}

	onMount(() => {
		let iv: ReturnType<typeof setInterval> | undefined;

		if (data.timerEndsAt) {
			const update = () => {
				const remaining = Math.max(0, data.timerEndsAt! + timerBoostMs - Date.now());
				timerMs = remaining;
				if (remaining === 0 && !result && !submitting) triggerSubmit();
			};
			update();
			iv = setInterval(update, 500);
		}

		// Time-boost realtime: team_effects INSERT fires when a held powerup is activated
		const effectsBoostChannel = supabaseBrowser
			.channel(`challenge-time-boost-${data.team.id}-${data.challenge.id}`)
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'team_effects', filter: `team_id=eq.${data.team.id}` },
				(payload) => {
					const row = payload.new as { effect_type: string; payload: Record<string, unknown> };
					if (row.effect_type === 'time_boost') {
						const p = row.payload as { added_seconds?: number; challenge_id?: string };
						if (p.challenge_id === data.challenge.id) {
							timerBoostMs += (p.added_seconds ?? 30) * 1000;
						}
					}
				}
			)
			.subscribe();

		const attemptChannel = supabaseBrowser
			.channel(`attempt-${data.challenge.id}-${data.team.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'challenge_attempts',
					filter: `challenge_id=eq.${data.challenge.id}`
				},
				(payload) => {
					const updated = payload.new as { team_id: string; ended_at: string | null };
					// Guard !submitting: the server sets ended_at during action processing,
					// before the HTTP response arrives. Reloading here would wipe the action
					// result (including earnedPowerup) before the enhance callback can apply it.
					if (updated.team_id === data.team.id && updated.ended_at && !result && !submitting)
						window.location.reload();
				}
			)
			.subscribe();

		const submissionInsertChannel = supabaseBrowser
			.channel(`sub-insert-${data.challenge.id}-${data.team.id}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'submissions',
					filter: `challenge_id=eq.${data.challenge.id}`
				},
				(payload) => {
					const newSub = payload.new as { team_id: string; is_final: boolean };
					// Same guard as attemptChannel — don't reload if we're currently submitting.
					if (newSub.team_id === data.team.id && newSub.is_final && !result && !submitting)
						window.location.reload();
				}
			)
			.subscribe();

		let setChannel: ReturnType<typeof supabaseBrowser.channel> | null = null;
		if (data.activeSetId) {
			setChannel = supabaseBrowser
				.channel(`challenge-set-${data.activeSetId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'game_sets',
						filter: `id=eq.${data.activeSetId}`
					},
					(payload) => {
						if ((payload.new as { recap_state: string | null }).recap_state) {
							goto(`/play/waiting?set_id=${data.activeSetId}`);
						}
					}
				)
				.subscribe();
		}

		return () => {
			if (iv) clearInterval(iv);
			supabaseBrowser.removeChannel(effectsBoostChannel);
			supabaseBrowser.removeChannel(attemptChannel);
			supabaseBrowser.removeChannel(submissionInsertChannel);
			if (setChannel) supabaseBrowser.removeChannel(setChannel);
		};
	});

	// ── Result ────────────────────────────────────────────────────────────────
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);
	const result = $derived<ChallengeResult | null>(
		f?.submitted ? (f.result as ChallengeResult) : (data.priorResult ?? null)
	);

	// ── Powerup reveal modal ──────────────────────────────────────────────────
	type EarnedPowerup = { teamPowerupId: string; type: { id: string; name: string; icon: string | null; description: string | null; holdable: boolean; immediate_use: boolean } };
	let showPowerupModal = $state(false);
	let currentEarnedPowerup = $state<EarnedPowerup | null>(null);

	$effect(() => {
		if (f?.earnedPowerup && f.earnedPowerup.teamPowerupId && f.earnedPowerup.type) {
			currentEarnedPowerup = f.earnedPowerup as EarnedPowerup;
			showPowerupModal = true;
		}
	});

	// ── Validation ────────────────────────────────────────────────────────────
	const canSubmit = $derived(!submitting && !result);
	const formError = $derived<string | null>(f?.formError ?? null);
	const reviewError = $derived<string | null>(f?.reviewError ?? null);

	let resultTabIndex = $state(0);
	const resultTab = $derived(result?.tabs?.[resultTabIndex] ?? null);
	// Legacy flat result for simple display when tabs not present
	const resultTrack = $derived(result?.tracks?.[resultTabIndex] ?? null);

	let reviewedKeys = $state<Set<string>>(new Set());
	$effect(() => {
		if (f?.reviewRequested && f.reviewedField) reviewedKeys.add(f.reviewedField);
	});

	// ── Hint modal ────────────────────────────────────────────────────────────
	let showHintModal = $state(data.showHint && !!data.challenge.hint_text);

	// ── Tutorial overlay ──────────────────────────────────────────────────────
	let showTutorial = $state(false);
	const tutorialEntry = $derived(
		data.tutorialText ? [{ variant: data.challenge.variant, tutorial_text: data.tutorialText }] : []
	);

	onMount(() => {
		if (data.tutorialText && data.team?.id && data.attempt) {
			const key = `tutorial_seen_${data.team.id}_${data.challenge.variant}`;
			if (!localStorage.getItem(key)) {
				showTutorial = true;
				localStorage.setItem(key, '1');
			}
		}
	});

	$effect(() => {
		if (
			!data.attempt &&
			!result &&
			data.challenge.status === 'active' &&
			data.tutorialText &&
			data.team?.id &&
			typeof localStorage !== 'undefined'
		) {
			localStorage.setItem(`tutorial_seen_${data.team.id}_${data.challenge.variant}`, '1');
		}
	});

	// ── Field labels ──────────────────────────────────────────────────────────
	const FIELD_LABELS: Record<string, string> = {
		artist: 'Artist',
		title: 'Title',
		year: 'Year',
		label: 'Record Label',
		festival: 'Festival',
		grouping: 'Which fragments?'
	};
	function fieldLabel(field: AnswerField) {
		return FIELD_LABELS[field as string] ?? field;
	}

	let reviewingKey = $state<string | null>(null);

	const TypeIcon = $derived(getTypeIcon(data.challenge.variant));
	const typeColor = $derived(getTypeColor(data.challenge.variant));

	// ── Live result (realtime submissions subscription) ───────────────────────
	let liveScore = $state<number | null>(null);
	let animatedScore = $state(0);
	let liveStatus = $state<string | null>(null);
	let reviewJustResolved = $state(false);
	let pointsAwarded = $state(0);

	$effect(() => {
		const submissionId = result?.submissionId;
		if (!submissionId) return;

		liveScore = result!.breakdown?.final ?? result!.total;
		liveStatus = result!.status;
		reviewJustResolved = false;
		pointsAwarded = 0;

		const channel = supabaseBrowser
			.channel(`submission-${submissionId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'submissions',
					filter: `id=eq.${submissionId}`
				},
				async () => {
					const { data: sub } = await supabaseBrowser
						.from('submissions')
						.select('score, status')
						.eq('id', submissionId)
						.single();
					if (sub) {
						const oldScore = liveScore ?? 0;
						liveScore = sub.score ?? liveScore;
						liveStatus = sub.status;
						if (sub.status === 'review_approved' || sub.status === 'review_rejected') {
							reviewJustResolved = true;
							pointsAwarded = (sub.score ?? 0) - oldScore;
						}
					}
				}
			)
			.subscribe();

		return () => supabaseBrowser.removeChannel(channel);
	});

	$effect(() => {
		const target = liveScore ?? 0;
		if (target === 0) {
			animatedScore = 0;
			return;
		}
		const from = animatedScore;
		const dur = Math.min(1400, 400 + Math.abs(target - from) * 8);
		const startTime = performance.now();
		let rafId: number;
		const tick = (now: number) => {
			const p = Math.min((now - startTime) / dur, 1);
			const eased = 1 - Math.pow(1 - p, 3);
			animatedScore = Math.round(from + (target - from) * eased);
			if (p < 1) rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});
</script>

{#if showTutorial && tutorialEntry.length > 0}
	<TutorialOverlay
		tutorials={tutorialEntry}
		onclose={() => (showTutorial = false)}
		primaryLabel="Start"
	/>
{/if}

{#if showPowerupModal && currentEarnedPowerup}
	<PowerupRevealModal
		teamPowerupId={currentEarnedPowerup.teamPowerupId}
		type={currentEarnedPowerup.type}
		onclose={() => { showPowerupModal = false; currentEarnedPowerup = null; }}
	/>
{/if}

{#if showHintModal && data.challenge.hint_text}
	<div
		class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		onclick={() => (showHintModal = false)}
	>
		<div
			class="w-full max-w-lg rounded-t-3xl border-t border-zinc-700 bg-zinc-900 px-6 py-8 pb-10"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-center gap-3">
				<span class="text-2xl">💡</span>
				<h2 class="text-lg font-black text-white">Hint</h2>
				<span class="ml-auto text-xs text-zinc-500">{data.challenge.title}</span>
			</div>
			<p class="text-base leading-relaxed text-zinc-200">{data.challenge.hint_text}</p>
			<button
				onclick={() => (showHintModal = false)}
				class="mt-6 w-full rounded-xl py-3 text-sm font-bold transition-colors"
				style="background-color: {teamHex}22; color: {teamHex}; border: 1px solid {teamHex}44;"
				>Got it</button
			>
		</div>
	</div>
{/if}

{#if result}
	<!-- ── Results screen ──────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pt-4 pb-6">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
				style="background-color: {teamHex};">{data.team.display_name}</span
			>
		</div>
		<h1 class="mb-1 text-2xl font-black">Results</h1>
		<p class="mb-4 text-sm text-zinc-400">{data.challenge.title}</p>

		{#if reviewError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">
				{reviewError}
			</div>
		{/if}
		{#if reviewJustResolved && liveStatus === 'review_approved'}
			<div
				class="mb-4 rounded-xl border border-green-600/50 bg-green-900/30 p-3 text-sm text-green-300"
			>
				✓ Review approved{pointsAwarded > 0 ? ` — +${pointsAwarded} points added!` : ''}
			</div>
		{:else if reviewJustResolved && liveStatus === 'review_rejected'}
			<div
				class="mb-4 rounded-xl border border-zinc-600/50 bg-zinc-800/60 p-3 text-sm text-zinc-400"
			>
				Review rejected — your original score stands.
			</div>
		{/if}

		<!-- Tab tabs (multi-tab) -->
		{#if (result.tabs?.length ?? 0) > 1}
			<div class="mb-4 flex gap-1 overflow-x-auto pb-1">
				{#each result.tabs ?? [] as tr, i}
					<button
						type="button"
						onclick={() => (resultTabIndex = i)}
						class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors {resultTabIndex ===
						i
							? 'text-white'
							: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
						style={resultTabIndex === i ? `background-color: ${teamHex};` : ''}
					>
						Tab {tr.tabIndex} <span class="ml-1 text-xs opacity-70">{tr.total}/{tr.maxTotal}</span>
					</button>
				{/each}
			</div>
		{/if}

		<!-- Per-tab results (use slots within tab) -->
		{#if resultTab}
			{#each resultTab.slots as slot, slotIdx (slotIdx)}
				{#if slotIdx > 0}
					<div class="mb-3 flex items-center gap-2 text-xs text-zinc-500">
						<div class="h-px flex-1 bg-zinc-800"></div>
						<span>Slot {slotIdx + 1}</span>
						<div class="h-px flex-1 bg-zinc-800"></div>
					</div>
				{/if}
				<div class="mb-4 space-y-1 rounded-2xl bg-zinc-900 p-5">
					{#each slot.fields as fr, i}
						{@const isPartial = fr.score > 0 && fr.score < fr.maxScore}
						{@const isCorrect = fr.score === fr.maxScore}
						{@const reviewKey = `tab_${resultTab.tabPosition}_slot_${slot.slotIndex}_${fr.field}`}

						{#if i > 0}<div class="border-t border-zinc-800"></div>{/if}
						<div class="py-3">
							<div class="flex items-center justify-between">
								<div>
									<div class="mb-0.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
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
								<div class="ml-4 shrink-0 text-right">
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

							{#if (fr.score === 0 || isPartial) && data.fieldModes[fr.field] === 'open_text'}
								{@const effectiveStatus = liveStatus ?? result.status}
								{@const alreadyRequested =
									reviewedKeys.has(reviewKey) ||
									effectiveStatus === 'review_requested' ||
									effectiveStatus === 'review_approved' ||
									effectiveStatus === 'review_rejected'}
								{#if alreadyRequested}
									<p class="mt-2 text-xs text-amber-400">Review requested ✓</p>
								{:else}
									<div class="mt-2">
										{#if reviewingKey === reviewKey}
											<form
												method="POST"
												action="?/requestReview"
												use:enhance={() =>
													async ({ update }) => {
														reviewingKey = null;
														await update();
													}}
											>
												<input type="hidden" name="submission_id" value={result.submissionId} />
												<input type="hidden" name="team_id" value={data.team.id} />
												<input type="hidden" name="field_name" value={reviewKey} />
												<input type="hidden" name="track_id" value={slot.matchedTrackId ?? ''} />
												<textarea
													name="player_message"
													placeholder="Optional: explain why you think this is correct"
													rows="2"
													class="mb-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none"
												></textarea>
												<div class="flex gap-2">
													<button
														type="submit"
														class="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors hover:opacity-90"
														style="background-color: {teamHex};">Send request</button
													>
													<button
														type="button"
														onclick={() => (reviewingKey = null)}
														class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
														>Cancel</button
													>
												</div>
											</form>
										{:else}
											<button
												type="button"
												onclick={() => (reviewingKey = reviewKey)}
												class="text-xs font-medium underline underline-offset-2"
												style="color: {teamHex};">Request manual review</button
											>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		{:else if resultTrack}
			<!-- Fallback: old flat result -->
			<div class="mb-6 space-y-1 rounded-2xl bg-zinc-900 p-5">
				{#each resultTrack.fields as fr, i}
					{@const isCorrect = fr.score === fr.maxScore}
					{@const isPartial = fr.score > 0 && fr.score < fr.maxScore}
					{#if i > 0}<div class="border-t border-zinc-800"></div>{/if}
					<div class="py-3">
						<div class="flex items-center justify-between">
							<div>
								<div class="mb-0.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
									{fieldLabel(fr.field)}
								</div>
								<div class="font-semibold">{fr.submitted || '—'}</div>
								{#if !isCorrect}<div class="text-xs text-zinc-500">Correct: {fr.correct}</div>{/if}
							</div>
							<div class="ml-4 shrink-0 text-right">
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
					</div>
				{/each}
			</div>
		{/if}

		{#if result.breakdown}
			<BonusTracker breakdown={result.breakdown} teamColor={teamHex} />
		{/if}

		<div
			class="mb-6 rounded-2xl border p-6 text-center"
			style="border-color: {teamHex}40; background-color: {teamHex}1a;"
		>
			<div class="mb-1 text-sm text-zinc-400">Total Score</div>
			<div class="text-6xl font-black text-white tabular-nums transition-none">{animatedScore}</div>
			{#if result.breakdown && result.breakdown.base !== result.breakdown.final}
				<div class="mt-1 text-xs text-zinc-500">{result.breakdown.base} base pts</div>
			{:else}
				<div class="mt-1 text-sm text-zinc-400">out of {result.maxTotal} pts</div>
			{/if}
		</div>

		<div class="flex flex-col items-center gap-3">
			<a
				href="/team"
				class="w-full rounded-xl py-3 text-center text-sm font-bold text-zinc-950"
				style="background-color: {teamHex};"
			>
				Back to team console
			</a>
			<a href="/leaderboard" class="text-sm underline underline-offset-2" style="color: {teamHex};"
				>View leaderboard →</a
			>
		</div>
	</div>
{:else if !data.attempt && data.challenge.status !== 'active'}
	<!-- ── Challenge ended ────────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pt-4 pb-6">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
				style="background-color: {teamHex};">{data.team.display_name}</span
			>
		</div>
		<h1 class="mb-6 text-2xl font-black">{data.challenge.title}</h1>
		<div class="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
			<p class="text-lg font-semibold text-zinc-200">This challenge has ended</p>
			<p class="text-sm text-zinc-500">
				The host has closed this challenge. Head back to your team page.
			</p>
			<a
				href="/team"
				class="mt-2 inline-block text-sm underline underline-offset-2"
				style="color: {teamHex};">Back to team</a
			>
		</div>
	</div>
{:else if !data.attempt}
	<!-- ── Pre-game gate ──────────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pt-4 pb-6">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
				style="background-color: {teamHex};">{data.team.display_name}</span
			>
		</div>
		<div class="mb-6">
			<div class="mb-2">
				<span
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold {typeColor}"
				>
					<TypeIcon size={12} />
					{data.challenge.variant}
				</span>
			</div>
			<h1 class="text-2xl font-black">{data.challenge.title}</h1>
		</div>
		{#if data.tutorialText}
			<div class="mb-8 rounded-2xl border border-zinc-700 bg-zinc-900 p-6">
				<h2 class="mb-3 text-xs font-bold tracking-widest text-zinc-400 uppercase">How to play</h2>
				<p class="text-sm leading-relaxed text-zinc-200">{data.tutorialText}</p>
			</div>
		{/if}
		<form
			method="POST"
			action="?/startChallenge"
			use:enhance={() => {
				startingChallenge = true;
				return async ({ result: res }) => {
					if (res.type === 'success') {
						window.location.reload();
					} else {
						startingChallenge = false;
					}
				};
			}}
		>
			<button
				type="submit"
				disabled={startingChallenge}
				class="w-full rounded-xl py-4 text-lg font-black tracking-widest text-white uppercase transition-colors hover:opacity-90 disabled:opacity-50"
				style="background-color: {teamHex};"
			>
				{startingChallenge ? 'Starting…' : 'Start challenge'}
			</button>
		</form>
		<p class="mt-3 text-center text-xs text-zinc-600">Timer begins when you tap Start</p>
	</div>
{:else}
	<!-- ── Challenge form ─────────────────────────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="flex items-center justify-between pt-4 pb-3">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
				style="background-color: {teamHex};">{data.team.display_name}</span
			>
			{#if timerMs !== null}
				<span
					class="font-mono text-sm font-bold tabular-nums {timerMs < 30_000
						? 'text-red-400'
						: timerMs < 60_000
							? 'text-yellow-400'
							: 'text-zinc-400'}">{fmtMs(timerMs)}</span
				>
			{/if}
		</div>

		{#if data.activeSetId && data.heldPowerups}
			<div class="pb-1">
				{#if data.activeEffects?.length > 0}
					<div class="pb-2">
						<ActiveEffectsBanner
							teamId={data.team.id}
							setId={data.activeSetId}
							effects={data.activeEffects}
						/>
					</div>
				{/if}
				<HeldPowerups
					teamId={data.team.id}
					setId={data.activeSetId}
					powerups={data.heldPowerups}
					currentChallengeId={data.challenge.id}
					variantFields={variantFields.map((f) => String(f))}
					onactivated={onPowerupActivated}
				/>
			</div>
		{/if}

		<div class="mb-4 flex items-start justify-between gap-3">
			<h1 class="text-2xl font-black">{data.challenge.title}</h1>
			<div class="flex shrink-0 gap-2">
				{#if tutorialEntry.length > 0}
					<button
						onclick={() => (showTutorial = true)}
						class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
						style="background-color: {teamHex}22; color: {teamHex}; border: 1px solid {teamHex}44;"
						>ⓘ</button
					>
				{/if}
				{#if data.challenge.hint_text && data.hintUsed}
					<button
						onclick={() => (showHintModal = true)}
						class="rounded-full px-3 py-1 text-xs font-semibold transition-colors"
						style="background-color: {teamHex}22; color: {teamHex}; border: 1px solid {teamHex}44;"
						>💡 Hint</button
					>
				{/if}
			</div>
		</div>

		<!-- Tab strip (multi-tab) -->
		{#if isMultiTab}
			<div class="mb-4 flex gap-1 overflow-x-auto pb-1">
				{#each data.tabs as _tab, i}
					<button
						type="button"
						onclick={() => (activeTabIndex = i)}
						class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors {activeTabIndex ===
						i
							? 'text-white'
							: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
						style={activeTabIndex === i ? `background-color: ${teamHex};` : ''}
					>
						Tab {i + 1}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Audio player(s) -->
		<div class="mb-6 rounded-2xl bg-zinc-900 p-5">
			{#if isFragments && activeTab && activeTab.clips.length > 1}
				<!-- Fragments: numbered clip strip at top -->
				<div class="mb-3 flex flex-wrap gap-1.5">
					{#each activeTab.clips as clipItem, ci}
						<button
							type="button"
							onclick={() => {
								activeClipIndex = ci;
								isPlaying = false;
							}}
							class="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors {activeClipIndex ===
							ci
								? 'text-white'
								: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
							style={activeClipIndex === ci ? `background-color: ${teamHex};` : ''}
						>
							Fragment {clipItem.fragmentNumber ?? ci + 1}
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex items-center gap-4">
				<button
					type="button"
					onclick={togglePlay}
					class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90"
					style="background-color: {teamHex};"
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					{#if isPlaying}
						<svg class="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 20 20"
							><rect x="5" y="4" width="3" height="12" rx="1" /><rect
								x="12"
								y="4"
								width="3"
								height="12"
								rx="1"
							/></svg
						>
					{:else}
						<svg class="ml-0.5 h-5 w-5 text-white" fill="currentColor" viewBox="0 0 20 20"
							><path
								d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
							/></svg
						>
					{/if}
				</button>
				<div class="min-w-0 flex-1 space-y-1.5">
					{#key `${activeTabIndex}-${activeClipIndex}`}
						<Waveform
							bind:this={waveformRef}
							src={activeTab?.clips[activeClipIndex]?.clipUrl ?? activeTab?.primaryClipUrl ?? ''}
							height={48}
							progressColor={teamHex}
							effects={activeTab?.clips[activeClipIndex]?.effects ??
								activeTab?.primaryClipEffects ??
								undefined}
							onPlayStateChange={(p) => (isPlaying = p)}
							onTimeUpdate={(t, d) => {
								currentTime = t;
								duration = d;
							}}
						/>
					{/key}
					<div class="font-mono text-xs text-zinc-500">{timeLabel}</div>
				</div>
			</div>
		</div>

		{#if formError}
			<div class="mb-4 rounded-xl border border-red-600/50 bg-red-900/30 p-3 text-sm text-red-300">
				{formError}
			</div>
		{/if}
		{#if timerMs === 0}
			<div
				class="mb-4 rounded-xl border border-amber-600/50 bg-amber-900/30 p-3 text-sm text-amber-300"
			>
				Time's up — submitting your answers…
			</div>
		{/if}

		<!-- Challenge intro (mashup/fragments/effects) -->
		{#if isMashup && activeTab}
			<p class="mb-4 text-sm font-semibold text-zinc-400">
				Identify the {activeTab.sourceTracks.length} songs in this mashup:
			</p>
		{:else if isFragments && activeTab}
			<p class="mb-4 text-sm font-semibold text-zinc-400">
				Identify the {activeTab.sourceTracks.length} tracks and group the fragments:
			</p>
		{:else if isEffects}
			<p class="mb-4 text-sm font-semibold text-zinc-400">
				The audio has been processed with effects — identify the original track:
			</p>
		{/if}

		<form
			bind:this={formEl}
			method="POST"
			action="?/submit"
			use:enhance={({ formData }) => {
				submitting = true;
				formData.set('answers_json', JSON.stringify(buildAnswersForSubmit()));
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
			class="space-y-5"
		>
			<input type="hidden" name="team_id" value={data.team.id} />

			{#key activeTabIndex}
				{#if isMultiSource && activeTab}
					<!-- Answer slot tabs (one per source track: mashup + fragments) -->
					{#if activeTab.sourceTracks.length > 1}
						<div class="mb-4 flex gap-1 overflow-x-auto pb-1">
							{#each Array.from({ length: activeTab.sourceTracks.length }, (_, i) => i) as si}
								<button
									type="button"
									onclick={() => (activeSlotIndex = si)}
									class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors {activeSlotIndex ===
									si
										? 'text-white'
										: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
									style={activeSlotIndex === si ? `background-color: ${teamHex};` : ''}
								>
									{si + 1}
								</button>
							{/each}
						</div>
					{/if}
					{@const slotIdx = Math.min(activeSlotIndex, Math.max(activeTab.sourceTracks.length, 1) - 1)}
					<div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
						{#each variantFields.filter((f) => f !== 'grouping') as field (field)}
							{@const mode = data.fieldModes[field] as InputMode}
							<div class="mb-4">
								<label class="mb-1.5 block text-sm font-semibold text-zinc-400"
									>{fieldLabel(field)}</label
								>
								{#if freeAnswerReveals[String(field)]}
									<div
										class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300"
									>
										<span>💡</span>
										<span>Revealed: {freeAnswerReveals[String(field)]}</span>
									</div>
								{/if}

								{#if field === 'artist' && hasArtistCombobox}
									{#each collabArtists[activeTabIndex]?.[slotIdx] ?? [''] as _, artistIdx}
										<div class="mb-2 flex items-start gap-2">
											<div class="min-w-0 flex-1">
												<Combobox
													name="artist_slot_{slotIdx}_{artistIdx}"
													pool={data.pools['artist'] ?? []}
													{teamHex}
													bind:value={collabArtists[activeTabIndex][slotIdx][artistIdx]}
												/>
											</div>
											{#if (collabArtists[activeTabIndex]?.[slotIdx]?.length ?? 0) > 1}
												<button
													type="button"
													onclick={() => removeArtistSlot(activeTabIndex, slotIdx, artistIdx)}
													class="mt-2 shrink-0 text-lg leading-none text-zinc-600 hover:text-red-400"
													aria-label="Remove artist">−</button
												>
											{/if}
										</div>
									{/each}
									{#if (collabArtists[activeTabIndex]?.[slotIdx]?.length ?? 0) < 3}
										<button
											type="button"
											onclick={() => addArtistSlot(activeTabIndex, slotIdx)}
											class="mt-1 text-xs font-semibold underline underline-offset-2"
											style="color: {teamHex};">+ Add collab artist</button
										>
									{/if}
								{:else if mode === 'combobox'}
									<Combobox
										name="{field}_{slotIdx}"
										pool={data.pools[field] ?? []}
										{teamHex}
										bind:value={allDrafts[activeTabIndex][slotIdx].fieldValues[field]}
									/>
								{:else if mode === 'multiple_choice'}
									<MultipleChoice
										name="{field}_{slotIdx}"
										options={data.multipleChoiceOptions[field] ?? []}
										{teamHex}
										bind:value={allDrafts[activeTabIndex][slotIdx].fieldValues[field]}
									/>
								{:else if mode === 'open_text'}
									<OpenText
										name="{field}_{slotIdx}"
										{teamHex}
										bind:value={allDrafts[activeTabIndex][slotIdx].fieldValues[field]}
									/>
								{:else if mode === 'slider'}
									<YearInput
										name="{field}_{slotIdx}"
										mode="slider"
										{teamHex}
										bind:value={allYearValues[activeTabIndex][slotIdx]}
									/>
								{:else if mode === 'typeable_number'}
									<YearInput
										name="{field}_{slotIdx}"
										mode="typeable_number"
										{teamHex}
										bind:value={allYearValues[activeTabIndex][slotIdx]}
									/>
								{/if}
							</div>
						{/each}

						<!-- Fragment grouping chips -->
						{#if hasGrouping && activeTab}
							<div>
								<label class="mb-1.5 block text-sm font-semibold text-zinc-400"
									>Which fragments belong to this track?</label
								>
								<div class="flex flex-wrap gap-2">
									{#each activeTab.clips as clipItem, ci}
										{@const fragNum = clipItem.fragmentNumber ?? ci + 1}
										{@const selected = (
											allDrafts[activeTabIndex]?.[slotIdx]?.fragments ?? []
										).includes(fragNum)}
										<button
											type="button"
											onclick={() => toggleFragment(activeTabIndex, slotIdx, fragNum)}
											class="rounded-full px-3 py-1 text-sm font-bold transition-colors"
											style={selected
												? `background-color: ${teamHex}; color: white;`
												: 'background-color: #27272a; color: #a1a1aa;'}
										>
											{fragNum}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<!-- Single-slot layout (standard / anthem / label) -->
					{#each variantFields as field (field)}
						{@const mode = data.fieldModes[field] as InputMode}
						<div>
							<label class="mb-1.5 block text-sm font-semibold text-zinc-400"
								>{fieldLabel(field)}</label
							>
							{#if freeAnswerReveals[String(field)]}
								<div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
									<span>💡</span>
									<span>Revealed: {freeAnswerReveals[String(field)]}</span>
								</div>
							{/if}

							{#if field === 'artist' && hasArtistCombobox}
								{#each collabArtists[activeTabIndex]?.[0] ?? [''] as _, artistIdx}
									<div class="mb-2 flex items-start gap-2">
										<div class="min-w-0 flex-1">
											<Combobox
												name="artist_slot_0_{artistIdx}"
												pool={data.pools['artist'] ?? []}
												{teamHex}
												bind:value={collabArtists[activeTabIndex][0][artistIdx]}
											/>
										</div>
										{#if (collabArtists[activeTabIndex]?.[0]?.length ?? 0) > 1}
											<button
												type="button"
												onclick={() => removeArtistSlot(activeTabIndex, 0, artistIdx)}
												class="mt-2 shrink-0 text-lg leading-none text-zinc-600 hover:text-red-400"
												aria-label="Remove artist">−</button
											>
										{/if}
									</div>
								{/each}
								{#if (collabArtists[activeTabIndex]?.[0]?.length ?? 0) < 3}
									<button
										type="button"
										onclick={() => addArtistSlot(activeTabIndex, 0)}
										class="mt-1 text-xs font-semibold underline underline-offset-2"
										style="color: {teamHex};">+ Add collab artist</button
									>
								{/if}
							{:else if mode === 'combobox'}
								<Combobox
									name={field}
									pool={data.pools[field] ?? []}
									{teamHex}
									bind:value={allDrafts[activeTabIndex][0].fieldValues[field]}
								/>
							{:else if mode === 'multiple_choice'}
								<MultipleChoice
									name={field}
									options={data.multipleChoiceOptions[field] ?? []}
									{teamHex}
									bind:value={allDrafts[activeTabIndex][0].fieldValues[field]}
								/>
							{:else if mode === 'open_text'}
								<OpenText
									name={field}
									{teamHex}
									bind:value={allDrafts[activeTabIndex][0].fieldValues[field]}
								/>
							{:else if mode === 'slider'}
								<YearInput
									name={field}
									mode="slider"
									{teamHex}
									bind:value={allYearValues[activeTabIndex][0]}
								/>
							{:else if mode === 'typeable_number'}
								<YearInput
									name={field}
									mode="typeable_number"
									{teamHex}
									bind:value={allYearValues[activeTabIndex][0]}
								/>
							{/if}
						</div>
					{/each}
				{/if}
			{/key}

			<button
				type="submit"
				disabled={!canSubmit}
				class="w-full rounded-xl py-4 text-lg font-black tracking-widest text-white uppercase transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				style="background-color: {teamHex};"
			>
				{submitting ? 'Submitting…' : 'Submit'}
			</button>
		</form>
	</div>
{/if}
