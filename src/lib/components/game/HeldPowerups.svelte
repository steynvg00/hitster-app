<script lang="ts">
	/**
	 * Scherm 1 — INVENTARIS ("IN BEZIT").
	 *
	 * Redesign fase 4, PUUR PRESENTATIE. Onveranderd gebleven: de realtime
	 * subscriptie op `team_powerups` (zelfde kanaalnaam, zelfde filter, zelfde
	 * refetch-query), alle props die ongewijzigd worden doorgegeven aan
	 * PowerupActivationModal, en het activatiepad zelf.
	 *
	 * Twee zichtbare veranderingen, beide vormgeving:
	 *  1. De chips dragen nu het PNG-icoon uit static/uploads/Powerups/ en de
	 *     designstijl (76x44 minimum, geel geselecteerd) i.p.v. een emoji-knop.
	 *  2. Een tik opent eerst de bottom-sheet met de beschrijving (PowerupSheet)
	 *     en pas via "GEBRUIK NU" de activatiemodal. Voorheen sprong de tik
	 *     direct naar de modal; de modal en wat hij doet zijn identiek.
	 *
	 * Chips worden per TYPE gegroepeerd met een telling (design: "FREEZE ×2").
	 * Dat is een weergavekeuze: de activatie gaat nog steeds over één concrete
	 * team_powerups-rij — de oudste van dat type — en de server ziet dus exact
	 * hetzelfde verzoek als voorheen.
	 */
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import PowerupActivationModal from './PowerupActivationModal.svelte';
	import PowerupSheet from './PowerupSheet.svelte';
	import { powerupIcon } from '$lib/mixup-assets';
	import { powerupName } from '$lib/powerups-copy';
	import type { LifelineHint, RevealResult } from '$lib/powerups-meta';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
		category?: string | null;
	};

	type HeldPowerup = {
		id: string;
		powerup_type_id: string;
		granted_at: string;
		type: PowerupType;
	};

	type TargetTeam = {
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt?: boolean;
	};

	let {
		teamId,
		setId,
		powerups: initialPowerups,
		compact = false,
		currentChallengeId,
		variantFields = [],
		tabId,
		slotIndex = 0,
		revealTabs = [],
		setTeams = [],
		resurrectableChallenges = [],
		draftSnapshot,
		onactivated,
		onlifeline
	}: {
		teamId: string;
		setId: string;
		powerups: HeldPowerup[];
		/**
		 * Krappe variant voor de zwevende balk op het antwoordscherm. Alleen
		 * MAATVOERING — dezelfde chips, dezelfde sheet, dezelfde activatiemodal,
		 * hetzelfde verzoek aan de server. De inventaris op /team blijft de ruime
		 * stand houden; daar is het scherm van de powerups, hier zijn ze te gast
		 * naast een antwoordformulier dat de ruimte harder nodig heeft.
		 */
		compact?: boolean;
		currentChallengeId?: string;
		// free_answer addressing — see PowerupActivationModal. Passed straight through.
		variantFields?: string[];
		tabId?: string;
		slotIndex?: number;
		// x_ray / free_tab: the tabs a multi-reveal picker can address. Also passed
		// straight through.
		revealTabs?: Array<{ id: string; label: string; fields: string[]; slotCount: number }>;
		setTeams?: TargetTeam[];
		// resurrection only: the team's finished challenges. Passed straight through
		// — see PowerupActivationModal for the shape and why both numbers on each
		// entry come from the server.
		resurrectableChallenges?: Array<{
			id: string;
			title: string;
			variant: string;
			oldFinal: number;
			retrySeconds: number | null;
		}>;
		// lifeline only: reads the challenge page's live draft at activation time.
		// Passed straight through — see PowerupActivationModal for why it is a
		// function rather than a value.
		draftSnapshot?: () => string;
		// A list because x_ray/free_tab reveal several answers at once; free_answer
		// sends a one-element list through the same callback.
		onactivated?: (reveals: RevealResult[]) => void;
		// lifeline's masked hints. A SEPARATE callback from onactivated on purpose:
		// reveals get written into the draft, hints must not be, and keeping the two
		// channels apart is what makes mixing them up impossible rather than merely
		// unlikely.
		onlifeline?: (hints: LifelineHint[]) => void;
	} = $props();

	// The teams a caster can attack — every team in the set except their own.
	const targetTeams = $derived(setTeams.filter((t) => t.id !== teamId));

	let powerups = $state<HeldPowerup[]>(initialPowerups);
	/** De chip waar de sheet nu voor open staat. */
	let sheetFor = $state<HeldPowerup | null>(null);
	/** De powerup die daadwerkelijk geactiveerd wordt (na "GEBRUIK NU"). */
	let selectedPowerup = $state<HeldPowerup | null>(null);

	/**
	 * Chips: één per type, met een telling. De `entry` is de OUDSTE rij van dat
	 * type — `powerups` komt gesorteerd op granted_at binnen — zodat een team dat
	 * er twee heeft de eerst-verdiende uitgeeft.
	 */
	const chips = $derived.by(() => {
		const out: Array<{ entry: HeldPowerup; count: number }> = [];
		for (const p of powerups) {
			const existing = out.find((c) => c.entry.powerup_type_id === p.powerup_type_id);
			if (existing) existing.count += 1;
			else out.push({ entry: p, count: 1 });
		}
		return out;
	});

	function countOf(p: HeldPowerup): number {
		return chips.find((c) => c.entry.powerup_type_id === p.powerup_type_id)?.count ?? 1;
	}

	function onModalClose(activated?: boolean, reveals?: RevealResult[], hints?: LifelineHint[]) {
		selectedPowerup = null;
		if (activated && reveals?.length) onactivated?.(reveals);
		if (activated && hints?.length) onlifeline?.(hints);
	}

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`held-powerups-${teamId}-${setId}`)
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'team_powerups',
					filter: `team_id=eq.${teamId}`
				},
				async () => {
					const { data } = await supabaseBrowser
						.from('team_powerups')
						.select(
							'id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use, category)'
						)
						.eq('team_id', teamId)
						.eq('set_id', setId)
						.eq('status', 'held')
						.order('granted_at');
					powerups = (data ?? []).map((r) => ({
						id: r.id,
						powerup_type_id: r.powerup_type_id,
						granted_at: r.granted_at ?? '',
						type: (r as unknown as { powerup_types: PowerupType }).powerup_types
					}));
					// Een chip die tijdens een open sheet verdwijnt (opgebruikt, of door
					// een andere speler van het team) mag geen dood blad laten staan.
					if (sheetFor && !powerups.some((p) => p.id === sheetFor?.id)) sheetFor = null;
				}
			)
			.subscribe();
		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

