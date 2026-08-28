<script lang="ts">
	/**
	 * INGRIJPEN — de vier host-ingrepen voor één team, op één scherm.
	 *
	 * Vormgegeven voor een TELEFOON in de hand, niet voor een laptop op tafel: één
	 * kolom, knoppen van 44px en hoger, cijfertoetsenbord waar er een getal moet
	 * komen, en snelknoppen voor de waarden die je tijdens een avond echt gebruikt
	 * (±1, ±5, ±10 punten; 30/60/120 seconden). De host staat vrijdag tussen de
	 * gasten.
	 *
	 * DRIE STAPPEN, altijd dezelfde: kies een ingreep, vul hem in, bevestig. Bij
	 * de twee onomkeerbare — punten aftrekken en een challenge terugzetten — is
	 * die derde stap een aparte knop die pas verschijnt na de eerste, met daarin
	 * uitgeschreven wat er gaat gebeuren. Een `confirm()` uit de browser doet dat
	 * ook, maar zonder de getallen erbij, en op iOS ziet hij eruit als iets van
	 * Safari in plaats van iets van deze app.
	 *
	 * De REDEN staat bovenaan elk formulier en niet onderaan: hij is verplicht
	 * (de server weigert een lege), en verplichte velden horen niet onder de knop
	 * te staan waar je pas na een foutmelding achter komt.
	 *
	 * Dit component beslist NIETS. Elke knop is een echt <form> naar een action op
	 * /admin/live; de regels staan in $lib/server/host-tools.
	 */
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import Modal from '$lib/components/ui/Modal.svelte';

	type Team = { id: string; color: string; display_name: string; score: number };
	type Challenge = { id: string; title: string; variant: string };
	type PowerupTypeOption = {
		id: string;
		name: string;
		icon: string | null;
		category: string | null;
		immediate_use: boolean;
		holdable: boolean;
	};

	let {
		team,
		setId,
		teamColor,
		runningChallenge = null,
		resettableChallenges = [],
		powerupTypes = [],
		onclose,
		ondone
	}: {
		team: Team;
		setId: string | null;
		teamColor: string;
		/** De challenge waar dit team NU mee bezig is (open attempt), of null. */
		runningChallenge?: Challenge | null;
		/** Challenges waar dit team een beurt of inlevering op heeft. */
		resettableChallenges?: Challenge[];
		powerupTypes?: PowerupTypeOption[];
		onclose: () => void;
		ondone: (message: string) => void;
	} = $props();

	type Tool = 'punten' | 'powerup' | 'tijd' | 'reset';
	let tool = $state<Tool | null>(null);

	// Per ingreep een eigen reden: wisselen van tool mag de ene reden niet in de
	// andere laten staan — dat is precies hoe een verkeerde reden in het log komt.
	let redenPunten = $state('');
	let redenPowerup = $state('');
	let redenTijd = $state('');
	let redenReset = $state('');

	let delta = $state(0);
	let seconden = $state(60);
	let gekozenType = $state('');
	let gekozenReset = $state('');

	// De bevestigingsstap van de twee onomkeerbare ingrepen.
	let bevestigPunten = $state(false);
	let bevestigReset = $state(false);

	let bezig = $state(false);
	let foutmelding = $state('');

	const gekozenPowerup = $derived(powerupTypes.find((p) => p.id === gekozenType) ?? null);
	const resetDoel = $derived(resettableChallenges.find((c) => c.id === gekozenReset) ?? null);

	// Punten aftrekken is onomkeerbaar; erbij geven kan de host zelf weer
	// terugdraaien met dezelfde knop. Alleen de eerste krijgt dus een tweede stap.
	const puntenIsOnomkeerbaar = $derived(delta < 0);
	const nieuweScore = $derived(Math.max(0, team.score + delta));
	const wordtGeklemd = $derived(team.score + delta < 0);

	/**
	 * WAT ER GEBEURT ALS DE HOST DIT TYPE TOEKENT.
	 *
	 * Een waarschuwing aan de host, geen speler-copy — vandaar hier en niet in
	 * $lib/powerups-copy. De regel staat op het scherm vóór de bevestiging, want
	 * bij de helft van deze types is "toekennen" hetzelfde als "nu afvuren", en
	 * dat is niet af te leiden uit de naam.
	 */
	const HOST_GRANT_EFFECT: Record<string, string> = {
		bonus_points: 'Zet +5 klaar voor de volgende inlevering van dit team.',
		lucky_dice: 'Gooit NU en zet de punten meteen op de teamscore.',
		hard_gaan: 'Start het vermenigvuldiger-venster van 15 minuten NU.',
		single_event_mult: 'Rolt de vermenigvuldiger voor de volgende challenge van dit team.',
		power_spin:
			'Draait het wiel server-side en kent de prijs toe. De speler ziet de wielanimatie NIET — die hoort bij het zelf verdienen. Hij krijgt alleen de uitkomst.',
		penalty_shot:
			'Legt direct een strafshot op. Los toegekend hangt hij aan geen enkele challenge, dus de speler krijgt er geen kaart van — hij verschijnt alleen hier in de activity log.'
	};

	function effectTekst(p: PowerupTypeOption): string {
		if (HOST_GRANT_EFFECT[p.id]) return HOST_GRANT_EFFECT[p.id];
		if (p.immediate_use) return 'Gaat direct af zodra je toekent.';
		return 'Komt in de voorraad van het team en is meteen bruikbaar, net als een verdiende powerup.';
	}

	/**
	 * Eén afhandelaar voor alle vier de formulieren: een fout blijft in de sheet
	 * staan (de host kan hem corrigeren zonder alles opnieuw in te tikken), een
	 * succes sluit de sheet en geeft het bericht aan de pagina door.
	 */
	function verstuur() {
		bezig = true;
		foutmelding = '';
		return async ({
			result,
			update
		}: {
			result: ActionResult<{ message?: string }, { error?: string }>;
			update: () => Promise<void>;
		}) => {
			bezig = false;
			if (result.type === 'failure') {
				foutmelding = result.data?.error ?? 'Er ging iets mis.';
				return;
			}
			if (result.type === 'success') {
				await update();
				ondone(result.data?.message ?? 'Klaar.');
				return;
			}
			await update();
		};
	}

	function terug() {
		tool = null;
		foutmelding = '';
		bevestigPunten = false;
		bevestigReset = false;
	}

	const TOOLS: Array<{ id: Tool; icon: string; label: string; sub: string }> = [
		{ id: 'punten', icon: '±', label: 'Punten', sub: 'Optellen of aftrekken' },
		{ id: 'powerup', icon: '🎁', label: 'Powerup', sub: 'Toekennen aan dit team' },
		{ id: 'tijd', icon: '⏱', label: 'Extra tijd', sub: 'Op de lopende challenge' },
		{ id: 'reset', icon: '↺', label: 'Challenge terugzetten', sub: 'Opnieuw laten spelen' }
	];
