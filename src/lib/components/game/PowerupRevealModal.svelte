<script lang="ts">
	import { enhance } from '$app/forms';
	import { isTargetedPowerup } from '$lib/powerups-meta';
	import PowerupActivationModal from './PowerupActivationModal.svelte';
	import CodeRain from '$lib/components/CodeRain.svelte';
	import { powerupIcon, SLOT_REEL_ICON_IDS } from '$lib/mixup-assets';
	import { powerupDesc, powerupName } from '$lib/powerups-copy';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
		category?: string | null;
	};

	type TargetTeam = {
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt?: boolean;
	};

	type Activation = { success: boolean; payload?: Record<string, unknown> };

	let {
		teamPowerupId,
		type: powerupType,
		activation,
		onclose,
		teamId,
		setTeams = [],
		skipRollAnimation = false
	}: {
		teamPowerupId: string;
		type: PowerupType;
		activation?: Activation;
		onclose: () => void;
		// Needed only for the "Use now" path (a holdable, targeted type — give_a_shot
		// today, structurally any future one) — the target-team picker excludes the
		// caster's own team from setTeams.
		teamId?: string;
		setTeams?: TargetTeam[];
		// Render the settled state straight away, no slot machine. Set for a powerup
		// that arrives as the PRIZE of a Power Spin: the spin's own wheel already
		// rolled and landed on it, so rolling a second time for a result the player
		// just watched appear is noise. A powerup earned the normal way never passes
		// this, so its reveal is unchanged.
		skipRollAnimation?: boolean;
	} = $props();

	// A holdable type that ALSO acts on another team gets a third earn-time choice
	// (Use now / Store / Lose) instead of the plain Store/Lose pair. Gated on the
	// same predicate PowerupActivationModal uses for its target picker — not a
	// hardcoded id — so any future holdable offensive type picks this up for free.
	const isHoldableTargeted = $derived(
		powerupType.holdable && !powerupType.immediate_use && isTargetedPowerup(powerupType.id)
	);
	const targetTeams = $derived((setTeams ?? []).filter((t) => t.id !== teamId));

	// "Use now" swaps this modal's card for PowerupActivationModal's target-picker +
	// activation flow, reusing that exact component (and its idle/sent/blocked
	// states) rather than re-implementing a second picker. It posts to a
	// pending-specific action (the powerup is still 'pending' at reveal time, not
	// yet 'held') that shares activatePowerup()'s targeting/shield-block path.
	let usingNow = $state(false);

	// Immediate-use effects are already applied by the time this modal shows —
	// build a concrete confirmation string from the actual team_effects payload
	// rather than the generic catalog description.
	function appliedEffectText(): string {
		if (activation && !activation.success) return 'Kon niet automatisch worden toegepast — sorry!';
		const payload = activation?.payload ?? {};
		switch (powerupType.id) {
			case 'bonus_points':
				return `+${payload.value ?? 5} bonuspunten klaargezet voor jullie volgende challenge!`;
			case 'lucky_dice':
				// The rolled number is the whole point of this powerup — show it, and the
				// range it came out of, straight from the payload the server wrote. The
				// points are ALREADY on the board (activatePowerup writes teams.score
				// directly), so this says so rather than promising a future bonus.
				return `Je gooide ${payload.value ?? '?'} (uit ${payload.dice_min ?? 1}–${payload.dice_max ?? 6}) — ${payload.value ?? 0} punten staan al op je score${
					typeof payload.new_score === 'number' ? ` (${payload.new_score} totaal)` : ''
				}!`;
			case 'hard_gaan':
				return `x${payload.multiplier ?? 1.5} op challengepunten voor de komende ${payload.window_minutes ?? 15} minuten!`;
			case 'single_event_mult':
				// The ROLLED multiplier is the reveal — same as lucky_dice's number.
				// Never defaulted to a plausible-looking value: a payload without one
				// means the roll did not land, and saying "x1.5" would invent it.
				return `x${payload.multiplier ?? '?'} op jullie volgende challenge!`;
			case 'penalty_shot':
				return 'Te laag gescoord — strafshot. Naar binnen ermee.';
			case 'power_spin':
				// The rolled powerup's NAME and ICON are no longer said here — the slot
				// machine settles on them (see spinOutcome / settleIcon below), which is
				// what makes the animation the reveal instead of decoration in front of
				// one. This line is the caption underneath, so it must not repeat the
				// name the title already shows.
				return payload.rolled_type_id
					? 'Gewonnen op de Power Spin — hij is van jullie!'
					: 'Het wiel kwam leeg terug — er viel niets te winnen. Pech!';
			default:
				return powerupDesc(powerupType.id, powerupType.description) || 'Effect toegepast!';
		}
	}

	// ── power_spin: what the wheel landed on ─────────────────────────────────
	//
	// Read from the payload the server already wrote. The ROLL itself is entirely
	// server-side (activatePowerup's power_spin branch) and is not touched here —
	// this only decides WHEN the outcome becomes visible.
	//
	// Before: the slot machine settled on Power Spin's OWN icon (🎡), which reveals
	// nothing, and the outcome arrived as a line of text that popped in at the same
	// instant. The animation had no payoff and the reveal had no moment.
	// Now: the machine settles ON the rolled powerup, so stopping IS the reveal.
	//
	// null for every other powerup, which keeps their behaviour byte-identical.
	const spinOutcome = $derived.by(() => {
		if (powerupType.id !== 'power_spin') return null;
		const p = activation?.payload ?? {};
		if (!p.rolled_type_id) return { empty: true, name: '', id: 'power_spin' };
		return {
			empty: false,
			// Redesign fase 4: de naam is de Nederlandse naam als we die kennen, met
			// de naam uit de payload als terugval. Het icoon is het PNG-icoon van het
			// gerolde TYPE-ID — hetzelfde veld dat de tak hierboven al las.
			name: powerupName(
				String(p.rolled_type_id),
				typeof p.rolled_type_name === 'string' ? p.rolled_type_name : 'een powerup'
			),
			id: String(p.rolled_type_id)
		};
	});

	// Slot-machine animation: cycle through icons for ~1.8s then settle.
	// penalty_shot is a spontaneous social popup, not a prize roll — skip the roll
	// and render the settled state immediately. skipRollAnimation does the same for
	// a powerup handed over as a Power Spin prize (its wheel already rolled).
	// De rol loopt nu langs de PNG-iconen uit de designbron in plaats van emoji.
	const ICONS = SLOT_REEL_ICON_IDS.map((id) => powerupIcon(id));

	// Read once, on purpose. The challenge page keys this modal on teamPowerupId, so
	// a new queue entry REMOUNTS it rather than swapping props on a live instance —
	// which makes the roll flags below fixed facts about this card, not signals.
	// Destructured in one go so the whole block costs a single non-reactive read.
	const { id: typeId } = powerupType;
	const animate = typeId !== 'penalty_shot' && !skipRollAnimation;

	// Power Spin is the one powerup whose roll is a MOMENT rather than a transition,
	// so it does not auto-run: the card opens on a Spin button and the wheel turns
	// when the player pulls it. Every other powerup keeps the old behaviour of
	// starting on mount.
	const isSpin = typeId === 'power_spin';
	const autoRoll = animate && !isSpin;

	// What the machine comes to rest on. For a spin that is the PRIZE; for
	// everything else it is the powerup's own icon, exactly as before.
	const settleIcon = $derived(powerupIcon(spinOutcome ? spinOutcome.id : powerupType.id));

	// At rest a spin shows its OWN icon (het wiel, nog niet gedraaid) — never the
	// prize: nothing about the outcome may exist on screen before the pull.
	let displayIcon = $state(autoRoll ? ICONS[0] : powerupIcon(typeId));
	let settled = $state(!animate);
	let rollStarted = $state(autoRoll);
	let resolving = $state(false);

	function startSpin() {
		if (rollStarted) return; // one pull per card
		rollStarted = true;
	}

	let animFrame: number;
	let startTime = 0;
	const DURATION_MS = 1800;

	function runAnimation(ts: number) {
		if (!startTime) startTime = ts;
		const elapsed = ts - startTime;

		if (elapsed < DURATION_MS) {
			// Cycle speed slows down as we approach the end
			const progress = elapsed / DURATION_MS;
			const interval = 60 + progress * 200; // 60ms → 260ms
			const idx = Math.floor(elapsed / interval) % ICONS.length;
			displayIcon = ICONS[idx];
			animFrame = requestAnimationFrame(runAnimation);
		} else {
			// The settle. For a spin this is the reveal moment: the wheel stops on the
			// powerup that was won, and only then does the name below appear.
			displayIcon = settleIcon;
			settled = true;
		}
	}

	// Gated on rollStarted, not on mount. For everything except a spin that is true
	// from the start, so the effect fires on the first run exactly as it used to;
	// for a spin it fires when startSpin() flips it, which is the whole gate.
	$effect(() => {
		if (!animate || !rollStarted) return;
		animFrame = requestAnimationFrame(runAnimation);
		return () => cancelAnimationFrame(animFrame);
	});
