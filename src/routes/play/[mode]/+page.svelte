<script lang="ts">
	/**
	 * 1D · ONBOARDING (redesign fase 2) — mobiel, referentie 390x844.
	 *
	 * Twee states uit de designbron:
	 *  (a) gameset-logo ingesteld → logo 200px bovenaan, spinlogo vult de rest
	 *  (b) default → alleen het M!XUP-spinlogo
	 * Camera/galerij verschijnen pas NA een tik op de fotocirkel.
	 *
	 * De formulier- en uploadlogica is ongewijzigd: zelfde POST-action, zelfde
	 * enhance-injectie van het bestand, zelfde velden (name, photo, next).
	 */
	import { enhance } from '$app/forms';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { MIXUP_LOGO } from '$lib/mixup-assets';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Het naamveld is two-way gebonden aan lokale state. Met `value={form?.name}`
	// stond de DOM-waarde onder controle van het gedeelde template-effect van dit
	// fragment; elke tik op de fotocirkel liet dat effect opnieuw lopen en schreef
	// '' over de al ingetypte naam. De binding maakt de state de bron van waarheid,
	// dus de naam overleeft het opnieuw tekenen van de fotosectie.
	// svelte-ignore state_referenced_locally -- de beginwaarde is precies wat we willen:
	// na een mislukte POST vult de server de naam voor, daarna is het veld van de speler.
	let playerName = $state(form?.name ?? '');

	let photoOpen = $state(false);
	let photoPreviewUrl = $state<string | null>(null);
	let photoFile = $state<File | null>(null);
	let submitting = $state(false);

	const isTeams = $derived(data.mode === 'teams');
	const hasPhoto = $derived(photoPreviewUrl !== null);
	const photoHint = $derived(
		hasPhoto
			? 'FOTO TOEGEVOEGD · TIK OM TE WIJZIGEN'
			: photoOpen
				? 'KIES EEN BRON'
				: 'TIK VOOR EEN PROFIELFOTO'
	);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
		photoFile = file;
		photoPreviewUrl = URL.createObjectURL(file);
		photoOpen = false;
	}
</script>

<svelte:head>
	<title>{isTeams ? 'Doe mee' : 'Solo spelen'} — M!XUP</title>
</svelte:head>

<!--
	zelfde aanpak als de team-reveal-fix: vaste 100dvh om de PlayerScreen heen,
	zodat dit scherm nooit scrolt terwijl er niets te scrollen valt. dvh volgt
	de iOS-adresbalk; svh/vh niet.