</script>

<Modal title="Ingrijpen — {team.display_name}" {onclose}>
	<div class="max-h-[75vh] space-y-4 overflow-y-auto">
		<!-- Kop: welk team, welke score. Bij elke ingreep in beeld, zodat je nooit
		     op het verkeerde team zit te drukken. -->
		<div
			class="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5"
		>
			<span class="h-3 w-3 shrink-0 rounded-full" style="background-color: {teamColor}"></span>
			<span class="flex-1 text-sm font-semibold text-zinc-200">{team.display_name}</span>
			<span class="text-lg font-black text-white tabular-nums">{team.score}</span>
		</div>

		{#if foutmelding}
			<p class="rounded-xl border border-red-900 bg-red-950/60 px-3 py-2.5 text-sm text-red-300">
				{foutmelding}
			</p>
		{/if}

		{#if tool === null}
			<!-- Stap 1: welke ingreep. -->
			<div class="space-y-2">
				{#each TOOLS as t (t.id)}
					<button
						type="button"
						onclick={() => (tool = t.id)}
						class="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 text-left transition hover:border-zinc-600"
					>
						<span class="w-6 shrink-0 text-center text-lg">{t.icon}</span>
						<span class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-zinc-100">{t.label}</span>
							<span class="block text-xs text-zinc-500">{t.sub}</span>
						</span>
						<span class="shrink-0 text-zinc-600">›</span>
					</button>
				{/each}
			</div>
		{:else}
			<button
				type="button"
				onclick={terug}
				class="text-xs font-medium text-zinc-500 transition hover:text-zinc-300"
			>
				‹ Andere ingreep
			</button>
		{/if}

		<!-- ── 1. Punten ──────────────────────────────────────────────────────── -->
		{#if tool === 'punten'}
			<form
				method="POST"
				action="?/adjustScore"
				use:enhance={verstuur}
				class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
			>
				<input type="hidden" name="team_id" value={team.id} />
				<input type="hidden" name="set_id" value={setId ?? ''} />
				<input type="hidden" name="delta" value={delta} />

				<label class="block">
					<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Reden (verplicht)</span>
					<input
						name="reason"
						bind:value={redenPunten}
						required
						placeholder="Waarom krijgt dit team punten?"
						class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
					/>
				</label>

				<div>
					<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Aantal punten</span>
					<div class="mb-2 grid grid-cols-6 gap-1.5">
						{#each [-10, -5, -1, 1, 5, 10] as stap (stap)}
							<button
								type="button"
								onclick={() => {
									delta += stap;
									bevestigPunten = false;
								}}
								class="rounded-lg border border-zinc-700 bg-zinc-950 py-2.5 text-sm font-bold text-zinc-200 transition hover:border-zinc-500"
							>
								{stap > 0 ? '+' : ''}{stap}
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2">
						<input
							type="number"
							inputmode="numeric"
							bind:value={delta}
							oninput={() => (bevestigPunten = false)}
							class="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-center text-lg font-black text-white tabular-nums"
						/>
						<span class="text-sm text-zinc-500">
							{team.score} → <span class="font-bold text-zinc-200">{nieuweScore}</span>
							{#if wordtGeklemd}
								<span class="text-amber-400"> (geklemd op 0)</span>
							{/if}
						</span>
					</div>
				</div>

				{#if delta !== 0}
					{#if puntenIsOnomkeerbaar && !bevestigPunten}
						<button
							type="button"
							onclick={() => (bevestigPunten = true)}
							disabled={!redenPunten.trim()}
							class="w-full rounded-lg bg-zinc-800 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
						>
							Punten aftrekken…
						</button>
					{:else}
						<button
							type="submit"
							disabled={bezig || !redenPunten.trim()}
							class="w-full rounded-lg py-3 text-sm font-bold transition disabled:opacity-40 {delta <
							0
								? 'bg-red-900 text-red-100 hover:bg-red-800'
								: 'bg-green-700 text-white hover:bg-green-600'}"
						>
							{bezig
								? 'Bezig…'
								: delta < 0
									? `Ja, ${Math.abs(delta)} punten eraf (${team.score} → ${nieuweScore})`
									: `${delta} punten erbij (${team.score} → ${nieuweScore})`}
						</button>
					{/if}
				{/if}
			</form>
		{/if}

		<!-- ── 2. Powerup ─────────────────────────────────────────────────────── -->
		{#if tool === 'powerup'}
			{#if !setId}
				<p class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
					Geen actieve set — een powerup hoort altijd bij een set.
				</p>
			{:else}
				<form
					method="POST"
					action="?/grantPowerup"
					use:enhance={verstuur}
					class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
				>
					<input type="hidden" name="team_id" value={team.id} />
					<input type="hidden" name="set_id" value={setId} />

					<label class="block">
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Reden (verplicht)</span>
						<input
							name="reason"
							bind:value={redenPowerup}
							required
							placeholder="Waarom krijgt dit team een powerup?"
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
						/>
					</label>

					<label class="block">
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Powerup</span>
						<select
							name="powerup_type_id"
							bind:value={gekozenType}
							required
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
						>
							<option value="" disabled>Kies een powerup…</option>
							{#each powerupTypes as p (p.id)}
								<option value={p.id}>
									{p.icon ?? '•'}
									{p.name}{p.immediate_use ? ' — gaat direct af' : ''}
								</option>
							{/each}
						</select>
					</label>

					{#if gekozenPowerup}
						<p
							class="rounded-lg border px-3 py-2.5 text-xs leading-relaxed {gekozenPowerup.immediate_use
								? 'border-amber-800 bg-amber-950/50 text-amber-200'
								: 'border-zinc-700 bg-zinc-950 text-zinc-400'}"
						>
							{effectTekst(gekozenPowerup)}
						</p>
					{/if}

					<button
						type="submit"
						disabled={bezig || !gekozenType || !redenPowerup.trim()}
						class="w-full rounded-lg bg-green-700 py-3 text-sm font-bold text-white transition hover:bg-green-600 disabled:opacity-40"
					>
						{bezig ? 'Bezig…' : 'Toekennen'}
					</button>
				</form>
			{/if}
		{/if}

		<!-- ── 3. Extra tijd ──────────────────────────────────────────────────── -->
		{#if tool === 'tijd'}
			{#if !runningChallenge}
				<p class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
					Dit team is nu niet met een challenge bezig. Extra tijd kan alleen tijdens een lopende
					beurt — anders zou de tijd pas gaan werken op het moment dat ze straks starten.
				</p>
			{:else}
				<form
					method="POST"
					action="?/grantExtraTime"
					use:enhance={verstuur}
					class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4"
				>
					<input type="hidden" name="team_id" value={team.id} />
					<input type="hidden" name="set_id" value={setId ?? ''} />
					<input type="hidden" name="challenge_id" value={runningChallenge.id} />
					<input type="hidden" name="seconds" value={seconden} />

					<p class="text-xs text-zinc-500">
						Lopende challenge: <span class="font-semibold text-zinc-300"
							>{runningChallenge.title}</span
						>
					</p>

					<label class="block">
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Reden (verplicht)</span>
						<input
							name="reason"
							bind:value={redenTijd}
							required
							placeholder="Waarom krijgt dit team extra tijd?"
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
						/>
					</label>

					<div>
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Seconden</span>
						<div class="mb-2 grid grid-cols-4 gap-1.5">
							{#each [30, 60, 120, 300] as s (s)}
								<button
									type="button"
									onclick={() => (seconden = s)}
									class="rounded-lg border py-2.5 text-sm font-bold transition {seconden === s
										? 'border-blue-500 bg-blue-950 text-blue-200'
										: 'border-zinc-700 bg-zinc-950 text-zinc-200 hover:border-zinc-500'}"
								>
									+{s}s
								</button>
							{/each}
						</div>
						<input
							type="number"
							inputmode="numeric"
							min="5"
							max="600"
							bind:value={seconden}
							class="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-center text-lg font-black text-white tabular-nums"
						/>
					</div>

					<button
						type="submit"
						disabled={bezig || !redenTijd.trim()}
						class="w-full rounded-lg bg-blue-700 py-3 text-sm font-bold text-white transition hover:bg-blue-600 disabled:opacity-40"
					>
						{bezig ? 'Bezig…' : `+${seconden}s geven`}
					</button>
				</form>
			{/if}
		{/if}

		<!-- ── 4. Challenge terugzetten ───────────────────────────────────────── -->
		{#if tool === 'reset'}
			{#if resettableChallenges.length === 0}
				<p class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
					Dit team heeft nog geen challenge gespeeld — er is niets terug te zetten.
				</p>
			{:else}
				<form
					method="POST"
					action="?/resetTeamAttempt"
					use:enhance={verstuur}
					class="space-y-3 rounded-xl border border-red-950 bg-zinc-900 p-4"
				>
					<input type="hidden" name="team_id" value={team.id} />
					<input type="hidden" name="set_id" value={setId ?? ''} />

					<label class="block">
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Reden (verplicht)</span>
						<input
							name="reason"
							bind:value={redenReset}
							required
							placeholder="Waarom mag dit team opnieuw?"
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
						/>
					</label>

					<label class="block">
						<span class="mb-1.5 block text-xs font-semibold text-zinc-400">Welke challenge</span>
						<select
							name="challenge_id"
							bind:value={gekozenReset}
							required
							onchange={() => (bevestigReset = false)}
							class="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
						>
							<option value="" disabled>Kies een challenge…</option>
							{#each resettableChallenges as c (c.id)}
								<option value={c.id}>{c.title}</option>
							{/each}
						</select>
					</label>

					<!-- Wat er wel en niet gebeurt. Staat er voluit, want dit is de ingreep
					     waarvan de host achteraf moet kunnen uitleggen wat hij deed. -->
					<div
						class="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-xs leading-relaxed"
					>
						<p class="mb-1 font-semibold text-zinc-300">Wordt teruggedraaid</p>
						<p class="mb-2 text-zinc-500">
							De inlevering en de beurt van <span class="text-zinc-300">{team.display_name}</span> op
							deze challenge, de punten die eruit kwamen, en powerups uit deze challenge die ze nog niet
							gebruikt hebben.
						</p>
						<p class="mb-1 font-semibold text-zinc-300">Blijft staan</p>
						<p class="text-zinc-500">
							Al gebruikte powerups en hun effecten, punten die een powerup rechtstreeks op de score
							zette, en de streak. Andere teams en andere challenges worden niet aangeraakt.
						</p>
					</div>

					{#if gekozenReset}
						{#if !bevestigReset}
							<button
								type="button"
								onclick={() => (bevestigReset = true)}
								disabled={!redenReset.trim()}
								class="w-full rounded-lg bg-zinc-800 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
							>
								Challenge terugzetten…
							</button>
						{:else}
							<button
								type="submit"
								disabled={bezig}
								class="w-full rounded-lg bg-red-900 py-3 text-sm font-bold text-red-100 transition hover:bg-red-800 disabled:opacity-40"
							>
								{bezig
									? 'Bezig…'
									: `Ja, ${resetDoel?.title ?? 'deze challenge'} terugzetten voor ${team.display_name}`}
							</button>
						{/if}
					{/if}
				</form>
			{/if}
		{/if}
	</div>
</Modal>
