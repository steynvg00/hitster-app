<script lang="ts">
	/**
	 * Dev-only showcase van het M!XUP redesign-fundament (fase 1).
	 * Toont de tokens, de fonts, de squircle-radii, de glaskaart en de
	 * draaiende code-regen. Raakt geen speler-routes aan.
	 */
	import CodeRain from '$lib/components/CodeRain.svelte';
	import GlassCard from '$lib/components/ui/GlassCard.svelte';
	import { CHALLENGE_LOGOS, ICON_ASSETS, MIXUP_LOGO, RANK_ASSETS } from '$lib/mixup-assets';

	const PALETTE = [
		{ name: 'Ink', token: 'mixup-ink', hex: '#0B0B1F', use: 'Basis-achtergrond' },
		{
			name: 'Deep violet',
			token: 'mixup-deep-violet',
			hex: '#221546',
			use: 'Radiale gradient-top'
		},
		{ name: 'Paper', token: 'mixup-paper', hex: '#E5F2FF', use: 'Primaire tekst' },
		{ name: 'Muted', token: 'mixup-muted', hex: '#8E9BC9', use: 'Secundaire tekst' },
		{ name: 'Cyan', token: 'mixup-cyan', hex: '#00E5FF', use: 'Actief / focus / live' },
		{ name: 'Violet', token: 'mixup-violet', hex: '#7C4DFF', use: 'Glow, accentverloop' },
		{ name: 'Magenta', token: 'mixup-magenta', hex: '#FF2DAA', use: 'Urgentie, aanval' },
		{ name: 'Yellow', token: 'mixup-yellow', hex: '#FFE600', use: 'Score, powerups' },
		{ name: 'Green', token: 'mixup-green', hex: '#2BD97A', use: 'Compleet / bevestigd' },
		{ name: 'Amber', token: 'mixup-amber', hex: '#FFC24B', use: 'Twijfel / half' }
	];

	const TEAMS = [
		{ name: 'Blauw', token: 'team-blue', hex: '#2E7BFF' },
		{ name: 'Geel', token: 'team-yellow', hex: '#FFE600' },
		{ name: 'Groen', token: 'team-green', hex: '#2BD97A' },
		{ name: 'Rood', token: 'team-red', hex: '#FF3B4A' },
		{ name: 'Indigo', token: 'team-indigo', hex: '#7C4DFF' },
		{ name: 'Zwart', token: 'team-black', hex: '#171A2B', glow: true }
	];

	const RADII = [
		{ label: 'xs · 12', cls: 'rounded-mixup-xs' },
		{ label: 'chip · 14', cls: 'rounded-mixup-chip' },
		{ label: 'sm · 16', cls: 'rounded-mixup-sm' },
		{ label: 'card · 20', cls: 'rounded-mixup-card' },
		{ label: 'lg · 22', cls: 'rounded-mixup-lg' },
		{ label: 'modal · 26', cls: 'rounded-mixup-modal' },
		{ label: 'hero · 28', cls: 'rounded-mixup-hero' }
	];

	const ASSETS = [
		{ src: MIXUP_LOGO, label: 'mixup_spin_clean.png' },
		{ src: RANK_ASSETS.crown, label: 'Kroon-v1.2.png' },
		{ src: RANK_ASSETS.silver, label: 'rank2_silver' },
		{ src: RANK_ASSETS.bronze, label: 'rank3_bronze' },
		{ src: RANK_ASSETS.dark, label: 'rank4plus_dark' },
		{ src: ICON_ASSETS.camera, label: 'icon_camera' },
		{ src: ICON_ASSETS.lock, label: 'icon_lock' },
		{ src: ICON_ASSETS.dice, label: 'icon-dobbelsteen' },
		{ src: ICON_ASSETS.headphones, label: 'koptelefoon' },
		{ src: ICON_ASSETS.finishFlag, label: 'finish-flag' }
	];

	let rainLayers = $state<2 | 3>(3);
</script>

<svelte:head><title>M!XUP · design-fundament (dev)</title></svelte:head>

