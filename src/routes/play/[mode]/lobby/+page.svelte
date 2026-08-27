<script lang="ts">
	/**
	 * 4 · LOBBY — solo-variant (redesign fase 2).
	 *
	 * Deze route is de lobby van de SOLO-modus; de team-hub lobby met de
	 * ledenlijst en de teamfoto-kaart zit in /team (die heeft de teams + de
	 * realtime). Hier is alleen de eigen spelerkaart bekend, dus dit scherm
	 * toont die in dezelfde vormtaal plus de wachtstatus.
	 *
	 * Data-flow ONGEWIJZIGD: data.player uit de bestaande load, en
	 * /api/player/leave voor het verlaten van de sessie.
	 */
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let leaving = $state(false);

	async function leaveGame() {
		if (!confirm('Sessie verlaten? Je spelersessie wordt verwijderd.')) return;
		leaving = true;
		try {
			await fetch('/api/player/leave', { method: 'POST' });
		} finally {
			window.location.href = '/';
		}
	}
</script>

<svelte:head>
	<title>Lobby — M!XUP</title>
</svelte:head>

<PlayerScreen class="items-center px-5 text-center">
	<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6">
		<div class="flex flex-col items-center gap-3">
			{#if data.player.photo_url}
				<!-- Geen loading="lazy": dit is de enige afbeelding op de pagina, staat
				     gecentreerd in beeld en is waar de speler naar kijkt. Lazy zou hem
				     hier alleen vertragen. -->
				<img
					src={data.player.photo_url}
					alt={data.player.display_name}
					class="player-av"
					width="96"
					height="96"
					decoding="async"
				/>
			{:else}
				<div class="player-av player-av--empty">
					{data.player.display_name.charAt(0).toUpperCase()}
				</div>
			{/if}
			<div>
				<div class="font-display text-[34px] leading-none font-black text-mixup-paper uppercase">
					{data.player.display_name}
				</div>
				<div class="mt-1 text-[11px] font-bold tracking-[0.16em] text-mixup-muted">
					{data.mode === 'teams' ? 'TEAMSPEL' : 'SOLO'}
				</div>
			</div>
		</div>

		<div
			class="hub-card flex w-full flex-col items-center gap-2 rounded-mixup-lg px-5 py-6 squircle"
		>
			<span class="wait-dot"></span>
			<span class="text-xs font-bold tracking-[0.1em] text-mixup-muted">
				WACHTEN TOT DE HOST START…
			</span>
			<p class="max-w-xs text-xs font-medium text-mixup-soft">
				Je bent binnen. Zodra de host de game start verschijnt je eerste challenge hier.
			</p>
		</div>
	</div>

	<button
		type="button"
		onclick={leaveGame}
		disabled={leaving}
		class="leave-btn rounded-mixup-chip squircle"
	>
		{leaving ? 'BEZIG…' : 'SESSIE VERLATEN'}
	</button>
</PlayerScreen>

<style>
	.player-av {
		width: 96px;
		height: 96px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(229, 242, 255, 0.7);
	}

	.player-av--empty {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #7c4dff, #ff2daa);
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 34px;
		color: #ffffff;
	}

	.hub-card {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.22);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}

	.wait-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-mixup-cyan);
		animation: hub-pulse 1.4s infinite;
	}

	@keyframes hub-pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	.leave-btn {
		height: 44px;
		padding: 0 18px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		letter-spacing: 0.1em;
		background: rgba(229, 242, 255, 0.06);
		border: 1px solid rgba(229, 242, 255, 0.2);
		color: var(--color-mixup-muted);
		cursor: pointer;
	}

	.leave-btn:disabled {
		opacity: 0.6;
	}
</style>
