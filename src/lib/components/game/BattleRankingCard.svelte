<script lang="ts">
	/**
	 * BATTLE-KAART — de gedeelde onthulkaart van één beslecht duel.
	 *
	 * Rendert op BEIDE ceremoniesurfaces: het wachtscherm van de speler (met het
	 * eigen team gemarkeerd) en het TV-podium (zonder markering), zodat de twee
	 * nooit uit elkaar kunnen lopen.
	 *
	 * Vormgeving (redesign fase 6): design/M!XUP Ceremonie en Randen.dc.html,
	 * scherm "01 · WACHTSCHERM — BATTLE-FASE". Glaskaart met titel-eyebrow,
	 * teamrijen met bol + naam + getal, VS-scheiding ertussen en een
	 * uitkomst-tag onderaan.
	 *
	 * PURE DISPLAY over opgeslagen data: `ranking` is set_challenges.battle_ranking
	 * exact zoals resolveBattle hem vastlegde — al geordend best->slechtst, met
	 * `rank` al toegekend (competition numbering, dus een gelijk blok DEELT zijn
	 * nummer en twee teams kunnen allebei "2" lezen). Nooit hier hersorteren of
	 * herrangschikken; de opgeslagen volgorde en nummers zijn de waarheid.
	 *
	 * Toont rang + team + toegekende ladderpunten. raw_score en elapsed_seconds
	 * bewust NIET: raw_score is de pre-multiplier sorteersleutel en leest als een
	 * verkeerde score naast het leaderboard.
	 *
	 * MAATVOERING: alle maten zijn een veelvoud van `--bc-u`, één designpixel.
	 * Standaard 1px (de telefoonmaat uit de designbron); het TV-podium zet er
	 * zijn eigen schaal-unit in, zodat dezelfde kaart meeschaalt met de beamer.
	 */
	import { teamHex, teamGlow } from '$lib/team-theme';

	type BattleRankRow = {
		team_id: string;
		rank: number;
		awarded: number;
	};
	type TeamInfo = { id: string; color: string; display_name: string };

	let {
		title,
		ranking,
		teams,
		highlightTeamId = null,
		compact = false
	}: {
		title: string;
		ranking: BattleRankRow[];
		teams: TeamInfo[];
		/** Spelersurface geeft het eigen team-id door; de TV geeft niets. */
		highlightTeamId?: string | null;
		/** Telefoondichtheid (de maten van de designbron, 1:1). */
		compact?: boolean;
	} = $props();

	const teamById = $derived(new Map(teams.map((t) => [t.id, t])));

	/**
	 * De uitkomst-tag onderaan, afgeleid uit de OPGESLAGEN rangen — niet
	 * herberekend. Deelt meer dan één team rang 1, dan is het per definitie een
	 * gelijkspel (competition numbering), en dat toont de designbron als een
	 * eigen gele tag in plaats van een winnaar.
	 */
	const winners = $derived(ranking.filter((r) => r.rank === 1));
	const verdict = $derived.by(() => {
		if (winners.length === 0) return null;
		if (winners.length > 1) return { text: 'Gelijkspel — gedeelde rang', draw: true };
		const row = winners[0]!;
		const name = teamById.get(row.team_id)?.display_name ?? 'Onbekend team';
		const points = row.awarded > 0 ? ` +${row.awarded}` : '';
		return { text: `${name} wint${points}`, draw: false };
	});
</script>

