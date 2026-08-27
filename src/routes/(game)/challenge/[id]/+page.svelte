<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import type {
		AnswerField,
		InputMode,
		ChallengeResult,
		FieldResult,
		TabFieldResult
	} from '$lib/types/index.js';
	import Combobox from '$lib/components/ui/Combobox.svelte';
	import MultipleChoice from '$lib/components/ui/MultipleChoice.svelte';
	import OpenText from '$lib/components/ui/OpenText.svelte';
	import YearInput from '$lib/components/ui/YearInput.svelte';
	import ArtistTagInput from '$lib/components/ui/ArtistTagInput.svelte';
	import { parseArtistTags, joinArtistTags } from '$lib/artist-tags';
	import { thresholdOfFields } from '$lib/threshold';
	import {
		freeAnswerRevealKey,
		type LifelineHint,
		type RevealResult,
		type EyeTeam
	} from '$lib/powerups-meta';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import Waveform from '$lib/components/ui/Waveform.svelte';
	import BonusTracker from '$lib/components/game/BonusTracker.svelte';
	import TutorialOverlay from '$lib/components/game/TutorialOverlay.svelte';
	import HeldPowerups from '$lib/components/game/HeldPowerups.svelte';
	import ActiveEffectsBanner from '$lib/components/game/ActiveEffectsBanner.svelte';
	import IncomingEffectsListener from '$lib/components/game/IncomingEffectsListener.svelte';
	import PowerupRevealModal from '$lib/components/game/PowerupRevealModal.svelte';
	import TapToBreakOverlay from '$lib/components/game/TapToBreakOverlay.svelte';
	import FreezeOverlay from '$lib/components/game/FreezeOverlay.svelte';
	import { powerupIcon } from '$lib/mixup-assets';
	import AllSeeingEyeModal from '$lib/components/game/AllSeeingEyeModal.svelte';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import TrackSegmentBar from '$lib/components/game/TrackSegmentBar.svelte';
	import { teamHex as teamHexFor, teamOnColor } from '$lib/team-theme';
	import { stripSetNameFromTitle } from '$lib/challenge-title';
	import {
		freshPhase,
		nextPhase,
		pointsButton,
		promisedCount,
		resumePhase,
		splitEarned,
		type ResultPhase
	} from '$lib/result-flow';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Teamkleur uit de gedeelde fase-1/2-bron (src/lib/team-theme.ts), niet uit
	// een eigen kopie: de actieve tab, de jaarchips en de play-knop van scherm 7B
	// moeten dezelfde kleur dragen als de team-hub en de randomizer.
	const teamHex = $derived(teamHexFor(data.team.color));
	/** Leesbare tekstkleur op een vlak in de teamkleur (geel is te licht voor wit). */
	const teamOn = $derived(teamOnColor(data.team.color));

	// Kop van het antwoordformulier: alleen de challenge, niet de set. Hosts
	// noemen challenges "<Setnaam> <Challenge>" ("Vrienden Weekend 2026
	// Hitster"), en op 7B is die prefix ruis. Weergave-only — de titel in de
	// database blijft ongemoeid, en zonder setnaam-overlap staat er gewoon de
	// volledige titel.
	const challengeTitle = $derived(stripSetNameFromTitle(data.challenge.title, data.activeSetName));

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

	// Aantal te raden tracks, voor de variant-pil op de pre-game poort. Som van de
	// bron-tracks over alle tabs: een mashup met 3 bronnen in één tab telt als 3,
	// een standaard challenge met 5 tabs als 5.
	const gateTrackCount = $derived(
		data.tabs.reduce((n, t) => n + Math.max(t.sourceTracks.length, 1), 0)
	);

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

	// Kleurtrap van de klok uit de designbron (7B): boven een minuut gedempt,
	// onder een minuut geel, laatste 30 seconden magenta — telkens met een
	// bijpassende glow eronder.
	const timerSec = $derived(timerMs === null ? null : Math.ceil(timerMs / 1000));
	const timerColor = $derived(
		timerSec === null
			? '#8E9BC9'
			: timerSec > 60
				? '#8E9BC9'
				: timerSec > 30
					? '#FFE600'
					: '#FF2DAA'
	);
	const timerGlow = $derived(
		timerSec === null
			? 'rgba(142,155,201,0.2)'
			: timerSec > 60
				? 'rgba(142,155,201,0.2)'
				: timerSec > 30
					? 'rgba(255,230,0,0.4)'
					: 'rgba(255,45,170,0.55)'
	);

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
			// De server stuurt de hele powerup_types-rij mee (select('*') in
			// awardPowerups), dus deze staat er al in. Hij wordt hier pas
			// gedeclareerd omdat de resultaatflow hem nodig heeft: 'punishment' is
			// wat een strafshot onderscheidt van een prijs.
			category?: string | null;
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
	/**
	 * Strafshots hebben hun eigen wachtrij, want ze horen in de flow op een andere
	 * plek: helemaal vooraan, vóór het puntenscherm. De scheidslijn (`isPunishment`)
	 * en alle andere fasebeslissingen staan in $lib/result-flow, zodat ze zonder
	 * database te controleren zijn — zie tests/bots/verify-result-flow.ts.
	 */
	let penaltyQueue = $state<EarnedPowerup[]>([]);
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

	/**
	 * Wachtkamer tussen "de server heeft iets toegekend" en "de kaart gaat open".
	 *
	 * Bij het inleveren komen `result` en `earnedPowerups` in dezelfde flush
	 * binnen. Zonder wachtkamer opent de kaart in de frame waarin ook het
	 * resultaat verschijnt, en die kaart dekt het scherm volledig af: de speler
	 * kreeg zijn powerup vóór hij wist hoeveel hij goed had.
	 *
	 * WAT HIER VERANDERDE: de kamer werd geleegd zodra de count-up op TOTAAL
	 * stilstond, met een timer van 2,5 s als vangnet omdat rAF stilligt als de
	 * speler wegschakelt. Dat was een gok naar "heeft hij het gezien?". De fasen
	 * hieronder maken er een antwoord van: de kamer gaat open als de speler zélf
	 * op "PAK JE POWERUPS" drukt. De count-up hoeft niets meer te bewaken en het
	 * vangnet is niet langer nodig.
	 */
	let pendingEarned = $state<EarnedPowerup[]>([]);

	$effect(() => {
		const earned = f?.earnedPowerups;
		if (earned && earned.length && earned !== handledEarnRef) {
			handledEarnRef = earned;
			pendingEarned = [...pendingEarned, ...withSpun(earned as EarnedPowerup[])];
		}
	});

	/**
	 * ONAFGEMAAKTE ONTHULLINGEN VAN EEN VORIGE SESSIE.
	 *
	 * De server geeft elke team_powerups-rij van deze challenge mee die nog op
	 * 'pending' staat — zie de load. Dat is de speler die halverwege wegging.
	 * Ze gaan door dezelfde wachtkamer als een verse toekenning, dus de rest van
	 * de flow hoeft geen onderscheid te maken.
	 *
	 * `withSpun` hoeft er NIET overheen: een Power Spin die al gedraaid heeft,
	 * heeft zijn prijs als eigen team_powerups-rij gekregen, en die staat dan
	 * gewoon zelf in deze lijst.
	 */
	let seededPending = false;
	$effect(() => {
		if (seededPending) return;
		seededPending = true;
		const seed = (data.pendingEarnedPowerups ?? []) as EarnedPowerup[];
		if (seed.length) pendingEarned = [...untrack(() => pendingEarned), ...seed];
	});

	$effect(() => {
		if (!pendingEarned.length) return;
		const binnen = pendingEarned;
		pendingEarned = [];
		// Geen resultatenscherm in beeld — Power Spin activeert ook vanaf het
		// antwoordformulier — dan is er geen fase om op te wachten en is er ook
		// niets om een straf vóór te laten gaan.
		if (!result) {
			earnedQueue = [...untrack(() => earnedQueue), ...binnen];
			return;
		}
		const { penalties, prizes } = splitEarned(binnen);
		penaltyQueue = [...untrack(() => penaltyQueue), ...penalties];
		earnedQueue = [...untrack(() => earnedQueue), ...prizes];
	});

	/* ══ RESULTAATFLOW · FASEN ══════════════════════════════════════════════════
	   Vier fasen op ÉÉN scherm, niet vier routes. De afweging:

	   · `earnedPowerups` bestaat alleen in de terugkeerwaarde van de
	     submit-action. Voor een immediate_use-type draagt die een `activation`
	     mee (onthulde waarde, geblokkeerd ja/nee, de prijs van een Power Spin) en
	     dat is niet uit de database terug te halen — status is dan al 'consumed'.
	     Een routewissel zou die gegevens weggooien.
	   · De count-up, de realtime-subscription op `submissions` die `liveScore` en
	     `liveStatus` bijwerkt, het review-formulier en de onthullingswachtrij
	     hangen allemaal aan `result` op DEZE pagina. Over routes verdeeld zou elk
	     van die vier opnieuw opgetuigd of gedupliceerd moeten worden.
	   · Eis 4 is "zodra de laatste bewaard of gebruikt is, direct door" — als
	     fase is dat één toestandsovergang; als route een navigatie met
	     staatoverdracht.
	   · De terugknop van de browser zou over routes de speler terugzetten in een
	     onthulling die hij al afgehandeld heeft. Die powerup is dan al bewaard of
	     weg; de kaart nog een keer tonen zou liegen. Tussen fasen valt er niets
	     terug te lopen.

	   Wat het kost: geen eigen URL per fase. Geen van deze standen is er een om
	   te delen of te bookmarken, dus dat is geen verlies.

	   De volgorde: straf · punten · powerups · resultaten.
	   ────────────────────────────────────────────────────────────────────────── */
	/**
	 * DE TERUGKEREND SPELER, synchroon bepaald.
	 *
	 * Wie de app halverwege wegdrukt en terugkomt, laadt de pagina opnieuw met
	 * `priorResult` gevuld. Waar hij dan landt, hangt af van wat er nog
	 * openstaat — en dat weet de server al vóór de eerste frame:
	 *
	 *   nog openstaande powerups  ->  'points', met de belofte er weer bij
	 *   niets meer open           ->  'details', het resultatenscherm zelf
	 *
	 * Dit staat expres NIET in een $effect. Een effect draait na de eerste
	 * render, en dan zou de terugkeerder die op 'details' hoort te landen eerst
	 * een frame puntenscherm zien. Bij een verse inlevering kan die flits niet
	 * bestaan — daar stond het antwoordformulier nog in beeld — dus daar mag de
	 * overgang wél uit een effect komen.
	 *
	 * Een strafshot komt hier niet terug. Hij is immediate_use: bij het toekennen
	 * meteen geactiveerd, status 'consumed', en als activity_log-regel vastgelegd.
	 * De verplichting staat dus op het scherm van de host op /admin/live en gaat
	 * niet verloren doordat de speler de kaart niet gezien heeft — maar hij is ook
	 * niet opnieuw op te roepen, want er is geen openstaande rij meer.
	 */
	let resultPhase = $state<ResultPhase | null>(
		// `untrack` omdat deze lezing bewust EENMALIG is: dit is de instapfase, geen
		// waarde die met `data` mee hoort te bewegen. Zonder untrack leest Svelte dit
		// als een reactieve verwijzing die per ongeluk buiten een $derived is blijven
		// staan en waarschuwt hij erover — terecht, want dat is meestal een fout.
		untrack(() => resumePhase(!!data.priorResult, (data.pendingEarnedPowerups ?? []).length))
	);

	/**
	 * De instapfase na een VERSE inlevering.
	 *
	 * Het wachten op een lege `pendingEarned` is wat maakt dat hier al vaststaat
	 * of er een straf tussen zit: de wachtkamer loopt in dezelfde ronde leeg.
	 */
	$effect(() => {
		if (!result || resultPhase !== null || pendingEarned.length) return;
		resultPhase = freshPhase(penaltyQueue.length);
	});

	/**
	 * De automatische overgangen: straf afgetikt -> punten, laatste powerup
	 * afgehandeld -> DIRECT de resultaten. Geen tussenklik; het legen van de
	 * wachtrij ís de overgang.
	 */
	$effect(() => {
		if (!resultPhase) return;
		resultPhase = nextPhase(resultPhase, {
			penalties: penaltyQueue.length,
			prizes: earnedQueue.length
		});
	});

	/**
	 * Het aantal dat het puntenscherm belooft.
	 *
	 * De prijs van een Power Spin telt NIET mee. Hij bestaat pas doordat de speler
	 * aan het wiel trekt, en meetellen zou vooraf verklappen dat er een spin in
	 * zit én dat die iets opgeleverd heeft. De spin zelf telt als één; zijn prijs
	 * komt er tijdens de onthullingen als verrassing achteraan.
	 *
	 * Strafshots tellen ook niet mee: die zijn op dit punt al afgetikt, en ze zijn
	 * geen powerup om te halen.
	 */
	const powerupsTeHalen = $derived(promisedCount(earnedQueue));
	const puntenKnop = $derived(pointsButton(powerupsTeHalen));

	/**
	 * Het puntenscherm: hoeveel velden helemaal goed, van hoeveel.
	 *
	 * Dezelfde telling als de per-tab-badges op het resultatenscherm (tabMarks),
	 * over alle tabs opgeteld, zodat de twee schermen elkaar niet kunnen
	 * tegenspreken. Bonusvelden tellen niet mee — die zitten niet in het
	 * "hoeveel moest ik weten"-totaal.
	 *
	 * Het PERCENTAGE hoort bij deze twee getallen en is dus goed/totaal. Dat is
	 * bewust NIET het scorepercentage waar de powerup-ladder op werkt: dat rekent
	 * met deelpunten (een antwoord van 80% gelijkenis levert punten maar geldt
	 * hier niet als goed). Eén scherm, één rekensom — de punten zelf staan een
	 * fase verderop volledig uitgesplitst.
	 */
	const antwoordScore = $derived.by(() => {
		let ok = 0;
		let total = 0;
		for (const t of result?.tabs ?? []) {
			const m = tabMarks(t);
			ok += m.ok;
			total += m.total;
		}
		// Oudere resultaten zonder tabs dragen hun velden plat in `tracks`.
		if (total === 0) {
			for (const tr of result?.tracks ?? []) {
				for (const fr of tr.fields ?? []) {
					if (fr.isBonus) continue;
					total++;
					if (baseScoreOf(fr) === fr.maxScore) ok++;
				}
			}
		}
		return { ok, total, pct: total > 0 ? Math.round((ok / total) * 100) : 0 };
	});

	// ── Validation ────────────────────────────────────────────────────────────
	const canSubmit = $derived(!submitting && !result);
	const formError = $derived<string | null>(f?.formError ?? null);
	const reviewError = $derived<string | null>(f?.reviewError ?? null);

	// ── Resultaten-accordeon (scherm 8) ───────────────────────────────────────
	// De designbron toont elke track als een uitklapkaart in plaats van de oude
	// tabstrip; de eerste staat open. Puur weergave — de scores zelf komen
	// onveranderd uit `result` / de realtime-subscription.
	//
	// De oude `resultTabIndex` (en de `resultTab`/`resultTrack` die eruit
	// werden afgeleid) is daarmee vervallen: elke tab rendert nu, in plaats van
	// alleen de geselecteerde. De legacy platte weergave (`result.tracks`, voor
	// resultaten van vóór de tab-architectuur) loopt om dezelfde reden over de
	// volledige lijst.
	let openResultTab = $state(0);
	function toggleResultTab(i: number) {
		openResultTab = openResultTab === i ? -1 : i;
	}

	/**
	 * BASIS-score van een veld: `score` is de teambijdrage inclusief bonusartiesten,
	 * `maxScore` is de basis-max. Rechtstreeks vergelijken zou een perfect antwoord
	 * mét bonusartiest als "deels goed" markeren — dezelfde splitsing die de
	 * bestaande veldrijen al maken.
	 */
	const baseScoreOf = (fr: FieldResult) => fr.score - (fr.bonusScore ?? 0);

	/** "x/y GOED" per resultaat-tab, over alle slots heen. */
	function tabMarks(t: TabFieldResult): { ok: number; total: number } {
		let ok = 0;
		let total = 0;
		for (const slot of t.slots) {
			for (const fr of slot.fields) {
				if (fr.isBonus) continue;
				total++;
				if (baseScoreOf(fr) === fr.maxScore) ok++;
			}
		}
		return { ok, total };
	}

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

	// ── All Seeing Eye ────────────────────────────────────────────────────────
	// The finished teams' answers, ALREADY STRIPPED server-side (stripAnswersForEye
	// ran once at activation). This page never derives anything from them — it has
	// no correct answer to compare against, which is what makes "no right/wrong
	// marking" a property of the data rather than a rendering choice that could be
	// undone later.
	//
	// Seeded from the load (the stored snapshot, so it survives a refresh) and
	// replaced when an activation returns a fresh one. Same two-source pattern the
	// reveals use.
	// Derived rather than seeded state: the load's stored snapshot is the baseline,
	// and a fresh activation overrides it. That way a re-run load stays authoritative
	// without an effect having to copy it across.
	let eyeFromActivation = $state<EyeTeam[] | null>(null);
	const eyeTeams = $derived(eyeFromActivation ?? data.allSeeingEye ?? []);
	let showEyeModal = $state(false);

	$effect(() => {
		const eye = f?.allSeeingEye;
		if (eye && eye.challengeId === data.challenge.id) {
			eyeFromActivation = eye.teams;
			showEyeModal = true;
		}
	});

	/* ── Toetsenbord-inzet voor de sticky powerup-balk ────────────────────────
	   De balk is een harde eis: altijd zichtbaar en klikbaar. `position: sticky;
	   bottom: 0` levert dat overal — behalve op iOS met een open toetsenbord.
	   Daar krimpt het layout-viewport niet mee, dus alles wat aan de onderkant
	   hangt verdwijnt achter het toetsenbord.

	   visualViewport weet wél hoeveel er bedekt is. Die hoogte gaat als
	   `--kb-inset` naar de balk, die er dan precies bovenop komt te staan.
	   Browsers zonder visualViewport houden 0 en gedragen zich als voorheen. */
	onMount(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const root = document.documentElement;
		const update = () => {
			const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
			// Onder de ~80px is het geen toetsenbord maar de in-/uitklappende
			// adresbalk; die mag de balk niet laten wiebelen tijdens het scrollen.
			root.style.setProperty('--kb-inset', covered > 80 ? `${Math.round(covered)}px` : '0px');
		};
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
			root.style.removeProperty('--kb-inset');
		};
	});

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
	// Speler-facing labels zijn Nederlands, net als de rest van de speler-flow
	// (fase 2) en de designbron ("ARTIEST", "TITEL", "UIT WELK JAAR?").
	const FIELD_LABELS: Record<string, string> = {
		artist: 'Artiest',
		title: 'Titel',
		year: 'Uit welk jaar?',
		label: 'Platenlabel',
		festival: 'Festival',
		vocal_source: 'Vocal',
		grouping: 'Welke fragmenten?'
	};
	function fieldLabel(field: AnswerField) {
		return FIELD_LABELS[field as string] ?? field;
	}

	// Korte variant voor de resultaatrijen (scherm 8): daar staat het label in een
	// smalle kolom naast het gegeven antwoord, dus "Uit welk jaar?" past niet.
	const RESULT_FIELD_LABELS: Record<string, string> = {
		artist: 'Artiest',
		title: 'Titel',
		year: 'Jaar',
		label: 'Label',
		festival: 'Festival',
		vocal_source: 'Vocal',
		grouping: 'Groep'
	};
	function resultFieldLabel(field: AnswerField) {
		return RESULT_FIELD_LABELS[field as string] ?? fieldLabel(field);
	}

	const bonusFieldSet = $derived(new Set(data.bonusFields));
	function isBonusField(field: AnswerField) {
		return bonusFieldSet.has(String(field));
	}

	let reviewingKey = $state<string | null>(null);

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

	/**
	 * Count-up naar de eindscore (scherm 8).
	 *
	 * Twee eisen uit de designspec, allebei expliciet afgedwongen:
	 *
	 *  1. STOPT EXACT OP DE EINDWAARDE. De laatste frame zet `target` letterlijk,
	 *     zonder afronding van een interpolatie — een frame die net na `dur`
	 *     valt kan anders op target±1 blijven staan.
	 *  2. TIMER OPGERUIMD BIJ UNMOUNT. De teardown van dit effect cancelt de
	 *     lopende rAF, dus er loopt nooit een teller door op een verdwenen
	 *     scherm (en een nieuwe score herstart hem netjes vanaf de huidige stand).
	 *
	 * `from` wordt met `untrack` gelezen: `animatedScore` is ook wat dit effect
	 * schrijft, dus zonder untrack zou elke frame het effect opnieuw laten
	 * starten en de easing per frame resetten.
	 */
	$effect(() => {
		// De count-up is de laatste beweging van het resultatenscherm. Vroeger begon
		// hij zodra `result` er was; met de fasen kan dat scherm pas later in beeld
		// komen, en dan zou de teller al uitgeteld zijn voordat iemand hem ziet.
		// Hij start nu mét de fase waar hij bij hoort. Zolang `result` er niet is
		// (Power Spin vanaf het antwoordformulier) is er ook geen scherm om op te
		// wachten.
		if (result && resultPhase !== 'details') return;
		const target = liveScore ?? 0;
		const from = untrack(() => animatedScore);
		if (target === from) return;
		if (target === 0) {
			animatedScore = 0;
			return;
		}
		const dur = Math.min(1400, 400 + Math.abs(target - from) * 8);
		const startTime = performance.now();
		let rafId = 0;
		const tick = (now: number) => {
			const p = Math.min((now - startTime) / dur, 1);
			if (p >= 1) {
				animatedScore = target;
				return;
			}
			const eased = 1 - Math.pow(1 - p, 3);
			animatedScore = Math.round(from + (target - from) * eased);
			rafId = requestAnimationFrame(tick);
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

<!--
	STAP 1 — de strafshot, apart en vóór alles. Hij verschijnt boven het
	puntenscherm, dus de speler ziet zijn cijfers al staan terwijl hij de straf
	wegtikt, maar hij komt er niet omheen: de kaart dekt het scherm af en de
	knoppenrij eronder bestaat in deze fase nog niet.
-->
{#if resultPhase === 'penalty' && penaltyQueue.length > 0}
	{#key penaltyQueue[0].teamPowerupId}
		<PowerupRevealModal
			teamPowerupId={penaltyQueue[0].teamPowerupId}
			type={penaltyQueue[0].type}
			activation={penaltyQueue[0].activation}
			teamId={data.team.id}
			setTeams={data.setTeams}
			onclose={() => (penaltyQueue = penaltyQueue.slice(1))}
		/>
	{/key}
{/if}

<!--
	STAP 4 — de powerups, één voor één, precies zoals ze al gingen. De wachtrij
	loopt leeg en dat legen ís de overgang naar de resultaten; er zit geen
	tussenklik meer tussen de laatste kaart en het resultatenscherm.

	`!result` houdt het pad open dat geen fasen kent: een Power Spin die vanaf
	het antwoordformulier geactiveerd wordt, heeft geen resultaatflow om in te
	passen en toont zijn kaart meteen.
-->
{#if (resultPhase === 'powerups' || !result) && earnedQueue.length > 0}
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

{#if showEyeModal && eyeTeams.length}
	<AllSeeingEyeModal
		teams={eyeTeams}
		fields={data.variantFields}
		onclose={() => (showEyeModal = false)}
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
{:else if result && resultPhase !== 'details'}
	<!--
		── Scherm 8A · PUNTENSCHERM ─────────────────────────────────────────────
		STAP 2 en 3 van de resultaatflow. Wat hier staat is de UITSLAG in één
		oogopslag — hoeveel goed van hoeveel, het percentage — plus de belofte:
		HOEVEEL powerups er te halen zijn. Nog niet WELKE; dat is precies wat de
		onthullingskaarten erna doen, en het vooraf verklappen zou die kaarten
		leeghalen.

		Onder de fasen 'penalty' en 'powerups' staat dit scherm óók: het is de
		achtergrond waar de kaart overheen valt. De knoppenrij hangt daarom aan
		fase 'points' — tijdens een kaart is er niets te kiezen.

		Dezelfde vormtaal als het resultatenscherm erna: teampil + challengetitel
		boven, display-kop, glaskaarten, en de knop in het geel-oranje verloop dat
		elders in deze flow "ga verder" betekent.
	-->
	<PlayerScreen class="px-5">
		<div class="flex items-center justify-between">
			<span class="flex items-center gap-[7px] rounded-full px-3 py-1.5 mixup-glass squircle">
				<span
					class="h-2.5 w-2.5 rounded-full"
					style="background: {teamHex}; box-shadow: 0 0 10px {teamHex};"
				></span>
				<span class="text-[11px] font-extrabold tracking-[0.1em] text-mixup-paper uppercase"
					>{data.team.display_name}</span
				>
			</span>
			<span class="truncate pl-3 text-[11px] font-medium tracking-[0.12em] text-mixup-muted"
				>{data.challenge.title}</span
			>
		</div>

		<div class="flex min-h-0 flex-1 flex-col justify-center gap-4 py-4">
			<h1
				class="font-display text-[34px] leading-[0.95] font-black text-mixup-paper uppercase"
				style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
			>
				Ingeleverd
			</h1>

			<!-- Goed van totaal, en het percentage dat daarbij hoort. -->
			<div class="rounded-mixup-lg p-5 text-center mixup-glass-strong squircle">
				<div class="font-display text-[64px] leading-none font-black tabular-nums">
					<span class="text-mixup-yellow">{antwoordScore.ok}</span><span class="text-mixup-dim"
						>/{antwoordScore.total}</span
					>
				</div>
				<div class="mt-1.5 text-[10px] font-extrabold tracking-[0.18em] text-mixup-muted uppercase">
					Goed beantwoord
				</div>
				<div
					class="mt-3 inline-flex items-center rounded-full px-3.5 py-1.5"
					style="background: rgba(0,229,255,0.10); border: 1px solid rgba(0,229,255,0.45);"
				>
					<span class="font-display text-lg font-black text-mixup-cyan tabular-nums"
						>{antwoordScore.pct}%</span
					>
				</div>
			</div>

			<!--
				De belofte. Bij nul powerups blijft de kaart staan met de nulstand: dat
				is óók een uitslag, en hem weglaten zou het scherm laten springen
				tussen de twee gevallen.
			-->
			<div
				class="flex items-center gap-3 rounded-mixup-lg p-4 mixup-glass squircle"
				class:powerup-belofte--geen={powerupsTeHalen === 0}
			>
				<span
					class="powerup-belofte__getal font-display text-[34px] leading-none font-black tabular-nums"
				>
					{powerupsTeHalen}
				</span>
				<!-- Ook bij nul dezelfde zin, alleen enkelvoud/meervoud. "0 powerups te
				     halen" leest als één mededeling; een aparte nulzin naast een
				     gedempte 0 leest als een tikfout. -->
				<span class="min-w-0 flex-1 text-[13px] font-semibold text-mixup-paper">
					{powerupsTeHalen === 1 ? 'powerup' : 'powerups'} te halen
				</span>
			</div>
		</div>

		<!--
			STAP 3 — één knop. Zijn er powerups, dan brengt hij je naar de kaarten;
			zijn ze er niet, dan rechtstreeks naar de resultaten. Twee bestemmingen,
			nooit twee knoppen.
		-->
		{#if resultPhase === 'points'}
			<div class="pb-2">
				<button
					type="button"
					onclick={() => (resultPhase = puntenKnop.next)}
					class="flex h-[54px] w-full items-center justify-center rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle"
					style="background: linear-gradient(90deg,#FFE600,#FF7F11); color: #1A1400; box-shadow: 0 10px 30px rgba(255,127,17,0.35);"
				>
					{puntenKnop.label}
				</button>
			</div>
		{/if}
	</PlayerScreen>
{:else if result}
	<!--
		── Scherm 8 · RESULTATEN ────────────────────────────────────────────────
		Bron: design/"M!XUP Player Flow v2.dc.html", artboard "8 Resultaten".
		Kop + teampil boven, uitklapkaart per track in het midden, en onderaan
		de drie cellen BASIS · BONUS · TOTAAL met de count-up op TOTAAL.

		Alles hieronder is presentatie. De review-aanvraag draait nog steeds via
		dezelfde `?/requestReview` action met exact dezelfde velden, en de score
		komt onveranderd uit `result` / de realtime-subscription.
	-->
	<PlayerScreen class="px-5">
		<div class="flex items-center justify-between">
			<span class="flex items-center gap-[7px] rounded-full px-3 py-1.5 mixup-glass squircle">
				<span
					class="h-2.5 w-2.5 rounded-full"
					style="background: {teamHex}; box-shadow: 0 0 10px {teamHex};"
				></span>
				<span class="text-[11px] font-extrabold tracking-[0.1em] text-mixup-paper uppercase"
					>{data.team.display_name}</span
				>
			</span>
			<span class="truncate pl-3 text-[11px] font-medium tracking-[0.12em] text-mixup-muted"
				>{data.challenge.title}</span
			>
		</div>

		<h1
			class="mt-2.5 font-display text-[34px] leading-[0.95] font-black text-mixup-paper uppercase"
			style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
		>
			Resultaten
		</h1>

		<div class="mt-2.5 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
			{#if reviewError}
				<div
					class="rounded-mixup-sm border border-mixup-magenta/50 bg-mixup-magenta/10 p-3 text-sm text-mixup-magenta squircle"
				>
					{reviewError}
				</div>
			{/if}
			{#if reviewJustResolved && liveStatus === 'review_approved'}
				<div
					class="rounded-mixup-sm border border-mixup-green/50 bg-mixup-green/10 p-3 text-sm text-mixup-green squircle"
				>
					✓ Review goedgekeurd{pointsAwarded > 0 ? ` — +${pointsAwarded} punten erbij!` : ''}
				</div>
			{:else if reviewJustResolved && liveStatus === 'review_rejected'}
				<div class="rounded-mixup-sm p-3 text-sm text-mixup-muted mixup-glass squircle">
					Review afgewezen — je oorspronkelijke score blijft staan.
				</div>
			{/if}

			{#if (result.tabs?.length ?? 0) > 0}
				{#each result.tabs ?? [] as tr, ti (tr.tabPosition)}
					{@const marks = tabMarks(tr)}
					{@const isOpen = openResultTab === ti}
					<div class="overflow-hidden rounded-mixup-lg mixup-glass-strong squircle">
						<button
							type="button"
							onclick={() => toggleResultTab(ti)}
							aria-expanded={isOpen}
							class="flex w-full cursor-pointer items-center justify-between gap-2.5 border-none bg-transparent px-4 py-[13px]"
						>
							<span class="text-xs font-extrabold tracking-[0.12em] text-mixup-paper uppercase"
								>Track {tr.tabIndex}</span
							>
							<span class="flex items-center gap-2.5">
								<span
									class="text-[11px] font-bold tracking-[0.08em]"
									style="color: {marks.ok === marks.total ? '#2BD97A' : '#FF6FC4'};"
									>{marks.ok}/{marks.total} goed</span
								>
								<span class="font-display text-xl font-black text-mixup-yellow">+{tr.total}</span>
								<span class="text-xs font-bold text-mixup-muted">{isOpen ? '▴' : '▾'}</span>
							</span>
						</button>

						{#if isOpen}
							<div class="flex flex-col gap-2 px-4 pb-3.5">
								{#each tr.slots as slot, slotIdx (slotIdx)}
									{#if slotIdx > 0}
										<div
											class="flex items-center gap-2 pt-1 text-[10px] tracking-[0.14em] text-mixup-dim uppercase"
										>
											<span class="h-px flex-1 bg-mixup-paper/10"></span>
											<span>Slot {slotIdx + 1}</span>
											<span class="h-px flex-1 bg-mixup-paper/10"></span>
										</div>
									{/if}
									{#each slot.fields as fr (fr.field)}
										{@const baseScore = baseScoreOf(fr)}
										{@const isPartial = baseScore > 0 && baseScore < fr.maxScore}
										{@const isCorrect = baseScore === fr.maxScore}
										{@const reviewKey = `tab_${tr.tabPosition}_slot_${slot.slotIndex}_${fr.field}`}
										<div class="border-t border-mixup-paper/10 pt-2">
											<div class="flex items-baseline gap-2.5">
												<span
													class="w-3.5 shrink-0 text-sm font-extrabold"
													style="color: {isCorrect
														? '#2BD97A'
														: isPartial
															? '#FFC24B'
															: '#FF2DAA'};">{isCorrect ? '✓' : isPartial ? '~' : '✗'}</span
												>
												<span
													class="w-[62px] shrink-0 text-[10px] font-bold tracking-[0.12em] text-mixup-muted uppercase"
												>
													{resultFieldLabel(fr.field)}
												</span>
												<span class="min-w-0 flex-1 text-sm font-medium text-mixup-paper"
													>{fr.submitted || '—'}</span
												>
												<span class="shrink-0 text-right">
													{#if fr.isBonus}
														<span class="text-[11px] font-medium text-mixup-amber"
															>+{fr.score} bonus</span
														>
													{:else}
														<span class="text-[11px] font-medium text-mixup-muted"
															>+{baseScore}/{fr.maxScore}</span
														>
													{/if}
												</span>
											</div>
											{#if !isCorrect}
												<div class="mt-1 pl-6 text-[11px] font-medium" style="color: #FF6FC4;">
													Goede antwoord: {fr.correct}
													{#if fr.fuzzyScore !== undefined}
														<span class="text-mixup-dim"
															>· {Math.round(fr.fuzzyScore * 100)}% match</span
														>
													{/if}
												</div>
											{/if}
											{#each fr.bonusArtists ?? [] as ba (ba.name)}
												<div
													class="mt-1 flex items-center gap-1.5 pl-6 text-[11px] font-semibold text-mixup-amber"
												>
													<span>⭐</span>
													<span>{ba.name}</span>
													<span class="text-mixup-amber/70">+{ba.points} bonus</span>
												</div>
											{/each}

											{#if (baseScore === 0 || isPartial) && data.fieldModes[fr.field] === 'open_text'}
												{@const effectiveStatus = liveStatus ?? result.status}
												{@const alreadyRequested =
													reviewedKeys.has(reviewKey) ||
													effectiveStatus === 'review_requested' ||
													effectiveStatus === 'review_approved' ||
													effectiveStatus === 'review_rejected'}
												{#if alreadyRequested}
													<p class="mt-1.5 pl-6 text-[11px] text-mixup-amber">
														Review aangevraagd ✓
													</p>
												{:else if reviewingKey === reviewKey}
													<form
														method="POST"
														action="?/requestReview"
														class="mt-2 pl-6"
														use:enhance={() =>
															async ({ update }) => {
																reviewingKey = null;
																await update();
															}}
													>
														<input type="hidden" name="submission_id" value={result.submissionId} />
														<input type="hidden" name="team_id" value={data.team.id} />
														<input type="hidden" name="field_name" value={reviewKey} />
														<input
															type="hidden"
															name="track_id"
															value={slot.matchedTrackId ?? ''}
														/>
														<textarea
															name="player_message"
															placeholder="Optioneel: waarom denk je dat dit goed is?"
															rows="2"
															class="mb-2 w-full rounded-mixup-sm px-3 py-2 text-sm text-mixup-paper mixup-glass squircle focus:outline-none"
														></textarea>
														<div class="flex gap-2">
															<button
																type="submit"
																class="rounded-full px-3 py-1.5 text-[11px] font-bold squircle"
																style="background: {teamHex}; color: {teamOn};">Versturen</button
															>
															<button
																type="button"
																onclick={() => (reviewingKey = null)}
																class="rounded-full border border-mixup-paper/20 px-3 py-1.5 text-[11px] text-mixup-muted squircle"
																>Annuleren</button
															>
														</div>
													</form>
												{:else}
													<button
														type="button"
														onclick={() => (reviewingKey = reviewKey)}
														class="mt-1.5 ml-6 text-[11px] font-medium underline underline-offset-2"
														style="color: {teamHex};">Handmatige review aanvragen</button
													>
												{/if}
											{/if}
										</div>
									{/each}
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			{:else}
				<!-- Terugval: oud plat resultaat zonder tabs (van vóór de tab-architectuur). -->
				{#each result.tracks ?? [] as track (track.trackId)}
					<div class="flex flex-col gap-2 rounded-mixup-lg p-4 mixup-glass-strong squircle">
						<div class="text-[11px] font-extrabold tracking-[0.12em] text-mixup-yellow uppercase">
							Track {track.trackIndex} · +{track.total}
						</div>
						{#each track.fields as fr (fr.field)}
							{@const isCorrect = fr.score === fr.maxScore}
							{@const isPartial = fr.score > 0 && fr.score < fr.maxScore}
							<div class="flex items-baseline gap-2.5 border-t border-mixup-paper/10 pt-2">
								<span
									class="w-3.5 shrink-0 text-sm font-extrabold"
									style="color: {isCorrect ? '#2BD97A' : isPartial ? '#FFC24B' : '#FF2DAA'};"
									>{isCorrect ? '✓' : isPartial ? '~' : '✗'}</span
								>
								<span
									class="w-[62px] shrink-0 text-[10px] font-bold tracking-[0.12em] text-mixup-muted uppercase"
									>{resultFieldLabel(fr.field)}</span
								>
								<span class="min-w-0 flex-1 text-sm font-medium text-mixup-paper"
									>{fr.submitted || '—'}</span
								>
								<span class="shrink-0 text-[11px] font-medium text-mixup-muted"
									>+{fr.score}/{fr.maxScore}</span
								>
							</div>
						{/each}
					</div>
				{/each}
			{/if}

			{#if result.breakdown}
				<BonusTracker breakdown={result.breakdown} teamColor={teamHex} />
			{/if}
		</div>

		<!--
			Drie cellen naast elkaar: basis | bonus + extra's | totaal. Totaal is de
			held (dat is het getal dat op het leaderboard landt) en draagt de
			count-up; base + bonus === totaal, per constructie.
		-->
		<div class="mt-3 flex gap-2.5">
			<div class="flex-1 rounded-mixup-card p-2.5 text-center mixup-glass squircle">
				<div class="font-display text-2xl font-black text-mixup-paper tabular-nums">
					{baseTotal}
				</div>
				<div class="text-[9px] font-bold tracking-[0.1em] text-mixup-muted uppercase">
					Basis{#if result.thresholdMax}<span class="text-mixup-dim">
							/{result.thresholdMax}</span
						>{/if}
				</div>
			</div>
			<div class="flex-1 rounded-mixup-card p-2.5 text-center mixup-glass squircle">
				<div
					class="font-display text-2xl font-black tabular-nums {extrasTotal > 0
						? 'text-mixup-cyan'
						: 'text-mixup-dim'}"
				>
					{extrasTotal > 0 ? `+${extrasTotal}` : '0'}
				</div>
				<div class="text-[9px] font-bold tracking-[0.1em] text-mixup-muted uppercase">Bonus</div>
			</div>
			<div
				class="rounded-mixup-card p-2.5 text-center squircle"
				style="flex: 1.2; background: rgba(255,230,0,0.08); border: 1px solid rgba(255,230,0,0.5); box-shadow: 0 0 20px rgba(255,230,0,0.15);"
			>
				<div
					class="font-display text-2xl font-black tabular-nums"
					style="background: linear-gradient(90deg,#FFE600,#FF7F11); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;"
				>
					+{animatedScore}
				</div>
				<div class="text-[9px] font-bold tracking-[0.1em] text-mixup-yellow uppercase">Totaal</div>
			</div>
		</div>

		<div class="mt-3 flex flex-col items-center gap-2.5">
			<a
				href="/team"
				class="flex h-[54px] w-full items-center justify-center rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle"
				style="background: linear-gradient(90deg,#FFE600,#FF7F11); color: #1A1400; box-shadow: 0 10px 30px rgba(255,127,17,0.35);"
			>
				Terug naar je team
			</a>
			<a
				href="/leaderboard"
				class="text-xs font-semibold tracking-[0.08em] uppercase underline underline-offset-4"
				style="color: {teamHex};">Bekijk de stand →</a
			>
		</div>
	</PlayerScreen>
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
	<!--
		── Scherm 6 · PRE-GAME-POORT ────────────────────────────────────────────
		Bron: design/"M!XUP Player Flow v2.dc.html", artboard
		"6 Pre-game poort" ("TIMER START PAS BIJ TAP").

		Dit is de wachtstate vóór de start: er is nog geen challenge_attempts-rij,
		dus de timer loopt nog niet. Eén gecentreerde glaskaart met de variant-pil,
		de titel en de uitleg, daaronder de startknop en de timer-noot.

		Code-regen staat hier WEL aan (het enige scherm in deze fase dat hem heeft;
		7B en 8 hebben in de bron alleen de kristal-hoeken). CodeRain schildert zelf
		zijn ondergrond via --cr-backdrop, en de default daarvan is exact de
		radiale paginagradient die dit scherm ook heeft — dus geen override nodig.

		De start-conditie en de startknop zijn NIET aangeraakt: hetzelfde
		?/startChallenge met dezelfde use:enhance en dezelfde window.location.reload()
		bij succes, die de volle mount forceert waar onMount de countdown uit
		timerEndsAt opzet.
	-->
	<PlayerScreen rain>
		<!--
			Geen teampil en geen banner op dit scherm: het artboard laat de poort
			bewust leeg op één gecentreerde kaart na. De speler heeft zijn team al
			gezien in de lobby en op de team-console, vóór hij de challenge aantikte.
			De pil komt terug op het antwoordformulier (7B).
		-->
		<div class="flex min-h-0 flex-1 flex-col justify-center gap-4 px-5">
			<div
				class="flex flex-col gap-3.5 rounded-mixup-hero px-5 py-6 mixup-glass-strong squircle"
				style="background: linear-gradient(135deg, rgba(229,242,255,0.10), rgba(229,242,255,0.03));"
			>
				<span
					class="self-start rounded-full border px-3 py-[5px] text-[10px] font-extrabold tracking-[0.16em] text-mixup-cyan uppercase"
					style="border-color: rgba(0,229,255,0.5);"
				>
					{data.challenge.variant} · {gateTrackCount}
					{gateTrackCount === 1 ? 'track' : 'tracks'}
				</span>

				<h1
					class="font-display text-[44px] leading-[0.95] font-black text-mixup-paper uppercase"
					style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
				>
					{data.challenge.title}
				</h1>

				{#if data.tutorialText}
					<div
						class="flex flex-col gap-1.5 border-t pt-3"
						style="border-color: rgba(229,242,255,0.12);"
					>
						<span class="text-[11px] font-extrabold tracking-[0.14em] text-mixup-yellow uppercase"
							>Hoe werkt het</span
						>
						<p class="text-sm leading-[1.5] font-medium text-mixup-muted">{data.tutorialText}</p>
					</div>
				{/if}
			</div>

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
					class="h-[54px] w-full rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle disabled:cursor-not-allowed disabled:opacity-50"
					style="background: linear-gradient(90deg,#FFE600,#FF7F11); color: #1A1400; box-shadow: 0 10px 30px rgba(255,127,17,0.35);"
				>
					{startingChallenge ? 'Starten…' : 'Start de challenge'}
				</button>
			</form>

			<p class="text-center text-xs font-medium text-mixup-dim">⏱ De timer begint zodra je tapt</p>
		</div>
	</PlayerScreen>
{:else}
	<!--
		── Scherm 7B · ANTWOORDFORMULIER ────────────────────────────────────────
		Bron: design/"M!XUP Player Flow v2.dc.html", artboard
		"7B Antwoordformulier var B" (de definitieve variant).

		Volgorde uit de designbron: teampil + klok · titel · segmentbalk ·
		audiokaart · antwoordkaart (scrollt) · powerup-rij · navigatie.

		PUUR PRESENTATIE. De submit-weg is onveranderd: hetzelfde <form
		method="POST" action="?/submit">, dezelfde `use:enhance` die
		`answers_json` uit `buildAnswersForSubmit()` zet, dezelfde
		`formEl.requestSubmit()` bij een verlopen timer, en dezelfde
		bind:value-velden per tab/slot.

		Eén structurele noot: de powerup-rij staat in het design TUSSEN de
		antwoordkaart en de knoppenrij, maar HeldPowerups rendert een modal die
		zélf een <form> bevat — genest in het antwoordformulier zou de browser
		die binnenste form weggooien en powerup-activatie breken. De
		antwoord-<form> sluit daarom vóór de powerup-rij, en de knoppen erna
		horen er via het standaard `form="challenge-answer-form"`-attribuut nog
		steeds bij. Voor de browser is dat exact dezelfde submit.
	-->
	<!-- pageScroll: de antwoordkaart scrolt NIET meer intern. Zij groeit tot haar
	     natuurlijke hoogte en de PAGINA scrolt als geheel, zodat "de knop
	     bereiken" hetzelfde is als "alle velden gezien hebben" — een jaarslider
	     onder de vouw werd anders gemist en dat kostte punten. Wat bereikbaar
	     moet blijven, blijft dat via sticky: de kop met de klok en de audiokaart
	     bovenaan, de powerup-balk onderaan. -->
	<PlayerScreen pageScroll class="answer-screen">
		<!-- Freeze overlay (stuk 2): blocking frost layer, clears itself after 30s
		     client-side — no server round-trip, it's a marker row only. De
		     vormgeving zit sinds fase 4 in FreezeOverlay; `freezeUntil` en
		     `freezeRemainingMs` worden nog steeds hier bijgehouden. -->
		{#if isFrozen}
			<FreezeOverlay
				sourceName={freezeSourceName}
				secondsLeft={Math.ceil(freezeRemainingMs / 1000)}
			/>
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
					class="flex items-center gap-2.5 rounded-mixup-sm border border-mixup-magenta/45 bg-mixup-magenta/10 px-4 py-2.5 text-[13px] font-bold text-mixup-paper shadow-2xl backdrop-blur-[14px] squircle"
				>
					<img
						src={powerupIcon('time_drain')}
						alt=""
						class="h-[26px] w-[26px] shrink-0 object-contain"
					/>
					<span>−15s — {drainToast.sourceName} pakte je tijd af!</span>
				</div>
			</div>
		{/if}

		<!--
			STICKY BOVENZONE — kop (teampil + klok) · segmentbalk · audiokaart.

			Waarom deze drie: het zijn de instrumenten van het scherm. De klok mag
			nooit wegscrollen (een team dat de tijd niet ziet verliest punten door
			layout — precies het probleem dat we oplossen), de segmentbalk wisselt
			van track, en de audiokaart moet bereikbaar blijven om opnieuw te
			luisteren zonder eerst terug te scrollen.

			De TITEL zit er bewust niet in en staat nu ónder deze zone: die is
			identiteit, geen instrument, en kost op 34px meer verticale ruimte dan
			hij in het krapste geval waard is. Dat is de enige afwijking van de
			volgorde uit de designbron.
		-->
		<div class="stick-top">
			<!-- Teampil + klok -->
			<div class="flex items-center justify-between px-5">
				<span class="flex items-center gap-[7px] rounded-full px-3 py-1.5 mixup-glass squircle">
					<span
						class="h-2.5 w-2.5 rounded-full"
						style="background: {teamHex}; box-shadow: 0 0 10px {teamHex};"
					></span>
					<span class="text-[11px] font-extrabold tracking-[0.1em] text-mixup-paper uppercase"
						>{data.team.display_name}</span
					>
				</span>
				<div class="flex items-center gap-2">
					{#if tutorialEntry.length > 0}
						<button
							type="button"
							onclick={() => (showTutorial = true)}
							aria-label="Uitleg"
							class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold squircle"
							style="background: {teamHex}22; color: {teamHex}; border: 1px solid {teamHex}44;"
							>ⓘ</button
						>
					{/if}
					{#if data.challenge.hint_text && data.hintUsed}
						<button
							type="button"
							onclick={() => (showHintModal = true)}
							aria-label="Hint"
							class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold squircle"
							style="background: {teamHex}22; color: {teamHex}; border: 1px solid {teamHex}44;"
							>💡</button
						>
					{/if}
					<!-- Persistent re-open, the same shape the Hint button uses: once the Eye
				     has been opened on this challenge the snapshot stays available for the
				     rest of it, rather than being a one-shot the player can lose. -->
					{#if eyeTeams.length}
						<button
							type="button"
							onclick={() => (showEyeModal = true)}
							aria-label="All-seeing eye"
							class="flex h-8 w-8 items-center justify-center rounded-full border border-mixup-violet/50 bg-mixup-violet/15 text-xs font-bold text-mixup-violet squircle"
							>👁️</button
						>
					{/if}
					{#if timerMs !== null}
						<span
							class="text-[28px] leading-none font-bold tabular-nums"
							style="color: {timerColor}; text-shadow: 0 0 16px {timerGlow};">{fmtMs(timerMs)}</span
						>
					{/if}
				</div>
			</div>

			<!-- Segmentbalk: horizontaal scrollend, min-width 96px per tab, werkt bij
		     élk aantal tracks. Voedt exact dezelfde goToTab()/toggleDoubt() als
		     de oude tabstrip. -->
			{#if isMultiTab}
				<div class="px-5 pt-3 pb-2.5">
					<TrackSegmentBar
						count={data.tabs.length}
						activeIndex={activeTabIndex}
						fillStatus={tabFillStatus}
						doubt={doubtTabs}
						hex={teamHex}
						onColor={teamOn}
						onselect={goToTab}
						ontoggledoubt={toggleDoubt}
					/>
				</div>
			{/if}

			<!-- Audiokaart -->
			<div
				class="mx-5 mb-2.5 rounded-mixup-lg px-3.5 py-3 mixup-glass-strong squircle"
				style="background: linear-gradient(135deg, rgba(229,242,255,0.10), rgba(229,242,255,0.03));"
			>
				{#if activeTab && activeTab.clips.length > 1}
					<!--
					Numbered clip strip at top. Was fragments-only; C2 un-gates it for any
					tab with >1 clip (standard/anthem/label tabs can now hold 2-3 ordered
					clips — a break/mid/climax — via StandardEditor). The `.length > 1`
					guard already makes this byte-identical to before for every
					single-clip tab (normal, mashup, effects), so no separate variant
					check is needed to protect that regression.
				-->
					<div class="mb-3 flex flex-wrap gap-1.5">
						{#each activeTab.clips as clipItem, ci}
							<button
								type="button"
								onclick={() => {
									activeClipIndex = ci;
									isPlaying = false;
								}}
								class="rounded-mixup-chip px-3 py-1.5 text-xs font-bold transition-colors squircle"
								style={activeClipIndex === ci
									? `background: ${teamHex}; color: ${teamOn}; border: 1px solid ${teamHex};`
									: 'background: rgba(229,242,255,0.05); color: #9FB1D9; border: 1px solid rgba(229,242,255,0.16);'}
							>
								{isFragments ? `Fragment ${clipItem.fragmentNumber ?? ci + 1}` : `Deel ${ci + 1}`}
							</button>
						{/each}
					</div>
				{/if}

				<div class="flex items-center gap-3">
					<!-- Play-knop in de teamkleur — 56px, witte ring, gloed in dezelfde kleur. -->
					<button
						type="button"
						onclick={togglePlay}
						class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
						style="background: {teamHex}; border: 2px solid rgba(229,242,255,0.5); box-shadow: 0 0 22px {teamHex}88; color: {teamOn};"
						aria-label={isPlaying ? 'Pauze' : 'Afspelen'}
					>
						{#if isPlaying}
							<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"
								><rect x="5" y="4" width="3" height="12" rx="1" /><rect
									x="12"
									y="4"
									width="3"
									height="12"
									rx="1"
								/></svg
							>
						{:else}
							<svg class="ml-0.5 h-5 w-5" fill="currentColor" viewBox="0 0 20 20"
								><path
									d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z"
								/></svg
							>
						{/if}
					</button>
					<div class="min-w-0 flex-1 space-y-1">
						{#key `${activeTabIndex}-${activeClipIndex}`}
							<Waveform
								bind:this={waveformRef}
								src={activeTab?.clips[activeClipIndex]?.clipUrl ?? activeTab?.primaryClipUrl ?? ''}
								height={34}
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
					</div>
					<span class="shrink-0 font-data text-[11px] font-medium text-mixup-muted"
						>{timeLabel}</span
					>
				</div>
			</div>
			<!-- /stick-top -->
		</div>

		<!-- Titel — alleen de challenge-naam, zie `challengeTitle`. Staat sinds de
		     paginascroll ónder de sticky bovenzone en scrolt dus gewoon weg. -->
		<h1
			class="px-5 pt-2.5 pb-1 font-display text-[34px] leading-[0.95] font-black text-mixup-paper uppercase"
			style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
		>
			{challengeTitle}
		</h1>

		{#if data.activeSetId}
			<IncomingEffectsListener
				teamId={data.team.id}
				setId={data.activeSetId}
				effects={data.activeEffects}
				teams={data.setTeams}
			/>
		{/if}

		{#if data.activeSetId && data.activeEffects?.length > 0}
			<div class="mb-2 px-5">
				<ActiveEffectsBanner
					teamId={data.team.id}
					setId={data.activeSetId}
					effects={data.activeEffects}
				/>
			</div>
		{/if}

		{#if formError}
			<div
				class="mx-5 mb-2.5 rounded-mixup-sm border border-mixup-magenta/50 bg-mixup-magenta/10 p-3 text-sm text-mixup-magenta squircle"
			>
				{formError}
			</div>
		{/if}
		{#if timerMs === 0}
			<div
				class="mx-5 mb-2.5 rounded-mixup-sm border border-mixup-amber/50 bg-mixup-amber/10 p-3 text-sm text-mixup-amber squircle"
			>
				Tijd is om — je antwoorden worden ingeleverd…
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			id="challenge-answer-form"
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
			class="mx-4 flex flex-col gap-3 rounded-mixup-hero p-4 mixup-glass-strong squircle {isFrozen
				? 'pointer-events-none opacity-40'
				: ''}"
			style="background: linear-gradient(135deg, rgba(229,242,255,0.10), rgba(229,242,255,0.03));"
		>
			<input type="hidden" name="team_id" value={data.team.id} />

			<!-- Eyebrow: welke track je nu invult, plus de variant-uitleg eronder. -->
			<div class="text-[11px] font-bold tracking-[0.14em] text-mixup-yellow uppercase">
				Track {activeTabIndex + 1}{#if isMultiTab}<span class="text-mixup-yellow/60">
						/ {data.tabs.length}</span
					>{/if}
				{#if isMashup && activeTab}
					· {activeTab.sourceTracks.length} nummers in deze mashup
				{:else if isFragments && activeTab}
					· {activeTab.sourceTracks.length} tracks + groepering
				{:else if isEffects}
					· bewerkt met effecten
				{/if}
			</div>

			{#key activeTabIndex}
				{#if isMultiSource && activeTab}
					<!-- Answer slot tabs (one per source track: mashup + fragments) -->
					{#if activeTab.sourceTracks.length > 1}
						<div class="flex gap-1.5 overflow-x-auto pb-1">
							{#each Array.from({ length: activeTab.sourceTracks.length }, (_, i) => i) as si}
								<button
									type="button"
									onclick={() => (activeSlotIndex = si)}
									class="shrink-0 rounded-mixup-chip px-3.5 py-1.5 text-sm font-bold transition-colors squircle"
									style={activeSlotIndex === si
										? `background: ${teamHex}; color: ${teamOn}; border: 1px solid ${teamHex};`
										: 'background: rgba(229,242,255,0.05); color: #9FB1D9; border: 1px solid rgba(229,242,255,0.16);'}
								>
									{si + 1}
								</button>
							{/each}
						</div>
					{/if}
					<!-- Same clamped slot the free_answer reveal is addressed to. -->
					{@const slotIdx = activeSlotEffective}
					{#each variantFields.filter((f) => f !== 'grouping') as field (field)}
						{@const mode = data.fieldModes[field] as InputMode}
						<div class="flex flex-col gap-1.5">
							<!-- Label row: the field's own label, plus X-Ray's reveal button while a
							     budget is running. The button sits BESIDE the label, not inside it
							     (a button in a <label> hijacks the label's click), and is
							     type="button" — so the answer form is untouched: no nested form,
							     no accidental submit, and the tab dots / Next / Previous are
							     unaffected. -->
							<div class="flex items-center justify-between gap-2">
								<label
									class="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.14em] text-mixup-paper uppercase"
								>
									{fieldLabel(field)}
									{#if isBonusField(field)}
										<span
											class="rounded-full bg-mixup-amber/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-mixup-amber normal-case squircle"
											>Bonus</span
										>
									{/if}
								</label>
								{#if xrayRemaining > 0 && !revealFor(String(field), slotIdx)}
									<button
										type="button"
										onclick={() => spendXrayReveal(String(field), slotIdx)}
										disabled={!!xraySpending}
										class="shrink-0 rounded-mixup-chip border border-mixup-amber/50 bg-mixup-amber/10 px-2 py-0.5 text-[11px] font-bold text-mixup-amber transition-colors squircle disabled:opacity-40"
									>
										{xraySpending ===
										freeAnswerRevealKey(activeTab?.id ?? '', slotIdx, String(field))
											? '…'
											: `🔎 Onthul (${xrayRemaining})`}
									</button>
								{/if}
							</div>
							{#if revealFor(String(field), slotIdx)}
								<div class="flex items-center gap-1.5 text-xs font-semibold text-mixup-amber">
									<span>💡</span>
									<span>Onthuld: {revealFor(String(field), slotIdx)}</span>
								</div>
							{/if}
							<!-- Lifeline hint: read-only, never an input, never written into the
							     draft. Suppressed when this cell has a full reveal — the answer
							     beats a mask of it. Cyan rather than the reveal's amber so the
							     two never read as the same thing. -->
							{#if lifelineFor(String(field), slotIdx) && !revealFor(String(field), slotIdx)}
								<div class="flex items-center gap-1.5 text-xs font-semibold text-mixup-cyan">
									<span>🆘</span>
									<span class="font-data tracking-[0.15em]"
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
										? 'Zoek artiesten, Enter om toe te voegen…'
										: 'Typ een naam, Enter om toe te voegen…'}
								/>
								<p class="text-[11px] text-mixup-dim">
									Voeg elke artiest op de track toe — elk is een deel van de punten waard.
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
									onColor={teamOn}
									layout={field === 'year' ? 'chips' : 'list'}
									bind:value={allDrafts[activeTabIndex][slotIdx].fieldValues[field]}
								/>
							{:else if mode === 'open_text'}
								<OpenText
									name="{field}_{slotIdx}"
									{teamHex}
									placeholder="Typ je antwoord…"
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
						<div class="flex flex-col gap-2">
							<span class="text-[11px] font-extrabold tracking-[0.14em] text-mixup-paper uppercase"
								>Welke fragmenten horen bij deze track?</span
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
										class="rounded-mixup-chip px-3.5 py-2 text-sm font-bold transition-colors squircle"
										style={selected
											? `background: ${teamHex}; color: ${teamOn}; border: 1px solid ${teamHex}; box-shadow: 0 0 18px ${teamHex}80;`
											: 'background: rgba(229,242,255,0.05); color: #9FB1D9; border: 1px solid rgba(229,242,255,0.16);'}
									>
										{fragNum}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{:else}
					<!-- Single-slot layout (standard / anthem / label) -->
					{#each variantFields as field (field)}
						{@const mode = data.fieldModes[field] as InputMode}
						<div class="flex flex-col gap-1.5">
							<!-- Same label row as the multi-slot layout above, always slot 0. -->
							<div class="flex items-center justify-between gap-2">
								<label
									class="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.14em] text-mixup-paper uppercase"
								>
									{fieldLabel(field)}
									{#if isBonusField(field)}
										<span
											class="rounded-full bg-mixup-amber/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-mixup-amber normal-case squircle"
											>Bonus</span
										>
									{/if}
								</label>
								{#if xrayRemaining > 0 && !revealFor(String(field), 0)}
									<button
										type="button"
										onclick={() => spendXrayReveal(String(field), 0)}
										disabled={!!xraySpending}
										class="shrink-0 rounded-mixup-chip border border-mixup-amber/50 bg-mixup-amber/10 px-2 py-0.5 text-[11px] font-bold text-mixup-amber transition-colors squircle disabled:opacity-40"
									>
										{xraySpending === freeAnswerRevealKey(activeTab?.id ?? '', 0, String(field))
											? '…'
											: `🔎 Onthul (${xrayRemaining})`}
									</button>
								{/if}
							</div>
							<!-- Single-slot layout: always slot 0 of the active tab. -->
							{#if revealFor(String(field), 0)}
								<div class="flex items-center gap-1.5 text-xs font-semibold text-mixup-amber">
									<span>💡</span>
									<span>Onthuld: {revealFor(String(field), 0)}</span>
								</div>
							{/if}
							<!-- Same read-only Lifeline hint as the multi-slot layout, always slot 0. -->
							{#if lifelineFor(String(field), 0) && !revealFor(String(field), 0)}
								<div class="flex items-center gap-1.5 text-xs font-semibold text-mixup-cyan">
									<span>🆘</span>
									<span class="font-data tracking-[0.15em]">{lifelineFor(String(field), 0)}</span>
								</div>
							{/if}

							{#if field === 'artist' && artistIsTagged}
								<ArtistTagInput
									name="artist"
									bind:tags={artistTags[activeTabIndex][0]}
									pool={artistPool}
									accentHex={teamHex}
									placeholder={artistPool.length > 0
										? 'Zoek artiesten, Enter om toe te voegen…'
										: 'Typ een naam, Enter om toe te voegen…'}
								/>
								<p class="text-[11px] text-mixup-dim">
									Voeg elke artiest op de track toe — elk is een deel van de punten waard.
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
									onColor={teamOn}
									layout={field === 'year' ? 'chips' : 'list'}
									bind:value={allDrafts[activeTabIndex][0].fieldValues[field]}
								/>
							{:else if mode === 'open_text'}
								<OpenText
									name={field}
									{teamHex}
									placeholder="Typ je antwoord…"
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
		</form>

		<!--
			Powerup-balk — buiten de antwoord-<form>, zie de noot bovenaan.

			ZWEVEND (harde eis): de balk moet altijd zichtbaar en klikbaar blijven
			terwijl de pagina scrolt. Hij is daarom `position: sticky` met een
			bodemafstand, en hij raakt de schermranden niet: marge links, rechts en
			onder, afgeronde hoeken, glas. Niet meer de volle-breedte strook in
			effen #0b0b1f.

			`bottom` telt de toetsenbord-inzet mee, zodat hij op iOS bóven het
			toetsenbord staat in plaats van erachter — zie het visualViewport-effect
			in het script. Onderaan de pagina zakt hij vanzelf terug op zijn eigen
			plek, net boven de knoppenrij.

			De eyebrow "POWERUPS" staat alleen bij gevulde balk. In de lege stand
			zegt de zin zelf al "Nog geen powerups"; het label ernaast is dan
			dubbelop en kost breedte die de zin nodig heeft om op één regel te
			passen.
		-->
		{#if data.activeSetId && data.heldPowerups}
			<div class="pu-bar">
				<div class="pu-panel flex items-center gap-2.5 squircle">
					{#if data.heldPowerups.length > 0}
						<span
							class="shrink-0 text-[9px] font-extrabold tracking-[0.18em] text-mixup-yellow uppercase"
							>Powerups</span
						>
					{/if}
					<div class="min-w-0 flex-1">
						<HeldPowerups
							compact
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
					</div>
				</div>
			</div>
			{#if xrayError}
				<!-- A refused X-Ray reveal (no track behind this tab, no open attempt, …).
				     Shown once here rather than under every field: the budget is one
				     thing, and a refusal costs none of it. -->
				<p class="px-5 pt-1 text-xs font-semibold text-mixup-magenta">🔎 {xrayError}</p>
			{/if}
		{/if}

		<!--
			Submit exists ONLY on the last tab. Every earlier tab gets Next instead
			(type="button", so it can't submit), which is what stops a team from
			finishing a multi-tab challenge with a half answer — submit is is_final.
			A single-tab challenge takes the {:else} branch and is unchanged.
			Auto-submit at timer 0 does NOT go through this button: triggerSubmit()
			calls formEl.requestSubmit() with no submitter, which submits the form
			itself from whatever tab the team is parked on.
		-->
		<div class="flex gap-2.5 px-4 pt-3 pb-2">
			{#if isMultiTab}
				{#if activeTabIndex > 0}
					<button
						type="button"
						onclick={() => goToTab(activeTabIndex - 1)}
						class="h-[54px] flex-1 rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle"
						style="background: rgba(229,242,255,0.06); color: #8E9BC9; border: 1px solid rgba(229,242,255,0.2);"
					>
						← Vorige
					</button>
				{/if}
				{#if isLastTab}
					<button
						type="submit"
						form="challenge-answer-form"
						disabled={!canSubmit || isFrozen}
						class="h-[54px] flex-1 rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle disabled:cursor-not-allowed disabled:opacity-50"
						style="background: linear-gradient(90deg,#FFE600,#FF7F11); color: #1A1400; box-shadow: 0 10px 30px rgba(255,127,17,0.35);"
					>
						{submitting ? 'Inleveren…' : 'Inleveren'}
					</button>
				{:else}
					<button
						type="button"
						onclick={() => goToTab(activeTabIndex + 1)}
						class="h-[54px] flex-1 rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle"
						style="background: rgba(255,230,0,0.10); color: #FFE600; border: 1px solid #FFE600;"
					>
						Volgende →
					</button>
				{/if}
			{:else}
				<button
					type="submit"
					form="challenge-answer-form"
					disabled={!canSubmit || isFrozen}
					class="h-[54px] w-full rounded-mixup-modal text-base font-extrabold tracking-[0.06em] uppercase squircle disabled:cursor-not-allowed disabled:opacity-50"
					style="background: linear-gradient(90deg,#FFE600,#FF7F11); color: #1A1400; box-shadow: 0 10px 30px rgba(255,127,17,0.35);"
				>
					{submitting ? 'Inleveren…' : 'Inleveren'}
				</button>
			{/if}
		</div>
	</PlayerScreen>
{/if}

<style>
	/* ══ Scherm 7B · paginascroll met vaste instrumenten ═══════════════════════
	   De antwoordkaart scrolt niet meer intern; de pagina scrolt als geheel, dus
	   de knoppenrij onderaan de flow is pas bereikbaar als élk antwoordveld
	   gepasseerd is. Wat daarbij niet weg mag scrollen, staat hieronder. */

	/* Kop (teampil + klok) · segmentbalk · audiokaart.
	   `top: 0` plakt aan de bovenkant van het VENSTER, dus de eigen padding-top
	   van PlayerScreen telt daar niet meer mee: de safe-area-marge zit hier in de
	   zone zelf, anders schuift de klok onder de notch. De achtergrond is
	   ondoorzichtig (geen glas): er scrolt tekst onderdoor. */
	.stick-top {
		position: sticky;
		top: 0;
		z-index: 30;
		padding-top: env(safe-area-inset-top, 0px);
		padding-bottom: 8px;
		background: linear-gradient(180deg, #0b0b1f 78%, rgba(11, 11, 31, 0.94) 100%);
		box-shadow: 0 10px 22px rgba(11, 11, 31, 0.55);
	}

	/* ── Puntenscherm · de belofte ──────────────────────────────────────────────
	   Het getal draagt de kleur: geel als er iets te halen valt (dezelfde
	   betekenis die geel in deze flow overal heeft), gedempt bij nul. */
	.powerup-belofte__getal {
		color: var(--color-mixup-yellow);
		text-shadow: 0 0 22px rgba(255, 230, 0, 0.45);
	}

	.powerup-belofte--geen .powerup-belofte__getal {
		color: var(--color-mixup-dim);
		text-shadow: none;
	}

	/* Powerup-balk — de zwevende schil. Hoger z-index dan de bovenzone: ze raken
	   elkaar ruimtelijk nooit (boven vs. onder), en zo kan de bovenzone nooit
	   over iets heen schilderen dat vanuit deze balk opengaat.

	   De schil is doorzichtig en draagt alleen de POSITIE. `bottom` telt de
	   toetsenbord-inzet mee (zie het visualViewport-effect) plus de eigen
	   zweefmarge; sticky-offsets tellen vanaf de VENSTERrand, dus de
	   home-indicator hoort in diezelfde som en niet in de padding van de schil.

	   Geen `overflow` en geen `backdrop-filter` op DEZE laag: een sticky voorouder
	   met backdrop-filter zou het bevattende blok kapen van alles wat er fixed in
	   staat. De sheet en de activatiemodal hangen via `use:portal` onder <body>
	   en zijn daar ongevoelig voor, maar de regel geldt hier evengoed — het glas
	   zit één niveau lager, op het paneel, dat niets fixed bevat. */
	.pu-bar {
		position: sticky;
		bottom: calc(var(--kb-inset, 0px) + max(10px, env(safe-area-inset-bottom, 0px)));
		z-index: 40;
		padding: 8px 14px 0;
		pointer-events: none;
	}

	/* Het zwevende paneel zelf: glas uit het bestaande systeem
	   (--color-mixup-glass + --blur-mixup-glass, dezelfde waarden als de
	   `mixup-glass`-utility), rondom vrij van de schermranden.

	   De slagschaduw is er om hem van de inhoud eronder te tillen, niet om een
	   strook te maskeren: de pagina scrolt zichtbaar-maar-onscherp door het glas
	   heen, en dat is precies wat glas hoort te doen. */
	.pu-panel {
		pointer-events: auto;
		padding: 7px 12px;
		border-radius: 20px;
		background: var(--color-mixup-glass);
		border: 1px solid var(--color-mixup-glass-border);
		backdrop-filter: blur(var(--blur-mixup-glass));
		-webkit-backdrop-filter: blur(var(--blur-mixup-glass));
		box-shadow:
			0 10px 28px rgba(11, 11, 31, 0.55),
			0 2px 8px rgba(11, 11, 31, 0.4);
	}
</style>
