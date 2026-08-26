<script lang="ts">
	/**
	 * BATTLE-KAART — de ranglijst van één battle.
	 *
	 * Een battle is ALLE teams tegen elkaar op één challenge, geen duels. De
	 * kaart toont per team wat het op DIE challenge scoorde, hoogste bovenaan,
	 * met plaatsnummer, teamkleur-bol en teamnaam, en onderaan een winnaarsregel.
	 * Er worden GEEN bonuspunten toegekend — de battle is puur weergave.
	 *
	 * Rendert op BEIDE ceremoniesurfaces: het wachtscherm van de speler (met het
	 * eigen team gemarkeerd) en het TV-podium (zonder markering), zodat de twee
	 * nooit uit elkaar kunnen lopen.
	 *
	 * Vormgeving (redesign fase 6): design/M!XUP Ceremonie en Randen.dc.html,
	 * scherm "01 · WACHTSCHERM — BATTLE-FASE". Glaskaart met titel-eyebrow,
	 * teamrijen met bol + naam + getal en een uitkomst-tag onderaan. De
	 * VS-scheiding tussen de rijen is eruit: die tekende een duel dat er niet is.
	 *
	 * PURE DISPLAY over opgeslagen data: `ranking` is set_challenges.battle_ranking
	 * exact zoals resolveBattle hem vastlegde — al geordend best->slechtst, met
	 * `rank` al toegekend (competition numbering, dus een gelijk blok DEELT zijn
	 * nummer en twee teams kunnen allebei "1" lezen). Nooit hier hersorteren of
	 * herrangschikken; de opgeslagen volgorde en nummers zijn de waarheid.
	 *
	 * MAATVOERING: alle maten zijn een veelvoud van `--bc-u`, één designpixel.
	 * Standaard 1px (de telefoonmaat uit de designbron); het TV-podium zet er
	 * zijn eigen schaal-unit in, zodat dezelfde kaart meeschaalt met de beamer.
	 */
	import { teamHex, teamGlow } from '$lib/team-theme';

	type BattleRankRow = {
		team_id: string;
		rank: number;
		/** Wat dit team op deze challenge scoorde. */
		score: number;
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
	 * De winnaarsregel onderaan, afgeleid uit de OPGESLAGEN rangen — niet
	 * herberekend. Deelt meer dan één team rang 1, dan is de eerste plaats
	 * gedeeld (competition numbering) en worden ze allemaal genoemd; die krijgt
	 * de gele tag in plaats van de groene.
	 */
	const winners = $derived(ranking.filter((r) => r.rank === 1));
	const nameOf = (id: string) => teamById.get(id)?.display_name ?? 'Onbekend team';
	const verdict = $derived.by(() => {
		if (winners.length === 0) return null;
		const names = winners.map((w) => nameOf(w.team_id));
		if (names.length > 1) {
			const joined = `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
			return { text: `Winnaar: ${joined} (gedeeld)`, draw: true };
		}
		return { text: `Winnaar: ${names[0]}`, draw: false };
	});
</script>

<div class="bc squircle" class:bc--compact={compact}>
	<p class="bc__title">{title}</p>

	<div class="bc__rows">
		{#each ranking as row (row.team_id)}
			{@const team = teamById.get(row.team_id)}
			{@const hex = teamHex(team?.color)}
			{@const glow = teamGlow(team?.color)}
			{@const isMine = highlightTeamId !== null && row.team_id === highlightTeamId}

			<div class="bc__row" class:bc__row--mine={isMine} style="--team: {hex};">
				<!-- Gedeelde rangen herhalen bewust: twee teams kunnen allebei 1e zijn. -->
				<span class="bc__rank" class:bc__rank--first={row.rank === 1}>{row.rank}</span>
				<span class="bc__dot" style="--dot: {hex}; --dot-glow: {glow};"></span>
				<span class="bc__name">{team?.display_name ?? 'Onbekend team'}</span>
				{#if isMine}
					<span class="bc__you">Jij</span>
				{/if}
				<!-- Het getal is de score op DEZE challenge, geen bonus: dus geen "+". -->
				<span class="bc__score" class:bc__score--zero={row.score <= 0}>{row.score}</span>
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

	.bc__score {
		flex: 0 0 auto;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(24 * var(--bc-u));
		line-height: 1;
		color: var(--color-mixup-green);
		font-variant-numeric: tabular-nums;
	}

	.bc__score--zero {
		color: var(--color-mixup-muted);
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