<div class="bc squircle" class:bc--compact={compact}>
	<p class="bc__title">{title}</p>

	<div class="bc__rows">
		{#each ranking as row, i (row.team_id)}
			{@const team = teamById.get(row.team_id)}
			{@const hex = teamHex(team?.color)}
			{@const glow = teamGlow(team?.color)}
			{@const isMine = highlightTeamId !== null && row.team_id === highlightTeamId}

			{#if i > 0}
				<div class="bc__vs" aria-hidden="true">
					<span class="bc__vs-line"></span>
					<span class="bc__vs-label">VS</span>
					<span class="bc__vs-line"></span>
				</div>
			{/if}

			<div class="bc__row" class:bc__row--mine={isMine} style="--team: {hex};">
				<!-- Gedeelde rangen herhalen bewust: twee teams kunnen allebei 2e zijn. -->
				<span class="bc__rank" class:bc__rank--first={row.rank === 1}>{row.rank}</span>
				<span class="bc__dot" style="--dot: {hex}; --dot-glow: {glow};"></span>
				<span class="bc__name">{team?.display_name ?? 'Onbekend team'}</span>
				{#if isMine}
					<span class="bc__you">Jij</span>
				{/if}
				<span class="bc__awarded" class:bc__awarded--zero={row.awarded <= 0}>
					{row.awarded > 0 ? `+${row.awarded}` : '0'}
				</span>
			</div>
		{/each}
	</div>

	{#if verdict}
		<p class="bc__verdict" class:bc__verdict--draw={verdict.draw}>{verdict.text}</p>
	{/if}
</div>

<style>
	/* Eén designpixel. De designbron tekent op 390px breed; het TV-podium zet
	   hier zijn eigen unit in zodat dezelfde kaart meeschaalt met de beamer. */
	.bc {
		--bc-u: 1.15px;
		display: flex;
		flex-direction: column;
		gap: calc(10 * var(--bc-u));
		padding: calc(14 * var(--bc-u)) calc(16 * var(--bc-u));
		border-radius: calc(22 * var(--bc-u));
		background: linear-gradient(
			135deg,
			rgba(229, 242, 255, 0.1) 0%,
			rgba(229, 242, 255, 0.03) 100%
		);
		border: 1px solid rgba(229, 242, 255, 0.22);
		backdrop-filter: blur(var(--blur-mixup-glass));
		-webkit-backdrop-filter: blur(var(--blur-mixup-glass));
		animation: bc-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
		text-align: left;
	}

	.bc--compact {
		--bc-u: 1px;
	}

	.bc__title {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(10 * var(--bc-u));
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--color-mixup-muted);
	}

	.bc__rows {
		display: flex;
		flex-direction: column;
		gap: calc(10 * var(--bc-u));
	}

	.bc__row {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--bc-u));
		border-radius: calc(10 * var(--bc-u));
	}

	/* Eigen team: een streep in de teamkleur, geen vlak — de kaart is al glas. */
	.bc__row--mine {
		box-shadow: inset calc(3 * var(--bc-u)) 0 0 0 var(--team);
		padding-left: calc(9 * var(--bc-u));
		margin-left: calc(-9 * var(--bc-u));
	}

	.bc__rank {
		flex: 0 0 auto;
		min-width: calc(14 * var(--bc-u));
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(18 * var(--bc-u));
		line-height: 1;
		color: var(--color-mixup-dim);
		font-variant-numeric: tabular-nums;
	}

	.bc__rank--first {
		color: var(--color-mixup-yellow);
	}

	.bc__dot {
		flex: 0 0 auto;
		width: calc(12 * var(--bc-u));
		height: calc(12 * var(--bc-u));
		border-radius: 50%;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 calc(8 * var(--bc-u)) var(--dot-glow);
	}

	.bc__name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(13 * var(--bc-u));
		color: var(--color-mixup-paper);
	}

	.bc__you {
		flex: 0 0 auto;
		border-radius: 999px;
		padding: calc(2 * var(--bc-u)) calc(8 * var(--bc-u));
		background: color-mix(in srgb, var(--team) 22%, transparent);
		border: 1px solid var(--team);
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(9 * var(--bc-u));
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
	}

	.bc__awarded {
		flex: 0 0 auto;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(24 * var(--bc-u));
		line-height: 1;
		color: var(--color-mixup-green);
		font-variant-numeric: tabular-nums;
	}

	.bc__awarded--zero {
		color: var(--color-mixup-muted);
	}

	.bc__vs {
		display: flex;
		align-items: center;
		gap: calc(8 * var(--bc-u));
	}

	.bc__vs-line {
		flex: 1 1 auto;
		height: 1px;
		background: rgba(229, 242, 255, 0.14);
	}

	.bc__vs-label {
		font-family: var(--font-data);
		font-size: calc(10 * var(--bc-u));
		color: var(--color-mixup-dim);
	}

	.bc__verdict {
		align-self: center;
		margin: 0;
		border-radius: 999px;
		padding: calc(5 * var(--bc-u)) calc(14 * var(--bc-u));
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(10 * var(--bc-u));
		letter-spacing: 0.12em;
		text-transform: uppercase;
		background: rgba(43, 217, 122, 0.1);
		border: 1px solid rgba(43, 217, 122, 0.5);
		color: var(--color-mixup-green);
	}

	.bc__verdict--draw {
		background: rgba(255, 230, 0, 0.08);
		border-color: rgba(255, 230, 0, 0.45);
		color: var(--color-mixup-yellow);
	}

	@keyframes bc-in {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bc {
			animation: none;
		}
	}
</style>