{#if powerups.length === 0}
	<!--
		De lege stand nam in de balk twee regels. Kleiner zetten was niet genoeg:
		GEMETEN in de echte letter (Rubik 500) is de volle zin op 11px 352px breed,
		terwijl het paneel op het breedste toestel uit deze flow (402px) 348px
		binnenruimte heeft. Hij past daar dus op geen enkel scherm op één regel —
		dat is een eigenschap van de ZIN, niet van de opmaak.

		Vandaar een kortere zin, alleen in de krappe stand. Hij houdt alle drie de
		feiten vast: er zijn er nog geen, je verdient ze door te antwoorden, en het
		moet snel én goed. Op 11px is hij 255px en past hij vanaf 320px scherm — de
		hele reeks 320/360/375/390/402 dus, niet alleen het toestel waarop het
		toevallig getest is. De inventaris op /team houdt de volle zin: daar is de
		regelbreedte geen probleem.

		De aanhef staat apart en vet, zodat "Nog geen powerups" het eerst leest als
		er ooit tóch afgebroken wordt.
	-->
	<p class="empty" class:empty--compact={compact}>
		{#if compact}<span class="empty-lead">Nog geen powerups</span> — snel én goed antwoorden.{:else}Nog
			geen powerups — verdien ze door snel en goed te antwoorden.{/if}
	</p>
{:else}
	<div class="chip-row" class:chip-row--compact={compact}>
		{#each chips as c (c.entry.powerup_type_id)}
			<button
				type="button"
				class="chip squircle"
				class:chip--compact={compact}
				onclick={() => (sheetFor = c.entry)}
			>
				<img
					src={powerupIcon(c.entry.powerup_type_id)}
					alt=""
					class="chip-img"
					class:chip-img--compact={compact}
					onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
				/>
				<span class="chip-label" class:chip-label--compact={compact}>
					{powerupName(c.entry.powerup_type_id, c.entry.type?.name)}
					{#if c.count > 1}<span class="text-mixup-yellow">×{c.count}</span>{/if}
				</span>
			</button>
		{/each}
	</div>
{/if}

{#if sheetFor}
	<PowerupSheet
		type={sheetFor.type}
		count={countOf(sheetFor)}
		onclose={() => (sheetFor = null)}
		onuse={() => {
			selectedPowerup = sheetFor;
			sheetFor = null;
		}}
	/>
{/if}

{#if selectedPowerup}
	<PowerupActivationModal
		teamPowerupId={selectedPowerup.id}
		type={selectedPowerup.type}
		onclose={onModalClose}
		{currentChallengeId}
		{variantFields}
		{tabId}
		{slotIndex}
		{revealTabs}
		{targetTeams}
		{resurrectableChallenges}
		{draftSnapshot}
	/>
{/if}

<style>
	/* De lege stand. */
	.empty {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-mixup-dim);
	}

	.empty--compact {
		font-size: 11px;
		line-height: 1.25;
	}

	.empty-lead {
		font-weight: 700;
		color: var(--color-mixup-muted);
	}

	/* Designbron: rij met gap 10. Scrollt horizontaal zodra een team meer
	   powerups heeft dan er naast elkaar passen (390px referentie). */
	.chip-row {
		display: flex;
		gap: 10px;
		overflow-x: auto;
		scrollbar-width: none;
		/* Ruimte voor de gele glow van een geselecteerde chip. */
		margin: -4px;
		padding: 4px;
	}

	.chip-row::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex: 0 0 auto;
		min-width: 76px;
		min-height: 44px;
		padding: 10px 12px;
		border-radius: 18px;
		text-align: center;
		background: rgba(229, 242, 255, 0.06);
		border: 1px solid rgba(229, 242, 255, 0.18);
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.chip:active {
		background: rgba(255, 230, 0, 0.1);
		border-color: var(--color-mixup-yellow);
		box-shadow: 0 0 16px rgba(255, 230, 0, 0.35);
	}

	.chip-row--compact {
		gap: 8px;
	}

	.chip-img {
		display: block;
		margin: 0 auto;
		width: 38px;
		height: 38px;
		object-fit: contain;
	}

	.chip-label {
		display: block;
		margin-top: 3px;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 9px;
		letter-spacing: 0.08em;
		color: var(--color-mixup-paper);
		white-space: nowrap;
	}

	/* ── Krappe stand ────────────────────────────────────────────────────────
	   Alleen maatvoering. De chip blijft een raakvlak van 44px hoog halen via
	   de padding rondom het icoon plus het label; wat krimpt is het BEELD, niet
	   het doel. Zie de `compact`-prop voor het waarom. */
	.chip--compact {
		min-width: 62px;
		min-height: 44px;
		padding: 4px 9px;
		border-radius: 14px;
	}

	.chip-img--compact {
		width: 26px;
		height: 26px;
	}

	.chip-label--compact {
		margin-top: 1px;
		font-size: 8px;
		letter-spacing: 0.06em;
	}
</style>
