<script lang="ts">
	/**
	 * 2 · TEAM JOINEN (redesign fase 2) — mobiel, referentie 390x844.
	 *
	 * Teamblokken in een 2-koloms grid met de LIVE capaciteit per team
	 * (member_count / slotsPerTeam, of "VOL"). De spin-knop kiest een
	 * willekeurig niet-vol team en stuurt dat door dezelfde joinTeam-action —
	 * die redirect al naar de randomizer.
	 *
	 * Data-flow ONGEWIJZIGD: data.teamList (member_count, is_full),
	 * data.slotsPerTeam en de bestaande ?/joinTeam-action.
	 */
	import { enhance } from '$app/forms';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { teamGlow, teamHex } from '$lib/team-theme';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let selected = $state<string | null>(null);
	let joining = $state(false);
	let spinning = $state(false);
	let spinIdx = $state(-1);
	let joinForm = $state<HTMLFormElement | null>(null);

	const openTeams = $derived(data.teamList.filter((t) => !t.is_full));
	const selectedTeam = $derived(data.teamList.find((t) => t.id === selected) ?? null);

	function capacityLabel(team: (typeof data.teamList)[number]): string {
		if (team.is_full) return 'VOL';
		if (data.slotsPerTeam !== null) return `${team.member_count}/${data.slotsPerTeam} SPELERS`;
		return `${team.member_count} SPELERS`;
	}

	/**
	 * "Verras me": rolt kort door de beschikbare teams heen en submit dan het
	 * team waarop hij stilvalt via de bestaande joinTeam-action.
	 */
	function surpriseMe() {
		if (spinning || joining || openTeams.length === 0) return;
		spinning = true;
		let ticks = 0;
		const iv = setInterval(() => {
			spinIdx = data.teamList.indexOf(openTeams[ticks % openTeams.length]);
			ticks++;
			if (ticks > 12) {
				clearInterval(iv);
				const pick = openTeams[Math.floor(Math.random() * openTeams.length)];
				spinIdx = data.teamList.indexOf(pick);
				selected = pick.id;
				spinning = false;
				// Het verborgen veld staat al op `selected` via de binding; submit
				// imperatief zodat FormData de nieuwe waarde ziet (Svelte 5 stelt
				// signal-naar-DOM effecten uit tot een microtask).
				const el = joinForm?.querySelector<HTMLInputElement>('input[name="team_id"]');
				if (el) el.value = pick.id;
				joinForm?.requestSubmit();
			}
		}, 90);
	}
</script>

<svelte:head>
	<title>Kies je team — {data.setName}</title>
</svelte:head>

<PlayerScreen class="px-5 pt-2">
	<div class="text-center mixup-eyebrow text-mixup-dim">M!XUP · {data.setName}</div>

	<div class="flex min-h-0 flex-1 flex-col justify-center">
		<h1
			class="font-display text-[40px] leading-[0.95] font-black tracking-[0.02em] text-mixup-paper uppercase"
			style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
		>
			Kies je team
		</h1>
		<p class="mt-1 text-sm font-medium text-mixup-muted">
			Aantallen tellen live mee terwijl iedereen joint.
		</p>

		{#if form?.error}
			<div
				class="mt-3 rounded-mixup-sm border border-[rgba(255,59,74,0.5)] bg-[rgba(255,59,74,0.12)] px-4 py-3 text-sm text-[#FF6FC4] squircle"
			>
				{form.error}
			</div>
		{/if}

		<div class="mt-4 grid grid-cols-2 gap-2.5">
			{#each data.teamList as team, i (team.id)}
				{@const hex = teamHex(team.color)}
				{@const on = selected === team.id || spinIdx === i}
				<button
					type="button"
					class="team-card rounded-mixup-card squircle"
					class:team-card--on={on}
					class:team-card--full={team.is_full}
					disabled={team.is_full || joining}
					onclick={() => (selected = team.id)}
					style="--tc: {hex}; --tg: {teamGlow(team.color)};"
				>
					<span class="team-dot"></span>
					<span class="text-[13px] font-extrabold tracking-[0.08em] text-mixup-paper uppercase">
						{team.display_name}
					</span>
					<span
						class="text-[11px] font-bold tracking-[0.1em]"
						style="color: {team.is_full ? '#FF6FC4' : 'var(--color-mixup-muted)'};"
					>
						{capacityLabel(team)}
					</span>
				</button>
			{/each}
		</div>
	</div>

	<div class="h-[18px]"></div>

	<form
		bind:this={joinForm}
		method="POST"
		action="?/joinTeam"
		use:enhance={() => {
			joining = true;
			return async ({ update }) => {
				joining = false;
				await update();
			};
		}}
		class="flex flex-col gap-2.5"
	>
		<input type="hidden" name="team_id" value={selected ?? ''} />

		<button
			type="button"
			class="pf-btn pf-btn--secondary squircle"
			class:pf-btn--ghost={spinning}
			onclick={surpriseMe}
			disabled={spinning || joining || openTeams.length === 0}
		>
			{spinning ? 'TEAMS AAN HET HUSSELEN…' : 'VERRAS ME — RANDOM TEAM'}
		</button>

		<button
			type="submit"
			class="pf-btn squircle"
			class:pf-btn--primary={selectedTeam !== null}
			class:pf-btn--ghost={selectedTeam === null}
			disabled={selectedTeam === null || joining || spinning}
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

	.team-card--full {
		opacity: 0.45;
		cursor: default;
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

	.pf-btn--secondary {
		background: rgba(255, 230, 0, 0.1);
		color: var(--color-mixup-yellow);
		border: 1px solid var(--color-mixup-yellow);
	}

	.pf-btn--ghost {
		background: rgba(229, 242, 255, 0.06);
		color: var(--color-mixup-muted);
		border: 1px solid rgba(229, 242, 255, 0.2);
		box-shadow: none;
	}

	.pf-btn:disabled {
		cursor: default;
	}
</style>
