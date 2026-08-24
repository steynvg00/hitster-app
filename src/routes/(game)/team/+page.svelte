<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { ICON_ASSETS, RANK_ASSETS } from '$lib/mixup-assets';
	import { teamBanner, teamGlow, teamHex, teamOnColor } from '$lib/team-theme';
	import { getTypeLogo } from '$lib/variants';
	import TutorialOverlay from '$lib/components/game/TutorialOverlay.svelte';
	import HeldPowerups from '$lib/components/game/HeldPowerups.svelte';
	import ActiveEffectsBanner from '$lib/components/game/ActiveEffectsBanner.svelte';
	import IncomingEffectsListener from '$lib/components/game/IncomingEffectsListener.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let liveScore = $state(data.team.score);
	let livePosition = $state(data.position);
	let livePlayState = $state(data.activeSet?.play_state ?? 'playing');
	let crownHolderTeamId = $state(data.crownHolderTeamId);

	const iscrownHolder = $derived(crownHolderTeamId === data.team.id);

	// Lobby realtime: players joining teams
	type LobbyPlayer = {
		id: string;
		display_name: string;
		photo_url: string | null;
		team_id: string | null;
	};
	let lobbyTeams = $state(data.lobbyTeams.map((t) => ({ ...t, players: [...t.players] })));

	let showTutorials = $state(false);

	const hex = $derived(teamHex(data.team.color));
	const onColor = $derived(teamOnColor(data.team.color));
	const banner = $derived(teamBanner(data.team.color));

	function formatActivity(event_type: string, payload: unknown): string {
		if (event_type === 'team_entry') return 'Via entry-kaart gejoind';
		if (event_type === 'challenge_submit') {
			const p = payload as { challenge_title?: string; score?: number } | null;
			return p?.challenge_title
				? `"${p.challenge_title}" ingeleverd · ${p.score ?? 0} pt`
				: 'Challenge ingeleverd';
		}
		return event_type.replace(/_/g, ' ');
	}

	const isLocked = (challengeId: string) => {
		const ch = data.challenges.find((c) => c.id === challengeId);
		const required = ch?.nfc_lock_override ?? data.activeSet?.nfc_lock_enabled ?? false;
		return required && !data.challengeUnlocks.includes(challengeId);
	};

	onMount(() => {
		// Score + position realtime
		const teamChannel = supabaseBrowser
			.channel(`team-home-${data.team.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'teams',
					filter: `id=eq.${data.team.id}`
				},
				async (payload) => {
					liveScore = (payload.new as { score: number }).score;
					const { data: allTeams } = await supabaseBrowser
						.from('teams')
						.select('id, score')
						.order('score', { ascending: false });
					if (allTeams) {
						livePosition = allTeams.findIndex((t) => t.id === data.team.id) + 1 || 1;
					}
				}
			)
			.subscribe();

		// Game set state realtime (transitions joining → playing → recap)
		let setChannel: ReturnType<typeof supabaseBrowser.channel> | undefined;
		if (data.activeSet?.id) {
			setChannel = supabaseBrowser
				.channel(`team-set-state-${data.activeSet.id}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'game_sets',
						filter: `id=eq.${data.activeSet.id}`
					},
					(payload) => {
						const p = payload.new as {
							play_state?: string;
							recap_state?: string;
							crown_holder_team_id?: string | null;
						};
						if (p.play_state) livePlayState = p.play_state;
						if ('crown_holder_team_id' in p) crownHolderTeamId = p.crown_holder_team_id ?? null;
						if (p.play_state === 'recap' && data.activeSet) {
							window.location.href = `/play/waiting?set_id=${data.activeSet.id}`;
						}
						if (p.recap_state === 'complete' && data.activeSet) {
							window.location.href = `/play/thanks?set_id=${data.activeSet.id}`;
						}
					}
				)
				.subscribe();

			// Lobby: players joining realtime
			if (data.activeSet.play_state === 'joining') {
				supabaseBrowser
					.channel(`team-lobby-players-${data.activeSet.id}`)
					.on(
						'postgres_changes',
						{
							event: '*',
							schema: 'public',
							table: 'players',
							filter: `set_id=eq.${data.activeSet.id}`
						},
						(payload) => {
							if (payload.eventType === 'DELETE') return;
							const p = payload.new as LobbyPlayer;
							// Remove player from all teams, then add to new team
							lobbyTeams = lobbyTeams.map((t) => ({
								...t,
								players: [
									...t.players.filter((pl) => pl.id !== p.id),
									...(p.team_id === t.id
										? [{ id: p.id, display_name: p.display_name, photo_url: p.photo_url }]
										: [])
								]
							}));
						}
					)
					.subscribe();
			}
		}

		return () => {
			supabaseBrowser.removeChannel(teamChannel);
			if (setChannel) supabaseBrowser.removeChannel(setChannel);
		};
	});