</script>

{#if usingNow}
	<!-- "Use now": reuse PowerupActivationModal's exact target-picker + activation
	     flow, pointed at the pending-specific action instead of the held one. -->
	<PowerupActivationModal
		{teamPowerupId}
		type={powerupType}
		{targetTeams}
		activateAction="?/useNowEarnedPowerup"
		onclose={(activated) => {
			if (activated) {
				onclose();
			} else {
				// Cancel from the picker → back to the Use now / Store / Lose choice.
				usingNow = false;
			}
		}}
	/>
{:else}
	<!--
		Scherm 5 — SLOTMACHINE-REVEAL + POWER SPIN (tap-poort).

		Redesign fase 4, PUUR PRESENTATIE. Onveranderd: welke keuzes een team
		krijgt (isHoldableTargeted / holdable / immediate_use), de drie
		<form action="?/resolveEarnedPowerup"> met hun `choice`-waardes, de
		"Use now"-tak hierboven, en de tap-poort van Power Spin — het resultaat
		staat nog steeds nergens in de DOM voordat er getikt is.

		Nieuw is de vormgeving: volledig scherm met code-regen, de 170x170
		slotkast met het PNG-icoon, en de revealPop bij het landen.
	-->
	<div class="reveal mixup-page" role="dialog" aria-modal="true" aria-label="Powerup verdiend">
		<CodeRain />

		<div class="reveal-body">
			<!-- Kop. Een spin vertelt de drie staten ZONDER te noemen wat er gewonnen
			     is, zodat het wiel het enige is dat kan onthullen. -->
			<p class="eyebrow">
				{#if isSpin && !rollStarted}
					Powerup verdiend!
				{:else if isSpin && !settled}
					Het wiel draait…
				{:else if isSpin}
					Power Spin — je wint
				{:else}
					Powerup verdiend!
				{/if}
			</p>

			<!-- Slotkast -->
			<div class="slot squircle" class:slot--settled={settled}>
				<img
					src={displayIcon}
					alt=""
					class="slot-img"
					class:slot-img--rolling={rollStarted && !settled}
					onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
				/>
			</div>

			{#if settled}
				<!-- Naam. Bij een spin is de prijs de kop, niet "Power Spin" — de
				     eyebrow hierboven zegt al waar hij vandaan komt. Een leeg wiel valt
				     terug op "Power Spin". -->
				<p class="slot-name">
					{spinOutcome && !spinOutcome.empty
						? spinOutcome.name
						: powerupName(powerupType.id, powerupType.name)}
				</p>
				{#if powerupType.description && !powerupType.immediate_use}
					<p class="slot-desc">{powerupDesc(powerupType.id, powerupType.description)}</p>
				{/if}

				{#if isHoldableTargeted}
					<!-- Holdable + gericht (give_a_shot): drie keuzes, precies zoals de
					     designbron ze naast elkaar zet. -->
					<div class="choice-row">
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="store" />
							<button
								type="submit"
								disabled={resolving}
								class="mixup-btn w-full text-xs mixup-btn-secondary disabled:opacity-50"
							>
								Bewaar
							</button>
						</form>
						<button
							type="button"
							onclick={() => (usingNow = true)}
							class="mixup-btn flex-[1.2] text-xs mixup-btn-primary"
						>
							Gebruik nu
						</button>
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="lose" />
							<button
								type="submit"
								disabled={resolving}
								class="mixup-btn w-full text-xs mixup-btn-ghost disabled:opacity-50"
							>
								Laat vallen
							</button>
						</form>
					</div>
				{:else if powerupType.holdable && !powerupType.immediate_use}
					<!-- Holdable: bewaren of laten vallen -->
					<div class="choice-row">
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-[1.4]"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="store" />
							<button
								type="submit"
								disabled={resolving}
								class="mixup-btn w-full text-[13px] mixup-btn-primary disabled:opacity-50"
							>
								Bewaar
							</button>
						</form>
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="lose" />
							<button
								type="submit"
								disabled={resolving}
								class="mixup-btn w-full text-[13px] mixup-btn-ghost disabled:opacity-50"
							>
								Laat vallen
							</button>
						</form>
					</div>
				{:else}
					<!-- Immediate-use: al toegepast, dit is de bevestiging -->
					<p class="applied">{appliedEffectText()}</p>
					<button type="button" onclick={onclose} class="mixup-btn w-full mixup-btn-primary">
						Lekker!
					</button>
				{/if}
			{:else if isSpin && !rollStarted}
				<!-- STATE 1 — de poort. Power Spin is gewonnen en verder is er niets
				     gebeurd: geen draaiend wiel, en NIETS over de uitkomst in de DOM.
				     spinOutcome wordt in deze tak nergens gelezen en het settled-blok
				     hierboven (waar naam en icoon van de prijs staan) wordt niet
				     gerenderd, dus er valt ook niets uit de broncode te halen. -->
				<p class="slot-name">{powerupName(powerupType.id, powerupType.name)}</p>
				<p class="slot-desc">Power Spin: het resultaat bestaat pas ná je tap — niet te spieken.</p>
				<button type="button" onclick={startSpin} class="spin-btn mixup-btn mixup-btn-primary">
					Spin
				</button>
			{:else}
				<!-- STATE 2 — het wiel draait. Zelfde skelet als elke andere powerup. -->
				<p class="slot-name slot-name--rolling">· · ·</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.reveal {
		position: fixed;
		inset: 0;
		z-index: 50;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.reveal-body {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: max(56px, calc(env(safe-area-inset-top, 0px) + 14px)) 24px
			max(30px, calc(env(safe-area-inset-bottom, 0px) + 8px));
		text-align: center;
	}

	.eyebrow {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 13px;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: var(--color-mixup-yellow);
	}

	/* Designbron: 170x170, radius 34, paneelverloop, gele rand + glow. */
	.slot {
		width: 170px;
		height: 170px;
		border-radius: 34px;
		background: linear-gradient(160deg, #1a1440 0%, #0e0b28 100%);
		border: 1px solid rgba(255, 230, 0, 0.5);
		box-shadow: 0 0 50px rgba(255, 230, 0, 0.25);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.slot--settled {
		animation: revealPop 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	.slot-img {
		width: 110px;
		height: 110px;
		object-fit: contain;
	}

	.slot-img--rolling {
		animation: reel 0.4s linear infinite;
	}

	.slot-name {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 30px rgba(255, 230, 0, 0.5);
		overflow-wrap: anywhere;
	}

	.slot-name--rolling {
		animation: pulse 1.4s ease-in-out infinite;
	}

	.slot-desc {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-mixup-muted);
		max-width: 300px;
	}

	.applied {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-mixup-yellow);
		max-width: 300px;
	}

	.choice-row {
		display: flex;
		gap: 10px;
		width: 100%;
		max-width: 340px;
	}

	/* Designbron: 170x64, radius 32, 20px. */
	.spin-btn {
		width: 170px;
		height: 64px;
		font-size: 20px;
		border-radius: 32px;
	}

	@keyframes revealPop {
		0% {
			transform: scale(0.2) rotate(-8deg);
			opacity: 0;
		}
		55% {
			transform: scale(1.12) rotate(2deg);
			opacity: 1;
		}
		100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
	}

	@keyframes reel {
		0% {
			transform: translateY(-14px) scale(0.92);
			opacity: 0.55;
		}
		50% {
			transform: translateY(0) scale(1);
			opacity: 1;
		}
		100% {
			transform: translateY(14px) scale(0.92);
			opacity: 0.55;
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.slot--settled,
		.slot-img--rolling,
		.slot-name--rolling {
			animation: none;
		}
	}
</style>
