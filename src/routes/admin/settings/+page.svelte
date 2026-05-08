<script lang="ts">
	import { themeStore, type ThemeName } from '$lib/stores/theme.svelte';
	import { onMount } from 'svelte';

	onMount(() => themeStore.init());

	let toastVisible = $state(false);
	let toastTimeout: ReturnType<typeof setTimeout>;

	function apply(name: ThemeName) {
		themeStore.set(name);
		clearTimeout(toastTimeout);
		toastVisible = true;
		toastTimeout = setTimeout(() => (toastVisible = false), 2000);
	}

	const themes: { name: ThemeName; label: string; description: string; preview: string }[] = [
		{
			name: 'tactical',
			label: 'Tactical Console',
			description: 'Clean angular UI, dot-grid background, clipped tile corners.',
			preview: 'bg-[#050810] border-[rgba(55,75,130,0.6)]'
		},
		{
			name: 'led_stage',
			label: 'LED Stage Wall',
			description: 'Shifting UV/ice gradient mesh with neon-pulsing tile borders.',
			preview: 'bg-[#030008] border-[rgba(80,50,220,0.6)]'
		},
		{
			name: 'sound_reactive',
			label: 'Sound Reactive',
			description: 'Animated EQ bars at the bottom, green beats on every tile.',
			preview: 'bg-[#060a10] border-[rgba(0,220,100,0.4)]'
		},
		{
			name: 'max_defqon',
			label: 'Maximum Defqon',
			description: 'Rotating UV gradient, laser sweep, particles, maximum glow.',
			preview: 'bg-[#0a0018] border-[rgba(160,60,255,0.6)]'
		},
		{
			name: 'mainstage',
			label: 'Mainstage',
			description: 'Festival stage depth — truss, light cones, smoke haze, particles.',
			preview: 'bg-[#0a0e1a] border-[rgba(60,80,140,0.5)]'
		},
		{
			name: 'showtime',
			label: 'Showtime',
			description: 'Illustrated stage backdrop with cycling LED glow, flames, confetti.',
			preview: 'bg-[#0a0a0a] border-[rgba(220,38,38,0.5)]'
		}
	];
</script>