-->
<div class="onb-viewport">
	<PlayerScreen rain corners={0.4} class="px-5">
		{#if data.gamesetLogo}
			<!-- State (a): gameset-logo bovenaan -->
			<img
				src={data.gamesetLogo}
				alt="Gameset"
				class="mt-3 w-[200px] self-center object-contain"
				style="mix-blend-mode: screen;"
			/>
		{/if}

		<div
			class="flex min-h-0 flex-1 shrink items-center justify-center"
			class:pt-5={!data.gamesetLogo}
		>
			<img
				src={MIXUP_LOGO}
				alt="M!XUP"
				class="max-h-full w-full object-contain"
				style="filter: drop-shadow(0 0 40px rgba(124, 77, 255, 0.65));"
			/>
		</div>

		{#if form?.error}
			<div
				class="mb-3 rounded-mixup-sm border border-[rgba(255,59,74,0.5)] bg-[rgba(255,59,74,0.12)] px-4 py-3 text-sm text-[#FF6FC4] squircle"
			>
				{form.error}
			</div>
		{/if}

		<form
			method="POST"
			enctype="multipart/form-data"
			use:enhance={({ formData }) => {
				formData.set('name', playerName);
				if (photoFile) formData.set('photo', photoFile, photoFile.name);
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
		>
			{#if data.next}
				<input type="hidden" name="next" value={data.next} />
			{/if}

			<!-- Glaskaart met fotocirkel + naamveld -->
			<div class="onb-card mb-[18px] rounded-mixup-hero squircle">
				<button
					type="button"
					class="onb-photo"
					class:onb-photo--filled={hasPhoto}
					onclick={() => (photoOpen = !photoOpen)}
					aria-label="Profielfoto toevoegen"
				>
					{#if photoPreviewUrl}
						<img src={photoPreviewUrl} alt="" class="h-full w-full rounded-full object-cover" />
					{:else}
						+
					{/if}
				</button>

				<div class="text-[11px] font-bold tracking-[0.12em] text-mixup-muted">{photoHint}</div>

				{#if photoOpen}
					<div class="onb-sources flex w-full gap-2">
						<label class="onb-source rounded-mixup-chip squircle">
							📷 CAMERA
							<input
								type="file"
								accept="image/*"
								capture="user"
								class="sr-only"
								onchange={handleFileChange}
							/>
						</label>
						<label class="onb-source rounded-mixup-chip squircle">
							🖼 GALERIJ
							<input type="file" accept="image/*" class="sr-only" onchange={handleFileChange} />
						</label>
					</div>
				{/if}

				<input
					name="name"
					type="text"
					bind:value={playerName}
					required
					minlength="2"
					maxlength="30"
					placeholder="Typ je naam…"
					autocomplete="given-name"
					class="onb-name rounded-mixup-sm squircle"
				/>
			</div>

			<button type="submit" disabled={submitting} class="onb-submit squircle">
				{submitting ? 'BEZIG…' : 'VERDER'}
			</button>
		</form>

		<div class="mt-3 text-center text-xs font-medium text-mixup-dim">
			Geen account nodig · je sessie blijft 12 uur geldig
		</div>
	</PlayerScreen>
</div>

<style>
	/* Viewport-vast, net als .randomizer op de reveal-pagina: dvh volgt de
	   iOS-adresbalk, dus geen restscroll als die in- of uitklapt.
	   PlayerScreen zelf houdt zijn min-height: 100svh. */
	.onb-viewport :global(.player-screen) {
		height: 100dvh;
		min-height: 100dvh;
		max-height: 100dvh;
	}

	.onb-card {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.22);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}

	.onb-photo {
		width: 96px;
		height: 96px;
		border-radius: 50%;
		cursor: pointer;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 34px;
		overflow: hidden;
		background: rgba(11, 11, 31, 0.5);
		color: var(--color-mixup-muted);
		border: 2px dashed rgba(229, 242, 255, 0.35);
	}

	.onb-photo--filled {
		background: linear-gradient(135deg, #7c4dff, #ff2daa);
		color: #ffffff;
		border: 2px solid rgba(229, 242, 255, 0.7);
	}

	.onb-sources {
		animation: onb-fade-up 0.28s ease both;
	}

	@keyframes onb-fade-up {
		0% {
			transform: translateY(18px);
			opacity: 0;
		}
		100% {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.onb-source {
		flex: 1;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		letter-spacing: 0.08em;
		cursor: pointer;
		background: rgba(229, 242, 255, 0.06);
		color: #9fb1d9;
		border: 1px solid rgba(229, 242, 255, 0.2);
	}

	.onb-name {
		width: 100%;
		box-sizing: border-box;
		background: rgba(11, 11, 31, 0.62);
		border: 1px solid rgba(229, 242, 255, 0.22);
		padding: 14px;
		color: var(--color-mixup-paper);
		font-family: var(--font-ui);
		font-weight: 500;
		/* 16px voorkomt de auto-zoom van iOS Safari bij focus. */
		font-size: 16px;
		outline: none;
	}

	.onb-name:focus {
		border-color: var(--color-mixup-cyan);
	}

	.onb-submit {
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
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		box-shadow: 0 10px 30px rgba(255, 127, 17, 0.35);
	}

	.onb-submit:disabled {
		opacity: 0.6;
	}
</style>
