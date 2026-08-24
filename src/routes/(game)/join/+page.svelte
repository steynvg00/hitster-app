<script lang="ts">
	/**
	 * 2 · TEAM JOINEN — fallback-variant (redesign fase 2).
	 *
	 * Dit is de handmatige teamkiezer die gebruikt wordt als er geen set-context
	 * is (bijv. na een onbekende NFC-tag). Zelfde vormtaal als
	 * /sets/[id]/join, maar zonder capaciteit: deze route laadt geen
	 * ledenaantallen. Data-flow ONGEWIJZIGD: data.teams + de bestaande
	 * default-action met team_id en redirect.
	 */
	import { enhance } from '$app/forms';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { teamGlow, teamHex } from '$lib/team-theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selected = $state<string | null>(null);
	let joining = $state(false);

	const selectedTeam = $derived(data.teams.find((t) => t.id === selected) ?? null);
</script>

<svelte:head>
	<title>Kies je team — M!XUP</title>
</svelte:head>

<PlayerScreen class="px-5">
	<div class="flex min-h-0 flex-1 flex-col justify-center">
		<h1
			class="font-display text-[40px] leading-[0.95] font-black tracking-[0.02em] text-mixup-paper uppercase"
			style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
		>
			Kies je team
		</h1>
		<p class="mt-1 text-sm font-medium text-mixup-muted">
			Scan de NFC-kaart van je team om dit scherm voortaan over te slaan.
		</p>

		{#if data.error === 'unknown-tag'}
			<div
				class="mt-3 rounded-mixup-sm border border-[rgba(255,194,75,0.5)] bg-[rgba(255,194,75,0.1)] px-4 py-3 text-sm text-mixup-amber squircle"
			>
				NFC-tag niet herkend — kies hieronder handmatig je team.
			</div>
		{/if}

		<div class="mt-4 grid grid-cols-2 gap-2.5">
			{#each data.teams as team (team.id)}
				<button
					type="button"
					class="team-card rounded-mixup-card squircle"
					class:team-card--on={selected === team.id}
					disabled={joining}
					onclick={() => (selected = team.id)}
					style="--tc: {teamHex(team.color)}; --tg: {teamGlow(team.color)};"
				>
					<span class="team-dot"></span>
					<span class="text-[13px] font-extrabold tracking-[0.08em] text-mixup-paper uppercase">
						{team.display_name}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="h-[18px]"></div>

	<form
		method="POST"
		use:enhance={() => {
			joining = true;
			return async ({ update }) => {
				joining = false;
				await update();
			};
		}}
	>
		<input type="hidden" name="redirect" value={data.redirectTo} />
		<input type="hidden" name="team_id" value={selected ?? ''} />
		<button
			type="submit"
			class="pf-btn squircle"
			class:pf-btn--primary={selectedTeam !== null}
			class:pf-btn--ghost={selectedTeam === null}
			disabled={selectedTeam === null || joining}
		>
			{#if joining}
				BEZIG…
			{:else if selectedTeam}
				JOIN {selectedTeam.display_name}
			{:else}
				KIES EERST EEN TEAM
			{/if}
		</button>
	</form>
</PlayerScreen>

<style>
	.team-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 14px;
		min-height: 44px;
		box-sizing: border-box;
		text-align: left;
		cursor: pointer;
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		transition:
			background 0.2s,
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.team-card--on {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.16), rgba(229, 242, 255, 0.06));
		border-color: var(--tc);
		box-shadow: 0 0 18px color-mix(in srgb, var(--tg) 40%, transparent);
	}

	.team-dot {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--tc);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 8px var(--tg);
		display: inline-block;
		flex: 0 0 auto;
	}

	.pf-btn {
		width: 100%;
		height: 54px;
		border-radius: 26px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 16px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
		border: 1px solid transparent;
	}

	.pf-btn--primary {
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		box-shadow: 0 10px 30px rgba(255, 127, 17, 0.35);
	}

	.pf-btn--ghost {
		background: rgba(229, 242, 255, 0.06);
		color: var(--color-mixup-muted);
		border: 1px solid rgba(229, 242, 255, 0.2);
	}
</style>