</script>

{#if showTutorials && data.setTutorials.length > 0}
	<TutorialOverlay tutorials={data.setTutorials} onclose={() => (showTutorials = false)} />
{/if}

<!-- ══ 4 · TEAM-HUB LOBBY (play_state = joining) ══════════════════════════ -->
{#if livePlayState === 'joining' && data.activeSet}
	<PlayerScreen class="hub">
		<div class="hub-banner" style="background: {banner}; box-shadow: 0 8px 30px {hex}44;">
			<div class="flex items-center gap-2.5">
				<div class="min-w-0 flex-1">
					<div class="hub-banner__eyebrow" style="color: {onColor}; opacity: 0.75;">JIJ BENT</div>
					<div class="hub-banner__team" style="color: {onColor};">{data.team.display_name}</div>
				</div>
				{#if data.setTutorials.length > 0}
					<button
						type="button"
						class="hub-banner__action rounded-mixup-chip squircle"
						style="color: {onColor}; border-color: rgba(255,255,255,0.5);"
						onclick={() => (showTutorials = true)}
					>
						UITLEG
					</button>
				{/if}
			</div>
		</div>

		<div class="hub-scroll">
			<div class="text-center mixup-eyebrow">M!XUP · {data.activeSet.name}</div>

			{#each lobbyTeams as t (t.id)}
				{@const tHex = teamHex(t.color)}
				<div class="hub-card flex items-center gap-2.5 rounded-mixup-card squircle">
					<!-- Volle kleurbol = placeholder voor de teamfoto (fase 7) -->
					<span
						class="lobby-bubble"
						style="background: linear-gradient(135deg, {tHex}55, {tHex}1A);
						       border-color: {t.color === 'black' ? 'rgba(255,255,255,0.7)' : tHex + 'AA'};
						       box-shadow: 0 0 12px {teamGlow(t.color)};"
					>
						<img src={ICON_ASSETS.camera} alt="" class="h-[18px] w-[18px] object-contain" />
					</span>
					<span class="flex-1 text-xs font-extrabold tracking-[0.08em] text-mixup-paper uppercase">
						{t.display_name}
					</span>
					<span class="flex">
						{#each t.players as p (p.id)}
							{#if p.photo_url}
								<img src={p.photo_url} alt={p.display_name} class="lobby-av" />
							{:else}
								<span class="lobby-av" style="background: {tHex}; color: {teamOnColor(t.color)};">
									{p.display_name.slice(0, 2).toUpperCase()}
								</span>
							{/if}
						{/each}
					</span>
				</div>
			{/each}
		</div>

		<div class="flex items-center justify-center gap-2 px-5 pt-3.5">
			<span class="wait-dot"></span>
			<span class="text-xs font-bold tracking-[0.1em] text-mixup-muted">
				WACHTEN TOT DE HOST START…
			</span>
		</div>

		<!-- Teamfoto-kaart: laatste blok, camera-only. De UPLOAD zelf is fase 7. -->
		<div class="px-5 pt-3">
			<div class="hub-card flex items-center gap-3 rounded-mixup-lg squircle">
				<div class="photo-slot rounded-mixup-sm squircle">
					<img src={ICON_ASSETS.camera} alt="" class="h-[38px] w-[38px] object-contain" />
				</div>
				<div class="flex flex-1 flex-col gap-0.5">
					<span class="text-[10px] font-extrabold tracking-[0.16em] text-mixup-muted">
						TEAMFOTO
					</span>
					<span class="text-xs font-medium text-mixup-soft">
						Nog geen foto · alleen via de camera
					</span>
				</div>
				<label class="photo-btn rounded-mixup-chip squircle">
					MAAK FOTO
					<input type="file" accept="image/*" capture="environment" class="sr-only" />
				</label>
			</div>
		</div>
	</PlayerScreen>

	<!-- ══ 5 · TEAM-HUB CONSOLE ═══════════════════════════════════════════ -->
{:else}
	<PlayerScreen class="hub">
		<div class="hub-banner" style="background: {banner}; box-shadow: 0 8px 30px {hex}44;">
			<div class="flex items-center gap-2.5">
				<div class="min-w-0">
					<div class="hub-banner__eyebrow" style="color: {onColor}; opacity: 0.75;">JOUW TEAM</div>
					<div class="hub-banner__team" style="color: {onColor};">{data.team.display_name}</div>
				</div>
				{#if iscrownHolder}
					<img src={RANK_ASSETS.crown} alt="Plek 1" class="hub-crown" />
				{/if}
			</div>
		</div>

		<div class="flex gap-2.5 px-5 pt-3.5">
			<div class="hub-card flex-1 rounded-mixup-card py-3 text-center squircle">
				<div
					class="font-display text-[32px] leading-none font-black text-mixup-yellow tabular-nums"
				>
					{liveScore}
				</div>
				<div class="mt-1 text-[10px] font-bold tracking-[0.1em] text-mixup-muted">SCORE</div>
			</div>
			<div class="hub-card flex-1 rounded-mixup-card py-3 text-center squircle">
				<div class="font-display text-[32px] leading-none font-black text-mixup-cyan tabular-nums">
					#{livePosition}
				</div>
				<div class="mt-1 text-[10px] font-bold tracking-[0.1em] text-mixup-muted">
					VAN {data.totalTeams}
				</div>
			</div>
		</div>

		{#if data.playerSetId}
			<IncomingEffectsListener
				teamId={data.team.id}
				setId={data.playerSetId}
				effects={data.activeEffects}
			/>
		{/if}

		{#if data.playerSetId && data.activeEffects?.length > 0}
			<div class="px-5 pt-3">
				<ActiveEffectsBanner
					teamId={data.team.id}
					setId={data.playerSetId}
					effects={data.activeEffects}
				/>
			</div>
		{/if}

		{#if data.playerSetId && data.heldPowerups}
			<div class="px-5 pt-3">
				<div class="hub-card flex flex-col gap-2 rounded-mixup-lg squircle">
					<span class="text-[10px] font-extrabold tracking-[0.18em] text-mixup-yellow">
						POWERUPS
					</span>
					<HeldPowerups
						teamId={data.team.id}
						setId={data.playerSetId}
						powerups={data.heldPowerups}
						setTeams={data.setTeams}
						resurrectableChallenges={data.resurrectableChallenges}
					/>
				</div>
			</div>
		{/if}

		<div class="flex items-center justify-between px-5 pt-3.5 pb-1.5">
			<span class="text-[10px] font-extrabold tracking-[0.18em] text-mixup-yellow">CHALLENGES</span>
			<div class="flex items-center gap-2">
				{#if data.activeSet}
					<span class="text-[10px] font-bold tracking-[0.1em] text-mixup-muted">
						{data.setCompletedCount}/{data.setTotalCount} KLAAR
					</span>
				{/if}
				<a
					href={data.activeSet?.status === 'active' ? '/play/leaderboard' : '/leaderboard'}
					class="hub-link rounded-mixup-chip squircle">STAND</a
				>
				{#if data.setTutorials.length > 0}
					<button
						type="button"
						class="hub-link rounded-mixup-chip squircle"
						onclick={() => (showTutorials = true)}>UITLEG</button
					>
				{/if}
			</div>
		</div>

		<div class="hub-scroll pt-0">
			{#if data.challenges.length === 0}
				<p class="text-sm text-mixup-dim">Nog geen actieve challenges — kom zo terug.</p>
			{:else}
				{#each data.challenges as ch (ch.id)}
					{@const locked = isLocked(ch.id)}
					{@const logo = getTypeLogo(ch.variant)}
					<div
						class="hub-card flex items-center gap-2.5 rounded-mixup-card squircle"
						style="opacity: {locked ? 0.55 : 1};"
					>
						<span class="ch-logo-slot">
							{#if logo}
								<span
									class="ch-logo"
									style="height: {logo.height}px; background-image: url('{logo.src}');"
								></span>
							{:else}
								<span class="truncate text-sm font-bold text-mixup-paper">{ch.title}</span>
							{/if}
						</span>
						{#if ch.isBattle}
							<span title="Battle-challenge — alle teams worden onderling gerangschikt">⚔️</span>
						{/if}
						{#if locked}
							<img src={ICON_ASSETS.lock} alt="" class="ch-lock" />
							<span class="ch-tag ch-tag--muted">SCAN CHALLENGE BOARD</span>
						{:else if ch.status === 'completed'}
							<span class="ch-tag ch-tag--done">DONE · +{ch.earnedScore ?? 0}</span>
						{:else}
							<a
								href="/challenge/{ch.id}"
								class="ch-tag"
								style="background: {hex}33; border-color: {hex}; color: var(--color-mixup-paper);"
								>▶ PLAY</a
							>
						{/if}
					</div>
				{/each}
			{/if}

			{#if data.recentActivity.length > 0}
				<div class="pt-2 text-[10px] font-extrabold tracking-[0.18em] text-mixup-muted">RECENT</div>
				{#each data.recentActivity as entry (entry.id)}
					<div class="act-row rounded-mixup-sm squircle">
						<span class="act-dot" style="background: {hex};"></span>
						<span class="flex-1 text-xs text-mixup-soft">
							{formatActivity(entry.event_type, entry.payload)}
						</span>
						<span class="text-[10px] text-mixup-dim tabular-nums">
							{new Date(entry.created_at).toLocaleTimeString('nl-NL', {
								hour: '2-digit',
								minute: '2-digit'
							})}
						</span>
					</div>
				{/each}
			{/if}
		</div>
	</PlayerScreen>
{/if}

<style>
	/* De hub gebruikt de volle breedte: de banner loopt door tot de schermrand. */
	:global(.hub) {
		padding-left: 0;
		padding-right: 0;
	}

	.hub-banner {
		padding: 16px 20px;
		flex: 0 0 auto;
	}

	.hub-banner__eyebrow {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		letter-spacing: 0.24em;
	}

	.hub-banner__team {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.95;
		text-transform: uppercase;
	}

	.hub-banner__action {
		margin-left: auto;
		height: 44px;
		padding: 0 14px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		letter-spacing: 0.1em;
		background: transparent;
		border: 1px solid;
		cursor: pointer;
	}

	.hub-crown {
		width: 96px;
		height: 140px;
		margin-left: auto;
		flex: 0 0 auto;
		object-fit: contain;
		filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.5))
			drop-shadow(0 0 24px rgba(255, 215, 94, 0.45));
	}

	.hub-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 20px 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.hub-card {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.18);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		padding: 12px 14px;
	}

	.lobby-bubble {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 1.5px solid;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.lobby-av {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(229, 242, 255, 0.6);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		margin-left: -6px;
		flex: 0 0 auto;
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

	.photo-slot {
		width: 56px;
		height: 56px;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: rgba(11, 11, 31, 0.55);
		border: 2px dashed rgba(229, 242, 255, 0.3);
	}

	.photo-btn {
		height: 44px;
		padding: 0 16px;
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		letter-spacing: 0.1em;
		cursor: pointer;
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		border: 1px solid transparent;
	}

	.hub-link {
		height: 26px;
		padding: 0 10px;
		display: inline-flex;
		align-items: center;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.14em;
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.18);
		color: var(--color-mixup-muted);
		cursor: pointer;
	}

	.ch-logo-slot {
		flex: 1;
		min-width: 0;
		height: 44px;
		display: flex;
		align-items: center;
	}

	.ch-logo {
		display: inline-block;
		width: 100%;
		max-width: 150px;
		background-size: contain;
		background-repeat: no-repeat;
		background-position: left center;
	}

	.ch-lock {
		width: 22px;
		height: 27px;
		flex: 0 0 auto;
		object-fit: contain;
		filter: drop-shadow(0 0 6px rgba(124, 77, 255, 0.5));
	}

	.ch-tag {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.1em;
		border-radius: 999px;
		padding: 6px 12px;
		flex: 0 0 auto;
		border: 1px solid;
		white-space: nowrap;
	}

	.ch-tag--muted {
		background: rgba(229, 242, 255, 0.04);
		border-color: rgba(229, 242, 255, 0.18);
		color: var(--color-mixup-muted);
	}

	.ch-tag--done {
		background: rgba(43, 217, 122, 0.1);
		border-color: rgba(43, 217, 122, 0.5);
		color: var(--color-mixup-green);
	}

	.act-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: rgba(229, 242, 255, 0.04);
		border: 1px solid rgba(229, 242, 255, 0.12);
	}

	.act-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex: 0 0 auto;
	}
</style>
