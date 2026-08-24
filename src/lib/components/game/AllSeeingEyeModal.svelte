<script lang="ts">
	/**
	 * Scherm 9 — ALL-SEEING EYE. Bewust ZONDER goed/fout.
	 *
	 * PUUR PRESENTATIE. Deze component rendert wat hij krijgt en leidt NIETS af
	 * — in het bijzonder vergelijkt hij nooit een waarde met een juist antwoord,
	 * want hij heeft geen juist antwoord om mee te vergelijken. De payload is al
	 * server-side gestript (stripAnswersForEye). Geen groen, geen rood, geen
	 * doorhaling: het Oog toont wat er stáát, niet wat juist is.
	 *
	 * Designbron: M!XUP Powerup-Laag.dc.html, artboard "9 All-Seeing Eye".
	 */
	import type { EyeTeam } from '$lib/powerups-meta';
	import { powerupIcon } from '$lib/mixup-assets';
	import { fieldLabel } from '$lib/powerups-copy';
	import { teamHex } from '$lib/team-theme';

	let {
		teams,
		fields,
		onclose
	}: {
		// Already stripped server-side (stripAnswersForEye). This component renders
		// what it is given and derives NOTHING — in particular it never compares a
		// value to a correct answer, because it has no correct answer to compare to.
		teams: EyeTeam[];
		// The challenge's field order, so columns line up with the player's own form
		// instead of following whatever order a team's JSON happened to have.
		fields: string[];
		onclose: () => void;
	} = $props();

	// A team's answers are shown exactly as typed. An empty string means they left
	// it blank, which is information the Eye is allowed to show — it is what they
	// wrote (nothing), not a judgement on it.
	function shown(value: string | undefined): string {
		return value && value.trim() !== '' ? value : '—';
	}

	// The multi-line artist input stores tags newline-separated; join them the way
	// the results screen does so the panel reads as one answer.
	function display(field: string, value: string | undefined): string {
		const v = shown(value);
		return field === 'artist' ? v.split('\n').filter(Boolean).join(' & ') || '—' : v;
	}
</script>

<div class="eye-scrim" role="dialog" aria-modal="true" aria-label="All-Seeing Eye">
	<div class="eye-card squircle">
		<div class="flex items-center gap-2.5">
			<img src={powerupIcon('all_seeing_eye')} alt="" class="h-[34px] w-[34px] object-contain" />
			<div class="eye-title">All-Seeing Eye</div>
			<button type="button" class="eye-close squircle" onclick={onclose} aria-label="Sluiten">
				✕
			</button>
		</div>

		<p class="eye-lead">
			{teams.length}
			{teams.length === 1 ? 'team heeft' : 'teams hebben'} deze challenge al af. Dit is wat zij schreven.
		</p>

		<div class="eye-scroll">
			{#each teams as team (team.teamId)}
				<div class="eye-row squircle">
					<div class="flex items-center gap-2">
						<span class="dot" style="--dot: {teamHex(team.color)};"></span>
						<span class="eye-team">{team.displayName}</span>
						<!-- Alleen zichtbaar als de host show_scores aanzette. Staat de vlag
						     uit, dan laat de server de sleutel helemaal weg — er is hier dus
						     niets om op terug te vallen. -->
						{#if typeof team.score === 'number'}
							<span class="eye-score">{team.score} ptn</span>
						{/if}
					</div>

					{#each team.tabs as tab (tab.tabPosition)}
						{#if team.tabs.length > 1}
							<div class="eye-tab-label">TRACK {String(tab.tabPosition + 1).padStart(2, '0')}</div>
						{/if}
						{#each tab.slots as slot (slot.slotIndex)}
							<div class="eye-slot">
								{#each fields as field (field)}
									<div class="eye-field">
										<span class="eye-field-label">{fieldLabel(field)}</span>
										<!-- Neutrale tekstkleur, met opzet: geen groen, geen rood,
										     geen doorhaling. -->
										<span class="eye-value">{display(field, slot.fieldValues[field])}</span>
									</div>
								{/each}
								{#if slot.fragments?.length}
									<div class="eye-field">
										<span class="eye-field-label">FRAGMENTEN</span>
										<span class="eye-value">{slot.fragments.join(', ')}</span>
									</div>
								{/if}
							</div>
						{/each}
					{/each}
				</div>
			{/each}
		</div>

		<p class="eye-foot">Het Oog toont wat er stáát — niet wat juist is.</p>

		<button type="button" class="mixup-btn w-full mixup-btn-primary" onclick={onclose}>
			Sluit het oog
		</button>
	</div>
</div>

<style>
	.eye-scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 18px;
		background: rgba(11, 11, 31, 0.65);
	}

	/* Designbron: paneelverloop, violette rand + glow, radius 28, padding 20. */
	.eye-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		max-width: 400px;
		max-height: 100%;
		padding: 20px;
		border-radius: 28px;
		background: linear-gradient(160deg, #1a1440 0%, #0e0b28 100%);
		border: 1px solid rgba(124, 77, 255, 0.55);
		box-shadow: 0 0 50px rgba(124, 77, 255, 0.25);
	}

	.eye-title {
		flex: 1 1 auto;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 26px;
		line-height: 1;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
	}

	.eye-close {
		flex: 0 0 auto;
		width: 34px;
		height: 34px;
		border-radius: 12px;
		background: rgba(229, 242, 255, 0.06);
		border: 1px solid rgba(229, 242, 255, 0.2);
		color: var(--color-mixup-muted);
		font-size: 14px;
	}

	.eye-lead {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 12px;
		color: var(--color-mixup-muted);
	}

	.eye-scroll {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		overflow-y: auto;
	}

	.eye-row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		border-radius: 16px;
		background: rgba(11, 11, 31, 0.55);
		border: 1px solid rgba(229, 242, 255, 0.14);
	}

	.dot {
		width: 12px;
		height: 12px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 8px var(--dot);
	}

	.eye-team {
		flex: 1 1 auto;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-mixup-muted);
	}

	.eye-score {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		color: var(--color-mixup-yellow);
	}

	.eye-tab-label {
		margin-top: 2px;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.14em;
		color: var(--color-mixup-dim);
	}

	.eye-slot {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.eye-field {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.eye-field-label {
		flex: 0 0 auto;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--color-mixup-dim);
	}

	.eye-value {
		min-width: 0;
		text-align: right;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		color: var(--color-mixup-soft);
		overflow-wrap: anywhere;
	}

	.eye-foot {
		font-family: var(--font-data);
		font-size: 11px;
		text-align: center;
		color: var(--color-mixup-dim);
	}
</style>