<div class="relative min-h-screen overflow-hidden mixup-page">
	<CodeRain layers={rainLayers} />

	<div class="relative z-10 mx-auto flex max-w-5xl flex-col gap-12 px-6 py-14">
		<header class="flex flex-col gap-3">
			<span class="mixup-eyebrow">Redesign · fase 1 · fundament</span>
			<h1
				class="font-display text-6xl leading-[0.9] font-black text-mixup-paper uppercase sm:text-7xl"
			>
				Design-fundament
			</h1>
			<p class="max-w-2xl font-ui text-base leading-relaxed text-mixup-muted">
				Dev-only showcase. Tokens uit <code class="font-data text-mixup-cyan"
					>src/routes/layout.css</code
				>, code-regen uit
				<code class="font-data text-mixup-cyan">CodeRain.svelte</code>, glaskaart uit
				<code class="font-data text-mixup-cyan">GlassCard.svelte</code>.
			</p>
		</header>

		<!-- Kernpalet -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">1 · Kernpalet</span>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each PALETTE as c (c.token)}
					<GlassCard class="flex items-center gap-3 p-3.5">
						<div
							class="h-10 w-10 shrink-0 rounded-mixup-xs border border-[rgba(229,242,255,0.25)] squircle"
							style="background: var(--color-{c.token});"
						></div>
						<div class="flex flex-col gap-0.5">
							<span class="font-ui text-xs font-extrabold tracking-mixup-tight text-mixup-paper"
								>{c.name}</span
							>
							<span class="font-data text-[11px] text-mixup-muted">{c.hex}</span>
							<span class="font-ui text-[11px] font-medium text-mixup-dim">{c.use}</span>
						</div>
					</GlassCard>
				{/each}
			</div>
		</section>

		<!-- Teamkleuren -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">2 · Teamkleuren</span>
			<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
				{#each TEAMS as t (t.token)}
					<GlassCard class="flex flex-col items-center gap-2 p-4">
						<span
							class="h-12 w-12 rounded-full border border-[rgba(229,242,255,0.5)]"
							style="background: var(--color-{t.token}); box-shadow: 0 0 14px {t.glow
								? 'var(--color-team-black-glow)'
								: `var(--color-${t.token})`};"
						></span>
						<span class="font-ui text-xs font-extrabold text-mixup-paper uppercase">{t.name}</span>
						<span class="font-data text-[10px] text-mixup-muted">{t.hex}</span>
						{#if t.glow}
							<span class="text-center font-ui text-[10px] leading-tight text-mixup-dim"
								>witte glow<br />i.p.v. eigen kleur</span
							>
						{/if}
					</GlassCard>
				{/each}
			</div>
		</section>

		<!-- Typografie -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">3 · Typografie</span>
			<GlassCard radius="lg" class="flex flex-col gap-5 p-6">
				<div class="flex flex-col gap-1">
					<span class="font-data text-[10px] tracking-mixup-eyebrow text-mixup-dim"
						>FONT-DISPLAY · BARLOW CONDENSED 900</span
					>
					<span class="font-display text-5xl leading-[0.92] font-black text-mixup-paper uppercase"
						>De stand wordt onthuld</span
					>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-data text-[10px] tracking-mixup-eyebrow text-mixup-dim"
						>FONT-UI · RUBIK 500 / 700 / 800</span
					>
					<span class="font-ui text-base font-medium text-mixup-soft"
						>Scan het challenge board om verder te spelen.</span
					>
					<span
						class="font-ui text-base font-extrabold tracking-mixup-tight text-mixup-paper uppercase"
						>Naar je team</span
					>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-data text-[10px] tracking-mixup-eyebrow text-mixup-dim"
						>FONT-DATA · JETBRAINS MONO · TRACKING 0.14–0.22EM</span
					>
					<span class="font-data text-[11px] tracking-mixup-wide text-mixup-cyan"
						>POWERUPS · CHALLENGES · LIVE</span
					>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-data text-[10px] tracking-mixup-eyebrow text-mixup-dim"
						>M!XUP-GRADIENT · CYAAN → VIOLET → MAGENTA</span
					>
					<span class="mixup-gradient-text font-display text-5xl leading-none font-black uppercase"
						>M!XUP</span
					>
					<span class="mt-2 h-2.5 w-full rounded-mixup-chip mixup-gradient squircle"></span>
				</div>
			</GlassCard>
		</section>

		<!-- Glas + radii -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">4 · Glaskaart &amp; squircle-radii</span>
			<div class="grid gap-3 md:grid-cols-3">
				<GlassCard border="soft" class="flex flex-col gap-1.5 p-5">
					<span class="font-data text-[10px] tracking-mixup-label text-mixup-cyan">SOFT · 0.12</span
					>
					<span class="font-ui text-sm text-mixup-soft">Rijen, lijsten, rustige blokken.</span>
				</GlassCard>
				<GlassCard class="flex flex-col gap-1.5 p-5">
					<span class="font-data text-[10px] tracking-mixup-label text-mixup-cyan"
						>DEFAULT · 0.14</span
					>
					<span class="font-ui text-sm text-mixup-soft">De standaard glaskaart.</span>
				</GlassCard>
				<GlassCard border="strong" radius="modal" class="flex flex-col gap-1.5 p-5">
					<span class="font-data text-[10px] tracking-mixup-label text-mixup-cyan"
						>STRONG · 0.22</span
					>
					<span class="font-ui text-sm text-mixup-soft">Modals en hero-kaarten.</span>
				</GlassCard>
			</div>
			<div class="flex flex-wrap gap-3">
				{#each RADII as r (r.cls)}
					<div
						class="mixup-glass squircle {r.cls} flex h-20 w-28 items-center justify-center border-[rgba(0,229,255,0.35)]"
					>
						<span class="font-data text-[10px] text-mixup-muted">{r.label}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Code-regen -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">5 · Code-regen</span>
			<div class="flex flex-wrap items-center gap-3">
				{#each [3, 2] as n (n)}
					<button
						type="button"
						class="cursor-pointer rounded-mixup-chip px-4 py-2 font-data text-[11px] tracking-mixup-label transition-colors squircle"
						class:bg-mixup-cyan={rainLayers === n}
						class:text-mixup-ink={rainLayers === n}
						class:mixup-glass={rainLayers !== n}
						class:text-mixup-muted={rainLayers !== n}
						onclick={() => (rainLayers = n as 2 | 3)}
					>
						{n} LAGEN
					</button>
				{/each}
				<span class="font-ui text-xs text-mixup-muted"
					>Wisselt de achtergrond van deze pagina — de regen mag nooit statisch zijn.</span
				>
			</div>
			<div
				class="relative h-56 overflow-hidden rounded-mixup-lg border border-[rgba(229,242,255,0.16)] squircle"
				style="background: var(--gradient-mixup-page);"
			>
				<CodeRain />
				<div class="relative z-10 flex h-full items-center justify-center">
					<img src={MIXUP_LOGO} alt="M!XUP" class="h-28 w-auto" />
				</div>
			</div>
		</section>

		<!-- Assets -->
		<section class="flex flex-col gap-4">
			<span class="mixup-eyebrow text-mixup-yellow">6 · Assets in static/uploads/</span>
			<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
				{#each ASSETS as a (a.label)}
					<GlassCard class="flex flex-col items-center gap-2 p-3">
						<img src={a.src} alt={a.label} class="h-14 w-auto object-contain" />
						<span class="text-center font-data text-[10px] break-all text-mixup-muted"
							>{a.label}</span
						>
					</GlassCard>
				{/each}
			</div>
			<div class="flex flex-wrap items-end gap-5">
				{#each Object.entries(CHALLENGE_LOGOS) as [key, logo] (key)}
					<div class="flex flex-col gap-1.5">
						<img src={logo.src} alt={key} style="height: {logo.height}px; max-width: 150px;" />
						<span class="font-data text-[10px] text-mixup-dim">{key} · {logo.height}px</span>
					</div>
				{/each}
			</div>
		</section>
	</div>
</div>