<div class="p-6">
	<h1 class="mb-1 text-2xl font-bold text-white">Settings</h1>
	<p class="mb-8 text-sm text-zinc-400">Host admin preferences.</p>

	<!-- Theme picker -->
	<section>
		<h2 class="mb-1 text-sm font-semibold text-zinc-300">Dashboard theme</h2>
		<p class="mb-4 text-xs text-zinc-500">
			Applies to the host dashboard only. Other admin pages stay neutral.
		</p>

		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3">
			{#each themes as theme}
				<button
					type="button"
					onclick={() => apply(theme.name)}
					class="group relative rounded-xl border-2 p-0 text-left transition-all focus:outline-none
						{themeStore.current === theme.name
							? 'border-amber-400 ring-2 ring-amber-400/30'
							: 'border-zinc-700 hover:border-zinc-500'}"
				>
					<!-- Mini preview -->
					<div class="relative h-32 overflow-hidden rounded-t-lg border {theme.preview}">
						<!-- Mock tile -->
						<div class="absolute inset-x-3 top-3 rounded-lg border p-2 {theme.preview}">
							<div class="mb-1 flex items-center gap-2">
								<span class="text-base">🎮</span>
								<span
									class="text-lg font-black
										{theme.name === 'sound_reactive' ? 'text-[#00ee88]' : ''}
										{theme.name === 'led_stage' ? 'text-[#90b8ff]' : ''}
										{theme.name === 'max_defqon'
										? 'bg-gradient-to-r from-fuchsia-400 to-blue-400 bg-clip-text text-transparent'
										: ''}
										{theme.name === 'tactical' ? 'text-[#8ab4f8]' : ''}"
								>12</span>
							</div>
							<div class="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
								Sets
							</div>
						</div>

						<!-- EQ bars hint for sound_reactive -->
						{#if theme.name === 'sound_reactive'}
							<div
								class="absolute bottom-0 left-0 right-0 flex h-10 items-end gap-px px-1 opacity-50"
							>
								{#each Array.from({ length: 20 }, (_, i) => i) as i}
									<div
										class="flex-1 rounded-t bg-gradient-to-t from-[#00dd77] to-[#00aaff]"
										style="height: {12 + (i % 5) * 16}%"
									></div>
								{/each}
							</div>
						{:else if theme.name === 'mainstage'}
							<svg class="absolute inset-0 h-full w-full" viewBox="0 0 200 128" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
								<defs>
									<linearGradient id="ms-cone" x1="0" y1="0" x2="0" y2="1">
										<stop offset="0%" stop-color="rgba(255,255,255,0.2)"/>
										<stop offset="100%" stop-color="rgba(255,255,255,0)"/>
									</linearGradient>
								</defs>
								<polygon points="60,18 44,100 76,100" fill="url(#ms-cone)"/>
								<polygon points="100,18 80,110 120,110" fill="url(#ms-cone)" opacity="0.7"/>
								<polygon points="140,18 124,100 156,100" fill="url(#ms-cone)"/>
								<rect x="10" y="14" width="180" height="6" fill="#2a2a2a" rx="1"/>
								<rect x="10" y="14" width="4" height="60" fill="#2a2a2a"/>
								<rect x="186" y="14" width="4" height="60" fill="#2a2a2a"/>
								<ellipse cx="60" cy="22" rx="4" ry="3" fill="#1e1e1e" stroke="#3a3a3a" stroke-width="0.5"/>
								<ellipse cx="100" cy="22" rx="4" ry="3" fill="#1e1e1e" stroke="#3a3a3a" stroke-width="0.5"/>
								<ellipse cx="140" cy="22" rx="4" ry="3" fill="#1e1e1e" stroke="#3a3a3a" stroke-width="0.5"/>
								<ellipse cx="60" cy="22" rx="2" ry="1.5" fill="#dc2626" opacity="0.8"/>
								<ellipse cx="100" cy="22" rx="2" ry="1.5" fill="#dc2626" opacity="0.8"/>
								<ellipse cx="140" cy="22" rx="2" ry="1.5" fill="#dc2626" opacity="0.8"/>
							</svg>
						{:else if theme.name === 'showtime'}
							<svg class="absolute inset-0 h-full w-full" viewBox="0 0 200 128" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
								<rect x="50" y="20" width="100" height="70" fill="#0a0a0a" rx="2"/>
								<rect x="50" y="20" width="100" height="70" fill="none" stroke="#dc2626" stroke-width="1.5" rx="2" style="filter:drop-shadow(0 0 4px #dc2626)"/>
								<rect x="54" y="24" width="92" height="62" fill="rgba(20,4,4,0.8)" rx="1"/>
								<rect x="30" y="14" width="140" height="5" fill="#2a2a2a" rx="1"/>
								<rect x="30" y="14" width="4" height="90" fill="#2a2a2a"/>
								<rect x="166" y="14" width="4" height="90" fill="#2a2a2a"/>
								<rect x="8" y="40" width="18" height="60" fill="#1a1a1a" rx="2" stroke="#2a2a2a" stroke-width="0.5"/>
								<rect x="174" y="40" width="18" height="60" fill="#1a1a1a" rx="2" stroke="#2a2a2a" stroke-width="0.5"/>
								<rect x="70" y="100" width="60" height="20" fill="#111" rx="2"/>
								<text x="100" y="60" text-anchor="middle" font-size="10" font-weight="bold" fill="#dc2626" opacity="0.8" style="font-family:monospace">MIXUP!</text>
							</svg>
						{/if}
					</div>

					<!-- Info -->
					<div class="p-3">
						<div class="flex items-center justify-between">
							<span class="text-sm font-semibold text-zinc-200">{theme.label}</span>
							{#if themeStore.current === theme.name}
								<span
									class="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400"
								>
									Active
								</span>
							{/if}
						</div>
						<p class="mt-0.5 text-xs text-zinc-500">{theme.description}</p>
					</div>
				</button>
			{/each}
		</div>
	</section>
</div>

<!-- Toast -->
{#if toastVisible}
	<div
		class="fixed bottom-6 right-6 z-50 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-200 shadow-2xl"
	>
		Theme applied ✓
	</div>
{/if}
