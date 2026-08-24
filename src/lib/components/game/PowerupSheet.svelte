<script lang="ts">
	/**
	 * Scherm 1 (tweede helft) — de bottom-sheet met de LEESBARE beschrijving.
	 *
	 * Het UX-gat uit de analyse: op touch bestaat `title=""` niet, dus een team
	 * kon nergens zien wat een powerup doet voordat het hem uitgaf. Een tik op
	 * een chip opent nu dit blad met naam, categorie, beschrijving en de
	 * waarschuwing; "GEBRUIK NU" opent daarna pas de activatiemodal.
	 *
	 * PUUR PRESENTATIE: dit blad activeert niets en post nergens naartoe. Het
	 * roept `onuse()` aan, en de aanroeper opent daarmee exact dezelfde
	 * PowerupActivationModal die de chip eerst direct opende.
	 *
	 * Designbron: M!XUP Powerup-Laag.dc.html, artboard "1 Inventaris"
	 * (sheetStyle / sheetImgStyle / sheetName / sheetType / sheetDesc / sheetWarn).
	 */
	import { powerupIcon } from '$lib/mixup-assets';
	import { categoryLabel, powerupDesc, powerupName, powerupWarn } from '$lib/powerups-copy';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
		category?: string | null;
	};

	let {
		type,
		count = 1,
		onclose,
		onuse
	}: {
		type: PowerupType;
		/** Hoeveel exemplaren het team van dit type heeft — staat achter de naam. */
		count?: number;
		onclose: () => void;
		onuse: () => void;
	} = $props();

	const name = $derived(powerupName(type.id, type.name));
	const desc = $derived(powerupDesc(type.id, type.description));
	const warn = $derived(powerupWarn(type.id));
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center">
	<!-- Scrim als knop: tik ernaast sluit het blad, en met de toetsenbord-focus
	     erop doet Enter/Space hetzelfde. -->
	<button
		type="button"
		class="absolute inset-0 mixup-scrim"
		aria-label="Sluit de beschrijving"
		onclick={onclose}
	></button>

	<div class="sheet mixup-panel squircle" role="dialog" aria-modal="true" aria-label={name}>
		<span class="grabber"></span>

		<div class="flex items-center gap-3.5">
			<img
				src={powerupIcon(type.id)}
				alt=""
				class="h-16 w-16 shrink-0 object-contain"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
			/>
			<div class="min-w-0">
				<div
					class="font-display text-[28px] leading-none font-black text-mixup-paper uppercase"
					style="overflow-wrap: anywhere;"
				>
					{name}{#if count > 1}<span class="text-mixup-yellow"> ×{count}</span>{/if}
				</div>
				<div class="mt-1 text-[10px] font-bold tracking-[0.14em] text-mixup-cyan">
					{categoryLabel(type.category)}
				</div>
			</div>
		</div>

		<p class="text-sm leading-[1.5] font-medium text-mixup-soft">{desc}</p>

		{#if warn}
			<div class="mixup-warn">
				<span class="text-[13px]">⚠️</span><span>{warn}</span>
			</div>
		{/if}

		<div class="flex gap-2.5">
			<button type="button" class="mixup-btn flex-1 mixup-btn-ghost" onclick={onclose}>Sluit</button
			>
			<button type="button" class="mixup-btn flex-[1.4] mixup-btn-primary" onclick={onuse}>
				Gebruik nu
			</button>
		</div>
	</div>
</div>

<style>
	.sheet {
		position: relative;
		width: 100%;
		max-width: 430px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		/* Designbron: 14px 18px 20px. De onderrand krijgt de safe-area erbij,
		   anders valt de knoppenrij achter de home-indicator. */
		padding: 14px 18px max(20px, calc(env(safe-area-inset-bottom, 0px) + 12px));
		border: 1px solid rgba(229, 242, 255, 0.25);
		border-radius: 26px 26px 0 0;
		box-shadow: 0 -14px 40px rgba(0, 0, 0, 0.5);
		animation: sheet-in 0.28s cubic-bezier(0.2, 0.8, 0.2, 1) both;
	}

	.grabber {
		align-self: center;
		width: 44px;
		height: 5px;
		border-radius: 99px;
		background: rgba(229, 242, 255, 0.25);
	}

	@keyframes sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: none;
		}
	}
</style>
