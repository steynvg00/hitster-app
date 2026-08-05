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
	import ArtistTagInput from '$lib/components/ui/ArtistTagInput.svelte';
	import { parseArtistTags, joinArtistTags } from '$lib/artist-tags';
	import { thresholdOfFields } from '$lib/threshold';
	import { freeAnswerRevealKey, type LifelineHint, type RevealResult } from '$lib/powerups-meta';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Waveform from '$lib/components/ui/Waveform.svelte';
	import BonusTracker from '$lib/components/game/BonusTracker.svelte';
	import TutorialOverlay from '$lib/components/game/TutorialOverlay.svelte';
	import HeldPowerups from '$lib/components/game/HeldPowerups.svelte';
	import ActiveEffectsBanner from '$lib/components/game/ActiveEffectsBanner.svelte';
	import IncomingEffectsListener from '$lib/components/game/IncomingEffectsListener.svelte';
	import PowerupRevealModal from '$lib/components/game/PowerupRevealModal.svelte';
	import TapToBreakOverlay from '$lib/components/game/TapToBreakOverlay.svelte';
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
	// Scoped by attempt.id so a fresh attempt (new run after reset, or replay)
	// never rehydrates a previous run's answers — challenge_attempts gets a new
	// id/started_at on every reset, so this key always changes with it.
	const DRAFT_KEY_PREFIX = `hitster_draft_${data.team.id}_${data.challenge.id}`;
	const DRAFT_KEY = `${DRAFT_KEY_PREFIX}_${data.attempt?.id ?? 'pregame'}`;

	type SlotDraft = { fieldValues: Record<string, string>; fragments?: number[] };

	function loadDraft(): Record<string, SlotDraft[]> {
		if (typeof localStorage === 'undefined') return {};
		try {
			// Drop stale drafts for this team+challenge from prior attempts (and the
			// legacy unscoped key, which is a strict prefix of the new format) so old
			// answers can never resurface under a different attempt id.
			for (let i = localStorage.length - 1; i >= 0; i--) {
				const key = localStorage.key(i);
				if (key && key.startsWith(DRAFT_KEY_PREFIX) && key !== DRAFT_KEY) {
					localStorage.removeItem(key);
				}
			}
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
	// Year is normally driven through allYearValues (YearInput, slider/typeable_number
	// modes below) — but its resolved mode can legitimately be open_text (config
	// fallback chain), in which case it renders through the same OpenText/allDrafts
	// path as any other field. Only override from allYearValues in the two modes
	// YearInput actually owns.
	const yearIsNumericMode =
		data.fieldModes['year'] === 'slider' || data.fieldModes['year'] === 'typeable_number';
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
							.filter((f) => f !== 'grouping')
							.map((f) => [f, saved.fieldValues?.[f] ?? ''])
					),
					fragments: saved.fragments ?? []
				};
			});
		})
	);

	// The value allYearValues holds for a tab/slot the team has never touched.
	//
	// Deliberately OUT of YearInput's own range (min 2000) so an untouched year can
	// never accidentally score. That also means it must never be used to decide
	// "did the team answer this?": the browser clamps an out-of-range value to `min`
	// and Svelte's input binding writes that clamped number straight back into state
	// during hydration, so the seed is already gone by the time anything can read it.
	// Answeredness is tracked explicitly in yearTouched instead.
	const YEAR_SEED = 1990;

	// Year values: per-tab, per-slot
	let allYearValues = $state<number[][]>(
		data.tabs.map((tab) => {
			const tabDraft = savedDraft[String(tab.position)] ?? [];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			return Array.from({ length: slotCount }, (_, si) => {
				const y = parseInt(tabDraft[si]?.fieldValues?.['year'] ?? String(YEAR_SEED), 10);
				return isNaN(y) ? YEAR_SEED : y;
			});
		})
	);

	// Did this tab/slot already carry a drafted year when the page mounted? Without
	// this, rehydrating a draft whose year happens to equal YEAR_SEED — or simply
	// reloading after answering — would read as "untouched". Reads the immutable
	// savedDraft snapshot taken at load, so it needs no reactive state of its own.
	function wasYearDrafted(tabPosition: number, si: number): boolean {
		const tabDraft = savedDraft[String(tabPosition)] ?? [];
		return (tabDraft[si]?.fieldValues?.['year'] ?? '').trim() !== '';
	}

	// Did the team actually operate this tab/slot's year input in THIS session?
	// Seeded from the saved draft, which (see the persist effect) now only carries a
	// year once it has really been answered. Set from YearInput's ontouched — a real
	// DOM event — and by a free_answer reveal, never from comparing the value: the
	// hydration clamp described at YEAR_SEED makes any value comparison read
	// "answered" for the tab that happens to be rendered.
	// Sparse object keyed `tabIdx:slotIdx`, the same shape (and for the same reason)
	// as doubtTabs below: nothing has to read data.tabs at init, a missing key is
	// simply falsy, and $state's proxy tracks reads of keys that don't exist yet.
	let yearTouched = $state<Record<string, boolean>>({});

	function markYearTouched(ti: number, si: number) {
		yearTouched[`${ti}:${si}`] = true;
	}

	/** The numeric year this tab/slot carried in the saved draft, if any. */
	function draftedYearFor(tabPosition: number, si: number): number | null {
		const raw = (savedDraft[String(tabPosition)] ?? [])[si]?.fieldValues?.['year'] ?? '';
		if (!raw.trim()) return null;
		const n = parseInt(raw, 10);
		return isNaN(n) ? null : n;
	}

	/**
	 * The year a free_answer reveal handed this tab/slot, if any. Read from the
	 * SERVER's reveal map — the exact data that renders the 💡 badge — so the badge
	 * and the input cannot disagree about what was revealed. Only meaningful while
	 * the year renders as a number input; in open_text mode a revealed year lives in
	 * allDrafts like any other text field and is persisted with it.
	 */
	function revealedYearFor(ti: number, si: number): number | null {
		if (!yearIsNumericMode) return null;
		const tabId = data.tabs[ti]?.id;
		if (!tabId) return null;
		const raw = data.freeAnswerReveal[freeAnswerRevealKey(tabId, si, 'year')];
		if (!raw) return null;
		const n = parseInt(raw, 10);
		return isNaN(n) ? null : n;
	}

	/** The single rule for "this tab/slot's year counts as answered". */
	function yearIsAnswered(ti: number, tabPosition: number, si: number): boolean {
		return (
			wasYearDrafted(tabPosition, si) ||
			yearTouched[`${ti}:${si}`] === true ||
			// A revealed year is answered by definition — the team was given it. This
			// keeps the dot correct even on a device whose localStorage never held the
			// draft, from the same server data the badge uses.
			revealedYearFor(ti, si) !== null
		);
	}

	// Re-assert the year AFTER hydration.
	//
	// The server has no localStorage, so the SSR'd markup always carries YEAR_SEED.
	// That is below YearInput's min, so the browser clamps the rendered input and
	// Svelte's binding writes the clamped number back into state while hydrating
	// (see YEAR_SEED). That read-back happens AFTER this component's initialiser and
	// therefore silently overwrote whatever the initialiser had restored — a revealed
	// year, or a year the team set before reloading. The badge survived a refresh
	// because it is server-rendered from server data; the slider did not.
	//
	// onMount runs once the children have hydrated, which is the first moment a write
	// here sticks. Deliberately assigns values only: nothing is marked touched, so a
	// tab with no draft and no reveal keeps its untouched state and its "empty" dot.
	onMount(() => {
		for (let ti = 0; ti < data.tabs.length; ti++) {
			const tab = data.tabs[ti];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			for (let si = 0; si < slotCount; si++) {
				// The team's own draft wins over the reveal: they may have moved the
				// slider off the revealed year, and that is still their answer.
				const authoritative = draftedYearFor(tab.position, si) ?? revealedYearFor(ti, si);
				if (authoritative !== null && allYearValues[ti]?.[si] !== authoritative) {
					allYearValues[ti][si] = authoritative;
				}
			}
		}
	});

	// ── Multi-artist tags: per-tab, per-slot (C1 stuk 2) ──────────────────────
	// Replaces the old collab UI, which joined its inputs with ' & '. That format
	// silently stopped scoring the moment C1 stuk 1 landed: the scorer splits on
	// '\n' (parseArtistTags), so "Ran-D & Adaro" arrived as ONE tag and matched
	// neither artist of a T1 track whose artists[] is ['Ran-D','Adaro'].
	//
	// Rendered for open_text AND combobox, because BOTH need it: an artist field in
	// open_text mode is a single-line input, so a player literally cannot type a
	// '\n'-separated list — a multi-artist track would be unanswerable there. Only
	// the SUGGESTIONS are mode-gated (see artistPool below).
	const artistIsTagged = $derived(
		variantFields.includes('artist' as AnswerField) &&
			(data.fieldModes['artist'] === 'combobox' || data.fieldModes['artist'] === 'open_text')
	);
	// Suggestions only in combobox mode. open_text means "answer from memory" — the
	// answer pool is the artist list, so suggesting from it there would hand the
	// answer over and erase the difficulty difference between the two modes.
	const artistPool = $derived(
		data.fieldModes['artist'] === 'combobox' ? (data.pools['artist'] ?? []) : []
	);

	let artistTags = $state<string[][][]>(
		data.tabs.map((tab) => {
			const tabDraft = savedDraft[String(tab.position)] ?? [];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			return Array.from({ length: slotCount }, (_, si) =>
				// parseArtistTags is the scorer's own splitter — a legacy ' & ' draft
				// therefore restores as ONE tag ("Ran-D & Adaro"), visible and fixable,
				// rather than being re-split by a rule the scorer doesn't share.
				parseArtistTags(tabDraft[si]?.fieldValues?.['artist'] ?? '')
			);
		})
	);

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
		// No attempt yet (pre-game gate) → nothing to persist. Result landed → this
		// run is done, clear instead of re-persisting the hydrated draft (referencing
		// `result` here makes the effect re-fire and clear once it's set).
		if (!data.attempt || result) {
			if (result && typeof localStorage !== 'undefined') localStorage.removeItem(DRAFT_KEY);
			return;
		}
		const d: Record<string, SlotDraft[]> = {};
		for (let ti = 0; ti < data.tabs.length; ti++) {
			const tab = data.tabs[ti];
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			d[String(tab.position)] = Array.from({ length: slotCount }, (_, si) => {
				// joinArtistTags is the exact inverse of the scorer's parseArtistTags —
				// one tag joins to a plain string with no newline, which is what keeps a
				// single-artist answer byte-identical to pre-C1.
				const artistVal = artistIsTagged
					? joinArtistTags(artistTags[ti]?.[si] ?? [])
					: (allDrafts[ti]?.[si]?.fieldValues['artist'] ?? '');
				return {
					fieldValues: {
						...allDrafts[ti]?.[si]?.fieldValues,
						...(artistIsTagged ? { artist: artistVal } : {}),
						// Only persist a year the team actually set. Writing it
						// unconditionally made the draft claim every tab had a year
						// answered — including the untouched seed — so after any reload
						// wasYearDrafted() was true everywhere and every tab's fill dot
						// showed "partly filled in" on a completely blank challenge.
						// The SUBMIT payload still always carries a year; that is
						// buildAnswersForSubmit's job, not this one.
						...(hasYear && yearIsNumericMode && yearIsAnswered(ti, tab.position, si)
							? { year: String(allYearValues[ti]?.[si] ?? YEAR_SEED) }
							: {})
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
				// joinArtistTags is the exact inverse of the scorer's parseArtistTags —
				// one tag joins to a plain string with no newline, which is what keeps a
				// single-artist answer byte-identical to pre-C1.
				const artistVal = artistIsTagged
					? joinArtistTags(artistTags[ti]?.[si] ?? [])
					: (allDrafts[ti]?.[si]?.fieldValues['artist'] ?? '');
				return {
					fieldValues: {
						...allDrafts[ti]?.[si]?.fieldValues,
						...(artistIsTagged ? { artist: artistVal } : {}),
						...(hasYear && yearIsNumericMode
							? { year: String(allYearValues[ti]?.[si] ?? 1990) }
							: {})
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
	const isLastTab = $derived(activeTabIndex === data.tabs.length - 1);

	// The ONE tab-switch path. The tab pills, Previous and Next all call this — a
	// second navigation route would be a second way to miss the {#key activeTabIndex}
	// remount and the draft-persist $effect that both hang off this single mutation.
	// Drafts themselves live in allDrafts/allYearValues/artistTags, which are indexed
	// per tab and never rebuilt on switch, so any tab order is non-destructive.
	function goToTab(i: number) {
		if (i < 0 || i > data.tabs.length - 1) return;
		activeTabIndex = i;
	}
	// Answer slot tabs (mashup + fragments only)
	let activeSlotIndex = $state(0);

	// The answer slot the player is actually on. Only multi-source tabs (mashup /
	// fragments) have more than one; every other tab is slot 0. Clamped because
	// activeSlotIndex survives a tab switch and the new tab may have fewer slots.
	// Used both to render and to address a free_answer reveal, so the badge and
	// the powerup can't disagree about which slot is meant.
	const activeSlotEffective = $derived(
		isMultiSource && activeTab
			? Math.min(activeSlotIndex, Math.max(activeTab.sourceTracks.length, 1) - 1)
			: 0
	);

	// The tabs a multi-reveal powerup (x_ray, free_tab) can address, labelled the
	// way the tab strip labels them so "Tab 2" in the picker is the "Tab 2" the
	// player clicks. `fields` is each tab's RESOLVED field set (the same
	// resolveTabFields output the reveal resolver validates against), so a cell the
	// server would refuse is never offered in the first place.
	const revealTabs = $derived(
		data.tabs.map((t, i) => ({
			id: t.id,
			label: `Tab ${i + 1}`,
			fields: t.fields,
			slotCount: Math.max(t.sourceTracks.length, 1)
		}))
	);

	// ── Per-tab fill status + doubt marker (session-only) ─────────────────────
	// Both are pure client state. Nothing here is persisted, submitted, or read by
	// the scorer — the fill status is a live read of the same draft signals the
	// inputs write to, and the doubt marker is a scratch flag that dies with the
	// page.
	type FillStatus = 'empty' | 'partial' | 'full';

	// "Answered" per field, defined per input type. Strict throughout: whitespace is
	// not an answer (eis 3).
	//   artist (tagged modes) → at least one tag
	//   year   (numeric modes)→ drafted earlier, or operated this session
	//                           (yearIsAnswered). A year input always holds a number,
	//                           so this can only be tracked, never derived — see
	//                           YEAR_SEED. Any year the team sets counts, including
	//                           one they land back on the seed with.
	//   grouping              → at least one fragment chip picked for that slot
	//   everything else       → non-blank string in the draft
	// Modes come from the challenge-wide data.fieldModes on purpose: they are what
	// actually decides which input renders and therefore which state that input
	// writes to. Using a per-tab mode here would let the check read artistTags while
	// the form wrote to allDrafts.
	function isFieldAnswered(field: string, ti: number, tabPosition: number, si: number): boolean {
		if (field === 'artist' && artistIsTagged) return (artistTags[ti]?.[si]?.length ?? 0) > 0;
		if (field === 'year' && yearIsNumericMode) return yearIsAnswered(ti, tabPosition, si);
		if (field === 'grouping') return (allDrafts[ti]?.[si]?.fragments?.length ?? 0) > 0;
		return (allDrafts[ti]?.[si]?.fieldValues?.[field] ?? '').trim() !== '';
	}

	// $derived.by, not a snapshot: it re-reads allDrafts / allYearValues / artistTags,
	// so a keystroke moves the strip without a tab switch (eis 2).
	//
	// Fields are THIS tab's resolved C3b fields (data.tabs[i].fields, produced by
	// resolveTabFields in the load — see +page.server.ts), not the challenge-wide
	// variantFields. Bonus fields are excluded, also per tab. A multi-slot tab
	// (mashup / fragments) counts every slot's fields: full means every non-bonus
	// field of every slot is answered.
	const tabFillStatus = $derived.by<FillStatus[]>(() =>
		data.tabs.map((tab, ti) => {
			const bonus = new Set(tab.bonusFields ?? []);
			const scored = (tab.fields ?? []).filter((f) => !bonus.has(f));
			const slotCount = Math.max(tab.sourceTracks.length, 1);
			let answered = 0;
			let total = 0;
			for (let si = 0; si < slotCount; si++) {
				for (const f of scored) {
					total++;
					if (isFieldAnswered(f, ti, tab.position, si)) answered++;
				}
			}
			// A tab with no non-bonus fields at all has nothing to fill; calling it
			// 'full' keeps it from sitting permanently on the "you missed this" colour.
			if (total === 0) return 'full';
			return answered === 0 ? 'empty' : answered === total ? 'full' : 'partial';
		})
	);

	// Session-only doubt flags, keyed by tab index. No localStorage, no DB: they are
	// gone on reload, and after submit the results screen replaces this template
	// entirely. Sparse object rather than a pre-sized array so nothing has to read
	// data.tabs at init — a missing key is simply falsy, and $state's proxy tracks
	// reads of keys that don't exist yet.
	let doubtTabs = $state<Record<number, boolean>>({});
	function toggleDoubt(i: number) {
		doubtTabs[i] = !doubtTabs[i];
	}

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

	// ── Lifeline hints ────────────────────────────────────────────────────────
	//
	// A hint is NOT a reveal. It is a masked string ("R______ O_ R______") for a
	// field the team has not got right yet, rendered read-only beside that field —
	// the team still types the answer itself. So it deliberately does NOT go
	// through onPowerupActivated / applyRevealToDraft: nothing is written into the
	// draft, no input is touched, and the tab fill dots keep reading the team's own
	// answers rather than lighting up because a powerup fired.
	//
	// Keyed by the SAME (tab, slot, field) triple reveals use, so a hint sits next
	// to the field it belongs to on the tab it belongs to. Seeded from the server
	// (rebuilt from the stored lifeline row on every load), which is what makes it
	// survive a refresh and stay up for the rest of the challenge.
	// Two layers rather than one seeded snapshot: the server map stays live (a
	// reload or invalidation re-supplies it) and hints added during this session
	// layer on top. Same visible behaviour as freeAnswerReveals' seeded copy above,
	// without capturing `data` at init.
	let addedLifelineHints = $state<Record<string, string>>({});
	const lifelineHints = $derived({ ...(data.lifelineHints ?? {}), ...addedLifelineHints });

	function onLifelineHints(hints: LifelineHint[]) {
		const added: Record<string, string> = {};
		for (const h of hints) {
			added[freeAnswerRevealKey(h.tabId, h.slotIndex, h.field)] = h.mask;
		}
		addedLifelineHints = { ...addedLifelineHints, ...added };
	}

	/** The masked hint for one field of the active tab, if Lifeline produced one. */
	function lifelineFor(field: string, slot: number): string | undefined {
		const id = activeTab?.id;
		if (!id) return undefined;
		return lifelineHints[freeAnswerRevealKey(id, slot, field)];
	}

	// ── Incoming timer attacks (stuk 2: freeze + time_drain) ───────────────────
	// Both are payload-driven marker rows on the SAME realtime channel/convention
	// as time_boost — timerBoostMs += added_seconds*1000 moves the deadline this
	// page reads from (line ~287); the server-side deadline is moved identically
	// by /api/auto-submit's summation over the same effect rows. freeze ALSO gets
	// a blocking visual overlay (no server round-trip — it just times out client-side).
	let freezeUntil = $state<number | null>(null);
	let freezeSourceName = $state('');
	let freezeRemainingMs = $state(0);
	const isFrozen = $derived(!!freezeUntil && freezeRemainingMs > 0);

	let drainToast = $state<{ sourceName: string } | null>(null);
	let drainToastTimer: ReturnType<typeof setTimeout> | undefined;

	// ── Incoming lock attack (stuk 3 FINAL: tap_to_break) ──────────────────────
	// UNLIKE freeze/time_drain's pre-consumed markers, tap_to_break's team_effects
	// row stays ACTIVE (no consumed_at) until broken — loadActiveEffects already
	// re-surfaces it here on every page load, so a reload restores the lock for
	// free (the tap counter itself resets to 0, client-local, by design). Live
	// arrival while the page is open comes from the SAME effectsBoostChannel INSERT
	// handler below, not a separate subscription.
	type TapLock = { effectId: string; sourceName: string; tapsRequired: number };
	function findActiveTapLock(): TapLock | null {
		const row = data.activeEffects?.find(
			(e) =>
				e.effect_type === 'tap_to_break' &&
				(e.payload as { challenge_id?: string }).challenge_id === data.challenge.id
		);
		if (!row) return null;
		const p = row.payload as { taps_required?: number; source_team_name?: string };
		return {
			effectId: row.id,
			sourceName: p.source_team_name || 'Another team',
			tapsRequired: p.taps_required ?? 20
		};
	}
	let tapLock = $state<TapLock | null>(findActiveTapLock());

	$effect(() => {
		if (!freezeUntil) {
			freezeRemainingMs = 0;
			return;
		}
		const tick = () => {
			const rem = Math.max(0, freezeUntil! - Date.now());
			freezeRemainingMs = rem;
			if (rem === 0) freezeUntil = null;
		};
		tick();
		const iv = setInterval(tick, 250);
		return () => clearInterval(iv);
	});

	/**
	 * Write a revealed answer into the draft the way THAT field's input reads it.
	 *
	 * Every field type keeps its answer somewhere different, so a single
	 * "string into allDrafts" write only ever worked for the plain text inputs —
	 * on a tagged artist field the value landed in a draft key nothing renders,
	 * which is why the badge appeared but the chip never did. The dispatch below
	 * deliberately mirrors isFieldAnswered()'s, so "prefilled" and "answered"
	 * cannot disagree.
	 *
	 * Returns false when the field's input cannot take the value, in which case the
	 * badge stays as the only surface — better than a half-written draft.
	 *
	 * The full matrix, so the absence of a branch reads as a decision rather than an
	 * omission. "Draft target" is the structure the RENDERING component binds to:
	 *
	 *   field/mode                     component        draft target        branch
	 *   artist (combobox|open_text)    ArtistTagInput   artistTags[ti][si]  yes
	 *   artist (multiple_choice)       MultipleChoice   fieldValues[field]  fallback
	 *   year (slider|typeable_number)  YearInput        allYearValues[ti]   yes
	 *   year (other modes)             per mode         fieldValues[field]  fallback
	 *   title / festival / label /     Combobox,        fieldValues[field]  fallback
	 *     vocal_source (any of         OpenText,
	 *     combobox/open_text/          MultipleChoice
	 *     multiple_choice)
	 *   grouping                       fragment chips   — (per-slot, no answer) refused
	 *
	 * The two guards mirror the template's own conditions (artistIsTagged,
	 * yearIsNumericMode), so "which input is on screen" and "where the reveal is
	 * written" cannot disagree. Everything else binds to fieldValues, which is why
	 * one fallback covers combobox, open_text and multiple_choice together — a
	 * per-mode branch there would be three copies of the same assignment.
	 *
	 * NOTE: a combobox field used to show nothing after a reveal despite this
	 * writing the right key. That was never a missing branch here — Combobox kept a
	 * mount-time COPY of the value as its visible text and ignored later external
	 * writes. Fixed in the component ($lib/components/ui/Combobox.svelte), which is
	 * the only place that could see it.
	 */
	function applyRevealToDraft(reveal: RevealResult, ti: number): boolean {
		const { value, tags, field, slotIndex: si } = reveal;

		// artist in a tagged mode → artistTags[ti][si], one chip per scorer target.
		// `tags` comes from the server precisely because the ' & '-joined string is
		// not re-splittable (see RevealResult.tags); the single-chip fallback is the
		// pre-tag shape, still correct for a single-artist track.
		if (field === 'artist' && artistIsTagged) {
			if (!artistTags[ti]?.[si]) return false;
			artistTags[ti][si] = tags?.length ? [...tags] : [value];
			return true;
		}

		// year in a numeric mode → allYearValues[ti][si], a number, plus the touch
		// flag so the tab's fill dot updates immediately.
		if (field === 'year' && yearIsNumericMode) {
			const n = parseInt(value, 10);
			if (isNaN(n) || !allYearValues[ti]) return false;
			allYearValues[ti][si] = n;
			markYearTouched(ti, si);
			return true;
		}

		// grouping is the one field with no revealable answer — it is a per-slot
		// fragment assignment, not a track property. The server refuses to reveal it
		// at all, so this is a guard, not a path anyone reaches.
		if (field === 'grouping') return false;

		// open_text / combobox / multiple_choice all bind straight to the draft's
		// fieldValues, so one write serves all three. A multiple_choice value that
		// isn't among the host's options simply highlights nothing — the draft still
		// carries the correct answer and still scores.
		if (!allDrafts[ti]?.[si]) return false;
		allDrafts[ti][si].fieldValues[field] = value;
		return true;
	}

	// Every reveal — free_answer's single one, x_ray's five, free_tab's whole tab —
	// arrives here as a list and is applied one at a time by the SAME two steps:
	// key the badge on (tab, slot, field), then pre-fill that one slot. The loop is
	// the only difference between one reveal and many; there is no second apply path.
	function onPowerupActivated(reveals: RevealResult[]) {
		const added: Record<string, string> = {};
		for (const reveal of reveals) {
			const { value, field, tabId, slotIndex } = reveal;
			added[freeAnswerRevealKey(tabId, slotIndex, field)] = value;
			// Pre-fill ONLY the slot the answer belongs to. This used to write the value
			// into every tab and every slot, which handed a mashup team three "free"
			// artists from one powerup and put tab 1's answer under tab 2's inputs.
			const ti = data.tabs.findIndex((t) => t.id === tabId);
			if (ti >= 0) applyRevealToDraft(reveal, ti);
		}
		freeAnswerReveals = { ...freeAnswerReveals, ...added };
	}

	// ── X-Ray budget ──────────────────────────────────────────────────────────
	//
	// X-Ray is not a one-shot: activating it opens a counter of reveals the team
	// spends one field at a time, on any tab. The counter lives server-side in the
	// x_ray team_effects row (loadActiveEffects hands it over on every load, so it
	// survives a refresh); this is the local mirror that drives the buttons.
	//
	// Each spend posts to /api/powerups/xray-reveal, which runs free_answer's own
	// resolver and returns a RevealResult — handed to the SAME onPowerupActivated
	// the powerup modal uses, so the badge, the per-tab keying and the per-field
	// pre-fill are one implementation, not one per powerup.
	function readXrayRemaining(): number {
		const row = data.activeEffects?.find((e) => e.effect_type === 'x_ray');
		const n = (row?.payload as { reveals_remaining?: number } | undefined)?.reveals_remaining;
		return typeof n === 'number' ? n : 0;
	}
	let xrayRemaining = $state(readXrayRemaining());
	let xraySpending = $state<string | null>(null);
	let xrayError = $state('');
	let xrayErrorTimer: ReturnType<typeof setTimeout> | undefined;

	async function spendXrayReveal(field: string, slot: number) {
		const tabId = activeTab?.id;
		if (!tabId || xrayRemaining <= 0 || xraySpending) return;
		const key = freeAnswerRevealKey(tabId, slot, field);
		xraySpending = key;
		xrayError = '';
		try {
			const res = await fetch('/api/powerups/xray-reveal', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					challenge_id: data.challenge.id,
					tab_id: tabId,
					slot_index: slot,
					field
				})
			});
			const body = (await res.json().catch(() => null)) as {
				reveal?: RevealResult;
				remaining?: number;
				error?: string;
			} | null;
			if (!res.ok || !body?.reveal) {
				// A refused cell costs no budget — the count is left exactly as it was.
				xrayError = body?.error ?? 'Reveal failed';
				clearTimeout(xrayErrorTimer);
				xrayErrorTimer = setTimeout(() => (xrayError = ''), 5000);
				return;
			}
			onPowerupActivated([body.reveal]);
			if (typeof body.remaining === 'number') xrayRemaining = body.remaining;
		} catch {
			xrayError = 'Network hiccup — try again';
			clearTimeout(xrayErrorTimer);
			xrayErrorTimer = setTimeout(() => (xrayError = ''), 5000);
		} finally {
			xraySpending = null;
		}
	}

	// A reveal belongs to one (tab, slot, field); the badge shows only there.
	function revealFor(field: string, slot: number): string | undefined {
		const id = activeTab?.id;
		if (!id) return undefined;
		return freeAnswerReveals[freeAnswerRevealKey(id, slot, field)];
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

	// Enter must never submit this form — teams were finishing a multi-tab challenge
	// with a half answer by hitting Enter in a field (submit is is_final). Bubble
	// phase on purpose: a component that owns Enter itself (ArtistTagInput adds a
	// tag) has already run its own handler by the time this fires, and
	// preventDefault only kills the browser's implicit form submission, never a
	// handler that already ran. TEXTAREA keeps its newline; BUTTON keeps
	// Enter-as-click (relevant only on the last tab, where Submit exists).
	function onFormKeydown(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'TEXTAREA' || tag === 'BUTTON') return;
		e.preventDefault();
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
				{
					event: 'INSERT',
					schema: 'public',
					table: 'team_effects',
					filter: `team_id=eq.${data.team.id}`
				},
				(payload) => {
					const row = payload.new as {
						id: string;
						effect_type: string;
						payload: Record<string, unknown>;
					};
					if (row.effect_type === 'time_boost') {
						const p = row.payload as { added_seconds?: number; challenge_id?: string };
						if (p.challenge_id === data.challenge.id) {
							timerBoostMs += (p.added_seconds ?? 30) * 1000;
						}
					} else if (row.effect_type === 'freeze') {
						const p = row.payload as {
							added_seconds?: number;
							challenge_id?: string;
							source_team_name?: string;
						};
						if (p.challenge_id === data.challenge.id) {
							timerBoostMs += (p.added_seconds ?? 30) * 1000;
							freezeSourceName = p.source_team_name || 'Another team';
							freezeUntil = Date.now() + 30_000;
						}
					} else if (row.effect_type === 'time_drain') {
						const p = row.payload as {
							added_seconds?: number;
							challenge_id?: string;
							source_team_name?: string;
						};
						if (p.challenge_id === data.challenge.id) {
							timerBoostMs += (p.added_seconds ?? -15) * 1000;
							drainToast = { sourceName: p.source_team_name || 'Another team' };
							if (drainToastTimer) clearTimeout(drainToastTimer);
							drainToastTimer = setTimeout(() => (drainToast = null), 4000);
						}
					} else if (row.effect_type === 'x_ray') {
						// A teammate on a second phone activated X-Ray — surface the fresh
						// budget here too, so the reveal buttons appear without a reload.
						const p = row.payload as { reveals_remaining?: number };
						if (typeof p.reveals_remaining === 'number') xrayRemaining = p.reveals_remaining;
					} else if (row.effect_type === 'tap_to_break') {
						// Unlike freeze/time_drain this doesn't touch timerBoostMs — it mounts
						// the lock, it doesn't move the deadline.
						const p = row.payload as {
							challenge_id?: string;
							taps_required?: number;
							source_team_name?: string;
						};
						if (p.challenge_id === data.challenge.id) {
							tapLock = {
								effectId: row.id,
								sourceName: p.source_team_name || 'Another team',
								tapsRequired: p.taps_required ?? 20
							};
						}
					}
				}
			)
			// X-Ray's counter is UPDATEd in place on every spend, so the budget needs an
			// UPDATE handler as well as the INSERT one above — this is what keeps a
			// second phone on the same team from showing a stale count (and running into
			// the server's compare-and-swap) after a teammate spends a reveal.
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'team_effects',
					filter: `team_id=eq.${data.team.id}`
				},
				(payload) => {
					const row = payload.new as {
						effect_type: string;
						payload: Record<string, unknown>;
						consumed_at: string | null;
					};
					if (row.effect_type !== 'x_ray') return;
					const p = row.payload as { reveals_remaining?: number };
					xrayRemaining = row.consumed_at ? 0 : (p.reveals_remaining ?? 0);
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
						if ((payload.new as { play_state?: string }).play_state === 'recap') {
							goto(`/play/waiting?set_id=${data.activeSetId}`);
						}
					}
				)
				.subscribe();
		}

		return () => {
			if (iv) clearInterval(iv);
			if (drainToastTimer) clearTimeout(drainToastTimer);
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
	type EarnedPowerup = {
		teamPowerupId: string;
		type: {
			id: string;
			name: string;
			icon: string | null;
			description: string | null;
			holdable: boolean;
			immediate_use: boolean;
		};
		activation?: {
			success: boolean;
			payload?: Record<string, unknown>;
			// power_spin only: the powerup the wheel landed on, already awarded
			// server-side through the same path an earned powerup takes.
			spun?: EarnedPowerup;
		};
		// Client-side annotation set by withSpun(), never sent by the server: this
		// entry is a Power Spin PRIZE, so its card skips the slot machine. The wheel
		// on the spin card already rolled and stopped on it; rolling again for a
		// result the player just watched land is the second animation this flow used
		// to have. Absent on a powerup earned the normal way, whose reveal is
		// therefore untouched.
		fromSpin?: boolean;
	};
	// A submission can now earn MULTIPLE powerups (x crossed ladder bands + inverse),
	// so reveals are queued and shown one at a time — the head renders, onclose
	// shifts, the next opens automatically until drained. Deduped by array identity
	// (each form result carries a fresh earnedPowerups array) so the $effect doesn't
	// re-enqueue on unrelated re-runs.
	let earnedQueue = $state<EarnedPowerup[]>([]);
	let handledEarnRef: unknown = null;

	// Power Spin awards a SECOND powerup at activation time, so one earned entry can
	// carry another behind it. Flattening it into the same queue — spin first, prize
	// straight after — is what makes the outcome behave like any other award: the
	// player pulls the wheel, watches it stop on Free Tab, closes it, and gets Free
	// Tab's own store/lose card. The server already materialized the prize, so it
	// renders through the same component as everything else.
	//
	// The prize is tagged `fromSpin` on the way in. That flag is the ONLY thing that
	// tells its card apart from the same powerup earned by scoring, and it exists
	// because this is the one place where the two entries are known to belong
	// together. Without it the prize card runs its own slot machine — the second
	// animation, for a result the wheel just landed on in front of the player.
	//
	// Recursion is bounded server-side (the roll pool excludes every award-generating
	// type), so this is one level deep by construction, not by a depth check here.
	function withSpun(list: EarnedPowerup[]): EarnedPowerup[] {
		return list.flatMap((e) =>
			e.activation?.spun ? [e, { ...e.activation.spun, fromSpin: true }] : [e]
		);
	}

	$effect(() => {
		const earned = f?.earnedPowerups;
		if (earned && earned.length && earned !== handledEarnRef) {
			handledEarnRef = earned;
			earnedQueue = [...earnedQueue, ...withSpun(earned as EarnedPowerup[])];
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

	// ── Totals block: base | bonus+extras | total ─────────────────────────────
	// BASE is the scorer's own bonus-excluded sum (thresholdTotal) — the exact
	// quantity the per-field badges above display, and the one powerup earning
	// uses, so the block can never disagree with the rows it summarises. Both
	// result paths supply it (scoreSubmission on submit; the loader rebuilds it
	// for priorResult), and the fallback sums the rendered FieldResults via the
	// shared thresholdOfFields ($lib/threshold) — the same rule the scorer uses —
	// for any older result that predates the field.
	//
	// TOTAL is breakdown.final — post multipliers/streak/speed, i.e. the team's
	// actual challenge score, and what animatedScore counts to.
	//
	// EXTRAS is TOTAL − BASE rather than a hand-assembled sum, so the three cells
	// add up by construction. It deliberately sweeps in every non-base quantity
	// that already exists — bonus-artist points, whole-field bonus fields, the
	// difficulty/round/comeback multiplier uplift, streak, speed and powerup
	// bonuses — instead of inventing a category the breakdown doesn't have.
	const baseTotal = $derived(
		result?.thresholdTotal ??
			(result?.tabs ?? []).reduce(
				(s, t) => s + t.slots.reduce((ss, sl) => ss + thresholdOfFields(sl.fields).total, 0),
				0
			)
	);
	const totalScore = $derived(result?.breakdown?.final ?? result?.total ?? 0);
	const extrasTotal = $derived(totalScore - baseTotal);

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

	const bonusFieldSet = $derived(new Set(data.bonusFields));
	function isBonusField(field: AnswerField) {
		return bonusFieldSet.has(String(field));
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

{#if earnedQueue.length > 0}
	{#key earnedQueue[0].teamPowerupId}
		<PowerupRevealModal
			teamPowerupId={earnedQueue[0].teamPowerupId}
			type={earnedQueue[0].type}
			activation={earnedQueue[0].activation}
			teamId={data.team.id}
			setTeams={data.setTeams}
			skipRollAnimation={earnedQueue[0].fromSpin === true}
			onclose={() => (earnedQueue = earnedQueue.slice(1))}
		/>
	{/key}
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

{#if data.challengeNotReady}
	<!-- ── Not-ready / unconfigured challenge ─────────────────────────────────── -->
	<div class="mx-auto min-h-screen max-w-lg p-4">
		<div class="pt-4 pb-6">
			<span
				class="rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
				style="background-color: {teamHex};">{data.team.display_name}</span
			>
		</div>
		<h1 class="mb-6 text-2xl font-black">{data.challenge.title}</h1>
		<div class="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
			<p class="text-lg font-semibold text-zinc-200">This challenge isn't set up yet</p>
			<p class="text-sm text-zinc-500">
				The host hasn't added any tracks to this challenge yet. Check back in a bit, or head back to
				your team page.
			</p>
			<a
				href="/team"
				class="mt-2 inline-block text-sm underline underline-offset-2"
				style="color: {teamHex};">Back to team</a
			>
		</div>
	</div>
{:else if result}
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
					<!-- Base-only, like the field badges: tr.total carries the bonus but
					     tr.maxTotal is base-only, so the raw pair would read "15/10". -->
					{@const tabBase = tr.slots.reduce((s, sl) => s + thresholdOfFields(sl.fields).total, 0)}
					<button
						type="button"
						onclick={() => (resultTabIndex = i)}
						class="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors {resultTabIndex ===
						i
							? 'text-white'
							: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
						style={resultTabIndex === i ? `background-color: ${teamHex};` : ''}
					>
						Tab {tr.tabIndex} <span class="ml-1 text-xs opacity-70">{tabBase}/{tr.maxTotal}</span>
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
						<!-- The badge and the ✓/~/✗ marker are BASE-only: fr.score is the
						     team's contribution (main + bonus artists), fr.maxScore is the
						     base max. Comparing those two directly would call a perfect
						     answer with a bonus artist "partial" (or worse, score > max).
						     The bonus is shown separately, in the star lines below. -->
						{@const baseScore = fr.score - (fr.bonusScore ?? 0)}
						{@const isPartial = baseScore > 0 && baseScore < fr.maxScore}
						{@const isCorrect = baseScore === fr.maxScore}
						{@const reviewKey = `tab_${resultTab.tabPosition}_slot_${slot.slotIndex}_${fr.field}`}

						{#if i > 0}<div class="border-t border-zinc-800"></div>{/if}
						<div class="py-3">
							<div class="flex items-center justify-between">
								<div>
									<div
										class="mb-0.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
									>
										{fieldLabel(fr.field)}
										{#if fr.isBonus}
											<span
												class="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 normal-case"
												>Bonus</span
											>
										{/if}
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
									<!-- Which bonus artists the player caught, and what each was worth.
									     The badge on the right is the field TOTAL (mains + bonus); these
									     lines name the bonus part of it — additional detail, not a
									     replacement. Only matched artists are listed, so a missed bonus
									     artist renders nothing at all. -->
									{#each fr.bonusArtists ?? [] as ba (ba.name)}
										<div
											class="mt-1 flex items-center gap-1.5 text-xs font-semibold text-amber-300"
										>
											<span>⭐</span>
											<span>{ba.name}</span>
											<span class="text-amber-400/70">+{ba.points} bonus</span>
										</div>
									{/each}
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
									<div class="text-sm text-zinc-400">
										{#if fr.isBonus}
											+{fr.score} bonus
										{:else}
											+{baseScore} / {fr.maxScore}
										{/if}
									</div>
								</div>
							</div>

							{#if (baseScore === 0 || isPartial) && data.fieldModes[fr.field] === 'open_text'}
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
								<div
									class="mb-0.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase"
								>
									{fieldLabel(fr.field)}
									{#if fr.isBonus}
										<span
											class="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 normal-case"
											>Bonus</span
										>
									{/if}
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
								<div class="text-sm text-zinc-400">
									{#if fr.isBonus}
										+{fr.score} bonus
									{:else}
										+{fr.score} / {fr.maxScore}
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if result.breakdown}
			<BonusTracker breakdown={result.breakdown} teamColor={teamHex} />
		{/if}

		<!--
			Three quantities, side by side, instead of one merged "N out of M":
			base points | bonus + extras | total. Total is the hero (it's the number
			that lands on the leaderboard) and keeps the count-up animation; the other
			two explain how it was reached. base + bonus === total always, by
			construction — see baseTotal/extrasTotal above.
		-->
		<div
			class="mb-6 grid grid-cols-3 rounded-2xl border p-5 text-center"
			style="border-color: {teamHex}40; background-color: {teamHex}1a;"
		>
			<div class="flex flex-col justify-center px-1">
				<div class="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">Base</div>
				<div class="text-2xl font-black text-white tabular-nums">{baseTotal}</div>
				{#if result.thresholdMax}
					<div class="text-[10px] text-zinc-500">of {result.thresholdMax}</div>
				{/if}
			</div>

			<div class="flex flex-col justify-center border-x px-1" style="border-color: {teamHex}33;">
				<div class="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">Bonus</div>
				<!-- Amber ties this to the ⭐ bonus-artist lines above. A no-bonus
				     challenge shows a dimmed 0 rather than hiding the cell, so the three
				     columns don't reflow between challenges. -->
				<div
					class="text-2xl font-black tabular-nums {extrasTotal > 0
						? 'text-amber-300'
						: 'text-zinc-600'}"
				>
					{extrasTotal > 0 ? `+${extrasTotal}` : '0'}
				</div>
			</div>

			<div class="flex flex-col justify-center px-1">
				<div class="text-[10px] font-bold tracking-wider text-zinc-400 uppercase">Total</div>
				<div class="text-4xl font-black text-white tabular-nums transition-none">
					{animatedScore}
				</div>
			</div>
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
		<!-- Freeze overlay (stuk 2): blocking frost layer, clears itself after 30s
		     client-side — no server round-trip, it's a marker row only. -->
		{#if isFrozen}
			<div
				class="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-cyan-950/70 backdrop-blur-md"
			>
				<span class="text-6xl">🧊</span>
				<p class="text-lg font-black text-white">Frozen by {freezeSourceName}!</p>
				<p class="font-mono text-3xl font-black text-cyan-200 tabular-nums">
					{Math.ceil(freezeRemainingMs / 1000)}s
				</p>
			</div>
		{/if}

		<!-- Tap-to-break lock (stuk 3 FINAL): blocking overlay, persists across a
		     reload via data.activeEffects (the row stays non-consumed until broken).
		     The overlay itself owns tap counting + the break POST. -->
		{#if tapLock}
			<TapToBreakOverlay
				effectId={tapLock.effectId}
				sourceName={tapLock.sourceName}
				tapsRequired={tapLock.tapsRequired}
				onbreak={() => (tapLock = null)}
			/>
		{/if}

		<!-- Time-drain toast (stuk 2) -->
		{#if drainToast}
			<div class="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
				<div
					class="flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-950/90 px-4 py-2.5 text-sm font-semibold text-red-200 shadow-2xl backdrop-blur-sm"
				>
					<span class="text-lg">⏳</span>
					<span>−15s — {drainToast.sourceName} drained your time!</span>
				</div>
			</div>
		{/if}

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

		{#if data.activeSetId}
			<IncomingEffectsListener
				teamId={data.team.id}
				setId={data.activeSetId}
				effects={data.activeEffects}
			/>
		{/if}

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
					variantFields={activeTab?.fields ?? variantFields.map((f) => String(f))}
					tabId={activeTab?.id}
					slotIndex={activeSlotEffective}
					{revealTabs}
					setTeams={data.setTeams}
					draftSnapshot={() => JSON.stringify(buildAnswersForSubmit())}
					onactivated={onPowerupActivated}
					onlifeline={onLifelineHints}
				/>
				{#if xrayError}
					<!-- A refused X-Ray reveal (no track behind this tab, no open attempt, …).
					     Shown once here rather than under every field: the budget is one
					     thing, and a refusal costs none of it. -->
					<p class="text-xs font-semibold text-red-400">🔎 {xrayError}</p>
				{/if}
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

		<!--
			Tab strip (multi-tab). Stays behind isMultiTab: on a single-tab challenge
			the strip does not exist today, and a fill dot there would only restate
			what the one visible form already shows, while a per-tab doubt flag has
			nothing to distinguish. Adding chrome where there is none is the only way
			this could get worse for the single-tab case, so it doesn't.

			Each entry is a wrapper holding TWO sibling buttons — the tab pill and the
			doubt toggle. They cannot nest (a button inside a button is invalid), and
			the pill must keep its exact goToTab(i) behaviour.
		-->
		{#if isMultiTab}
			<div class="mb-4 flex gap-1.5 overflow-x-auto pb-1">
				{#each data.tabs as _tab, i}
					{@const status = tabFillStatus[i]}
					<div class="flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							onclick={() => goToTab(i)}
							class="flex shrink-0 items-center gap-1.5 rounded-l-lg rounded-r-sm px-3 py-1.5 text-sm font-semibold transition-colors {activeTabIndex ===
							i
								? 'text-white'
								: 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}"
							style={activeTabIndex === i ? `background-color: ${teamHex};` : ''}
						>
							<!--
								Fill dot. Outline = empty, solid yellow = partial, solid cyan =
								full — colour AND fill differ, so the three read apart without
								relying on hue alone. Both colours are existing festival tokens.
							-->
							<span
								class="h-2 w-2 shrink-0 rounded-full {status === 'full'
									? 'bg-mixup-cyan'
									: status === 'partial'
										? 'bg-mixup-yellow'
										: 'border border-zinc-500 bg-transparent'}"
								aria-hidden="true"
							></span>
							Tab {i + 1}
							<span class="sr-only">
								{status === 'full'
									? '— all answers filled in'
									: status === 'partial'
										? '— partly filled in'
										: '— nothing filled in'}{doubtTabs[i] ? ', marked as unsure' : ''}
							</span>
						</button>
						<!--
							Doubt toggle — a SECOND layer next to the fill dot, never a
							replacement for it. Session-only (see doubtTabs).
						-->
						<button
							type="button"
							onclick={() => toggleDoubt(i)}
							aria-pressed={doubtTabs[i]}
							title={doubtTabs[i]
								? `Tab ${i + 1}: unsure — tap to clear`
								: `Mark tab ${i + 1} as unsure`}
							class="flex h-[30px] w-6 shrink-0 items-center justify-center rounded-l-sm rounded-r-lg text-sm font-black transition-colors {doubtTabs[
								i
							]
								? 'bg-mixup-magenta text-white'
								: 'bg-zinc-800 text-zinc-600 hover:text-zinc-300'}"
						>
							?
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Audio player(s) -->
		<div class="mb-6 rounded-2xl bg-zinc-900 p-5">
			{#if activeTab && activeTab.clips.length > 1}
				<!--
					Numbered clip strip at top. Was fragments-only; C2 un-gates it for any
					tab with >1 clip (standard/anthem/label tabs can now hold 2-3 ordered
					clips — a break/mid/climax — via StandardEditor). The `.length > 1`
					guard already makes this byte-identical to before for every
					single-clip tab (normal, mashup, effects), so no separate variant
					check is needed to protect that regression.

					Label: fragments keeps its "Fragment N" numbering (fragmentNumber is
					the fragments-only field, set when the host adds a fragment there).
					Normal tabs never populate fragmentNumber (C2 deliberately leaves it
					null — see StandardEditor), so they read "Part N" from the clip's
					position in the already sort_order-sorted list.
				-->
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
							{isFragments ? `Fragment ${clipItem.fragmentNumber ?? ci + 1}` : `Part ${ci + 1}`}
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

		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			bind:this={formEl}
			onkeydown={onFormKeydown}
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
			class="space-y-5 {isFrozen ? 'pointer-events-none opacity-40' : ''}"
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
					<!-- Same clamped slot the free_answer reveal is addressed to. -->
					{@const slotIdx = activeSlotEffective}
					<div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
						{#each variantFields.filter((f) => f !== 'grouping') as field (field)}
							{@const mode = data.fieldModes[field] as InputMode}
							<div class="mb-4">
								<!-- Label row: the field's own label, plus X-Ray's reveal button while a
								     budget is running. The button sits BESIDE the label, not inside it
								     (a button in a <label> hijacks the label's click), and is
								     type="button" — so the answer form is untouched: no nested form,
								     no accidental submit, and the tab dots / Next / Previous are
								     unaffected. -->
								<div class="mb-1.5 flex items-center justify-between gap-2">
									<label class="flex items-center gap-1.5 text-sm font-semibold text-zinc-400">
										{fieldLabel(field)}
										{#if isBonusField(field)}
											<span
												class="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 uppercase"
												>Bonus</span
											>
										{/if}
									</label>
									{#if xrayRemaining > 0 && !revealFor(String(field), slotIdx)}
										<button
											type="button"
											onclick={() => spendXrayReveal(String(field), slotIdx)}
											disabled={!!xraySpending}
											class="shrink-0 rounded-lg border border-amber-600/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
										>
											{xraySpending ===
											freeAnswerRevealKey(activeTab?.id ?? '', slotIdx, String(field))
												? '…'
												: `🔎 Reveal (${xrayRemaining})`}
										</button>
									{/if}
								</div>
								{#if revealFor(String(field), slotIdx)}
									<div
										class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300"
									>
										<span>💡</span>
										<span>Revealed: {revealFor(String(field), slotIdx)}</span>
									</div>
								{/if}
								<!-- Lifeline hint: read-only, never an input, never written into the
								     draft. Suppressed when this cell has a full reveal — the answer
								     beats a mask of it. Cyan rather than the reveal's amber so the
								     two never read as the same thing. -->
								{#if lifelineFor(String(field), slotIdx) && !revealFor(String(field), slotIdx)}
									<div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
										<span>🆘</span>
										<span class="font-mono tracking-[0.15em]"
											>{lifelineFor(String(field), slotIdx)}</span
										>
									</div>
								{/if}

								{#if field === 'artist' && artistIsTagged}
									<ArtistTagInput
										name="artist_{slotIdx}"
										bind:tags={artistTags[activeTabIndex][slotIdx]}
										pool={artistPool}
										accentHex={teamHex}
										placeholder={artistPool.length > 0
											? 'Search artists, Enter to add…'
											: 'Type a name, Enter to add…'}
									/>
									<p class="mt-1 text-xs text-zinc-600">
										Add every artist on the track — each one is worth part of the points.
									</p>
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
										ontouched={() => markYearTouched(activeTabIndex, slotIdx)}
									/>
								{:else if mode === 'typeable_number'}
									<YearInput
										name="{field}_{slotIdx}"
										mode="typeable_number"
										{teamHex}
										bind:value={allYearValues[activeTabIndex][slotIdx]}
										ontouched={() => markYearTouched(activeTabIndex, slotIdx)}
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
							<!-- Same label row as the multi-slot layout above, always slot 0. -->
							<div class="mb-1.5 flex items-center justify-between gap-2">
								<label class="flex items-center gap-1.5 text-sm font-semibold text-zinc-400">
									{fieldLabel(field)}
									{#if isBonusField(field)}
										<span
											class="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 uppercase"
											>Bonus</span
										>
									{/if}
								</label>
								{#if xrayRemaining > 0 && !revealFor(String(field), 0)}
									<button
										type="button"
										onclick={() => spendXrayReveal(String(field), 0)}
										disabled={!!xraySpending}
										class="shrink-0 rounded-lg border border-amber-600/50 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
									>
										{xraySpending === freeAnswerRevealKey(activeTab?.id ?? '', 0, String(field))
											? '…'
											: `🔎 Reveal (${xrayRemaining})`}
									</button>
								{/if}
							</div>
							<!-- Single-slot layout: always slot 0 of the active tab. -->
							{#if revealFor(String(field), 0)}
								<div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
									<span>💡</span>
									<span>Revealed: {revealFor(String(field), 0)}</span>
								</div>
							{/if}
							<!-- Same read-only Lifeline hint as the multi-slot layout, always slot 0. -->
							{#if lifelineFor(String(field), 0) && !revealFor(String(field), 0)}
								<div class="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
									<span>🆘</span>
									<span class="font-mono tracking-[0.15em]">{lifelineFor(String(field), 0)}</span>
								</div>
							{/if}

							{#if field === 'artist' && artistIsTagged}
								<ArtistTagInput
									name="artist"
									bind:tags={artistTags[activeTabIndex][0]}
									pool={artistPool}
									accentHex={teamHex}
									placeholder={artistPool.length > 0
										? 'Search artists, Enter to add…'
										: 'Type a name, Enter to add…'}
								/>
								<p class="mt-1 text-xs text-zinc-600">
									Add every artist on the track — each one is worth part of the points.
								</p>
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
									ontouched={() => markYearTouched(activeTabIndex, 0)}
								/>
							{:else if mode === 'typeable_number'}
								<YearInput
									name={field}
									mode="typeable_number"
									{teamHex}
									bind:value={allYearValues[activeTabIndex][0]}
									ontouched={() => markYearTouched(activeTabIndex, 0)}
								/>
							{/if}
						</div>
					{/each}
				{/if}
			{/key}

			<!--
				Submit exists ONLY on the last tab. Every earlier tab gets Next instead
				(type="button", so it can't submit), which is what stops a team from
				finishing a multi-tab challenge with a half answer — submit is is_final.
				A single-tab challenge takes the {:else} branch and is unchanged.
				Auto-submit at timer 0 does NOT go through this button: triggerSubmit()
				calls formEl.requestSubmit() with no submitter, which submits the form
				itself from whatever tab the team is parked on.
			-->
			{#if isMultiTab}
				<div class="flex gap-3">
					<button
						type="button"
						onclick={() => goToTab(activeTabIndex - 1)}
						disabled={activeTabIndex === 0}
						class="rounded-xl border border-zinc-700 px-6 py-4 text-lg font-black tracking-widest text-zinc-300 uppercase transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
					>
						Previous
					</button>
					{#if isLastTab}
						<button
							type="submit"
							disabled={!canSubmit}
							class="flex-1 rounded-xl py-4 text-lg font-black tracking-widest text-white uppercase transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
							style="background-color: {teamHex};"
						>
							{submitting ? 'Submitting…' : 'Submit'}
						</button>
					{:else}
						<button
							type="button"
							onclick={() => goToTab(activeTabIndex + 1)}
							class="flex-1 rounded-xl py-4 text-lg font-black tracking-widest text-white uppercase transition-colors hover:opacity-90"
							style="background-color: {teamHex};"
						>
							Next
						</button>
					{/if}
				</div>
			{:else}
				<button
					type="submit"
					disabled={!canSubmit}
					class="w-full rounded-xl py-4 text-lg font-black tracking-widest text-white uppercase transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
					style="background-color: {teamHex};"
				>
					{submitting ? 'Submitting…' : 'Submit'}
				</button>
			{/if}
		</form>
	</div>
{/if}
