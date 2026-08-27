<script lang="ts">
	/**
	 * Scherm 8 — SHOT-MODAL in de kleur van de GEVENDE partij + schild-toast.
	 *
	 * PUUR PRESENTATIE. Onveranderd gebleven:
	 *  - het realtime-kanaal (`incoming-effects-${teamId}-${setId}`), het filter
	 *    (`team_id=eq.${teamId}`), de set-check op de rij en de dedupe op
	 *    effect-id;
	 *  - welke effect_types hier landen (give_a_shot -> wachtrij,
	 *    shield_block -> toast) en de volgorde van de wachtrij;
	 *  - de bevestiging: POST /api/effects/consume met exact dezelfde body,
	 *    daarna schuift de kop van de wachtrij door.
	 *
	 * Nieuw is de vormgeving. De modal draagt de TEAMKLEUR van de gever; die
	 * kleur wordt hier client-side opgezocht in `teams` (dezelfde lijst die de
	 * pagina al aan HeldPowerups geeft) aan de hand van `payload.source_team_id`
	 * dat de server al meestuurde. Er is dus niets aan de payload toegevoegd.
	 *
	 * De code-regen zit BEWUST niet in deze modal: CodeRain schildert zijn eigen
	 * ondergrond (--cr-backdrop) en zou het teamkleurvlak dus overschilderen.
	 *
	 * Designbron: M!XUP Powerup-Laag.dc.html, artboard "8 Shot".
	 */
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { powerupIcon } from '$lib/mixup-assets';
	import { powerupName } from '$lib/powerups-copy';
	import { teamHex, teamOnColor } from '$lib/team-theme';

	type EffectRow = {
		id: string;
		effect_type: string;
		payload: Record<string, unknown>;
	};

	let {
		teamId,
		setId,
		effects: initialEffects = [],
		teams = []
	}: {
		teamId: string;
		setId: string;
		// Non-consumed team_effects for this team from the page load — used to seed
		// any give_a_shot the target hadn't acknowledged yet (e.g. hit while idle).
		effects?: EffectRow[];
		/**
		 * De teams van deze set, alleen om de kleur van de gever op te zoeken.
		 * Ontbreekt hij (of is de lijst leeg), dan valt de modal terug op violet.
		 */
		teams?: Array<{ id: string; color: string; display_name: string }>;
	} = $props();

	type Shot = { effectId: string; sourceName: string; sourceTeamId: string | null };

	// Shots waiting to be acknowledged, oldest first. The head renders; "Drunk!"
	// consumes it server-side and shifts to the next.
	let shotQueue = $state<Shot[]>([]);
	let blockToast = $state<{ sourceName: string; blockedType: string | null } | null>(null);
	let acking = $state(false);

	// Dedupe: the initial load and a realtime INSERT can both surface the same row
	// if they race. Track handled effect ids so a shot is only enqueued once.
	const seen = new Set<string>();

	function enqueueShot(row: EffectRow) {
		if (seen.has(row.id)) return;
		seen.add(row.id);
		shotQueue = [
			...shotQueue,
			{
				effectId: row.id,
				sourceName: (row.payload.source_team_name as string) || 'Een ander team',
				sourceTeamId: (row.payload.source_team_id as string) ?? null
			}
		];
	}

	let blockTimer: ReturnType<typeof setTimeout> | undefined;
	function showBlock(row: EffectRow) {
		blockToast = {
			sourceName: (row.payload.source_team_name as string) || 'Een ander team',
			blockedType: (row.payload.blocked_type as string) ?? null
		};
		if (blockTimer) clearTimeout(blockTimer);
		blockTimer = setTimeout(() => (blockToast = null), 6000);
	}

	async function ackShot() {
		const head = shotQueue[0];
		if (!head || acking) return;
		acking = true;
		try {
			await fetch('/api/effects/consume', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ effect_id: head.effectId })
			});
		} finally {
			acking = false;
			shotQueue = shotQueue.slice(1);
		}
	}

	// ── Vormgeving van de kop van de wachtrij ────────────────────────────────
	const head = $derived(shotQueue[0] ?? null);
	const giverColor = $derived(teams.find((t) => t.id === head?.sourceTeamId)?.color ?? 'indigo');
	const giverHex = $derived(teamHex(giverColor));
	const giverInk = $derived(teamOnColor(giverColor));

	/** Tekst van de schild-toast: welke aanval geblokkeerd werd, als we dat weten. */
	const blockText = $derived(
		blockToast
			? blockToast.blockedType
				? `Jullie schild blokkeerde een ${powerupName(blockToast.blockedType)} van ${blockToast.sourceName}`
				: `Jullie schild blokkeerde een aanval van ${blockToast.sourceName}`
			: ''
	);

	onMount(() => {
		// Seed unacknowledged shots from the server-loaded effects.
		for (const e of initialEffects) {
			if (e.effect_type === 'give_a_shot') enqueueShot(e);
		}

		const channel = supabaseBrowser
			.channel(`incoming-effects-${teamId}-${setId}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'team_effects',
					filter: `team_id=eq.${teamId}`
				},
				(payload) => {
					const row = payload.new as {
						id: string;
						effect_type: string;
						payload: Record<string, unknown> | null;
						set_id: string | null;
					};
					if (row.set_id && row.set_id !== setId) return;
					const eff: EffectRow = {
						id: row.id,
						effect_type: row.effect_type,
						payload: row.payload ?? {}
					};
					if (eff.effect_type === 'give_a_shot') enqueueShot(eff);
					else if (eff.effect_type === 'shield_block') showBlock(eff);
				}
			)
			.subscribe();

		return () => {
			if (blockTimer) clearTimeout(blockTimer);
			supabaseBrowser.removeChannel(channel);
		};
	});
</script>

{#if head}
	<!-- Shot: niet te ontwijken, blijft staan tot er bevestigd is. -->
	<div class="shot-scrim" role="dialog" aria-modal="true" aria-label="Je krijgt een shot">
		<div class="shot-modal squircle" style="--team: {giverHex}; --ink: {giverInk};">
			<span class="giver-pill">VAN {head.sourceName.toUpperCase()}</span>
			<img src={powerupIcon('give_a_shot')} alt="" class="shot-icon" />
			<div class="shot-title">{head.sourceName} geeft jullie een shot</div>
			<p class="shot-sub">Niet te ontwijken — deze melding komt terug tot je bevestigt.</p>
			<button
				type="button"
				onclick={ackShot}
				disabled={acking}
				class="drunk-btn mixup-btn mixup-btn-primary disabled:opacity-50"
			>
				{acking ? '…' : '🥂 Drunk!'}
			</button>
		</div>

		{#if blockToast}
			<!-- De schild-toast hoort in de designbron onder de shot-modal. -->
			<div class="shield-card squircle">
				<img src={powerupIcon('shield')} alt="" class="h-[30px] w-[30px] object-contain" />
				<span>{blockText}</span>
			</div>
		{/if}
	</div>
{:else if blockToast}
	<!-- Zonder shot staat de schild-melding als toast bovenin. -->
	<div class="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
		<div class="shield-card shield-card--toast squircle">
			<img src={powerupIcon('shield')} alt="" class="h-[30px] w-[30px] object-contain" />
			<span>{blockText}</span>
		</div>
	</div>
{/if}

<style>
	.shot-scrim {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		/* Volledige schermhoogte, niet inset:0. Het initial containing block is
		   per specificatie zo hoog als de KLEINE viewport, dus `inset: 0` op een
		   fixed laag levert op iOS 100svh op — 714px in een venster van 754px
		   (toestelmeting #106). Dat is variant B uit die diagnose, en die liet
		   onderaan exact die strook van 40px onbeschilderd. 100lvh is de
		   grootste stand die de viewport aanneemt; 100vh staat ervoor als
		   terugval en is op iOS van oudsher al de grote viewport. */
		height: 100vh;
		height: 100lvh;
		z-index: 50;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 24px;
		background: rgba(11, 11, 31, 0.65);
	}

	/* Designbron: het vlak draagt de kleur van de GEVER, vandaar de gradient van
	   de teamkleur naar een donkere tint ervan. */
	.shot-modal {
		width: 100%;
		max-width: 360px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 22px 20px 24px;
		border-radius: 28px;
		text-align: center;
		background: linear-gradient(
			160deg,
			color-mix(in srgb, var(--team) 95%, transparent) 0%,
			color-mix(in srgb, var(--team) 24%, #060614) 100%
		);
		border: 1px solid color-mix(in srgb, var(--team) 90%, transparent);
		box-shadow: 0 0 60px color-mix(in srgb, var(--team) 35%, transparent);
		animation: shake 0.5s ease 2;
	}

	.giver-pill {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.2em;
		border-radius: 999px;
		padding: 6px 14px;
		background: rgba(255, 255, 255, 0.85);
		color: color-mix(in srgb, var(--team) 34%, #06060f);
	}

	.shot-icon {
		width: 104px;
		height: 104px;
		object-fit: contain;
		filter: drop-shadow(0 8px 22px rgba(0, 0, 0, 0.45));
	}

	.shot-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 38px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--ink);
		overflow-wrap: anywhere;
	}

	.shot-sub {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		color: color-mix(in srgb, var(--ink) 75%, transparent);
	}

	.drunk-btn {
		width: 100%;
		height: 60px;
		font-size: 18px;
	}

	.shield-card {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		max-width: 360px;
		padding: 12px 16px;
		border-radius: 18px;
		background: rgba(0, 229, 255, 0.08);
		border: 1px solid rgba(0, 229, 255, 0.5);
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 13px;
		color: #6fe8ff;
	}

	.shield-card--toast {
		background: rgba(0, 229, 255, 0.12);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(-3px);
		}
		75% {
			transform: translateX(3px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.shot-modal {
			animation: none;
		}
	}
</style>
