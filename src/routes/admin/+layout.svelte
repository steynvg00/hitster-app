<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let { children, data } = $props();

	const nav = [
		{ href: '/admin', label: 'Dashboard', icon: '🏠', exact: true },
		{ href: '/admin/sets', label: 'Sets', icon: '🎮' },
		{ href: '/admin/challenges', label: 'Challenges', icon: '🎯' },
		{ href: '/admin/tracks', label: 'Tracks', icon: '🎵' },
		{ href: '/admin/nfc-tags', label: 'NFC Tags', icon: '📲' },
		{ href: '/admin/teams', label: 'Teams', icon: '👥' },
		{ href: '/admin/pools', label: 'Pools', icon: '🗂️' },
		{ href: '/admin/review', label: 'Review', icon: '🔍' },
		{ href: '/admin/variant-defaults', label: 'Defaults', icon: '⚙️' },
		{ href: '/admin/live', label: 'Game status', icon: '📡' }
	];

	const superAdminNav = [{ href: '/admin/whitelist', label: 'Whitelist', icon: '🔐' }];

	function isActive(item: { href: string; exact?: boolean }) {
		return item.exact
			? $page.url.pathname === item.href
			: $page.url.pathname.startsWith(item.href);
	}

	const isLogin = $derived(
		$page.url.pathname === '/admin/login' ||
			$page.url.pathname.startsWith('/admin/access-denied')
	);

	let collapsed = $state(false);
	let mobileOpen = $state(false);

	onMount(() => {
		collapsed = localStorage.getItem('admin_sidebar_collapsed') === 'true';
	});

	function toggleSidebar() {
		collapsed = !collapsed;
		localStorage.setItem('admin_sidebar_collapsed', String(collapsed));
	}

	function openMobile() { mobileOpen = true; }
	function closeMobile() { mobileOpen = false; }
</script>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-zinc-950">
		<!-- ── Desktop sidebar (lg+) ── -->
		<aside
			class="hidden lg:flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-200 {collapsed
				? 'w-14'
				: 'w-56'}"
		>
			<!-- Header -->
			<div
				class="flex items-center border-b border-zinc-800 {collapsed
					? 'justify-center px-0 py-[1.125rem]'
					: 'justify-between p-4'}"
			>
				{#if !collapsed}
					<div class="min-w-0">
						<div class="text-lg font-black tracking-tight text-amber-400">MixUp!</div>
						<div class="mt-0.5 text-xs uppercase tracking-widest text-zinc-500">Host Admin</div>
					</div>
				{/if}
				<button
					onclick={toggleSidebar}
					title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					class="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
				>
					<svg
						class="h-4 w-4 transition-transform duration-200 {collapsed ? 'rotate-180' : ''}"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M15 18l-6-6 6-6" />
					</svg>
				</button>
			</div>

			<!-- Nav -->
			<nav class="flex-1 space-y-1 p-2">
				{#each nav as item}
					<a
						href={item.href}
						title={collapsed ? item.label : ''}
						class="flex items-center rounded-lg py-2.5 text-sm transition-colors
							{collapsed ? 'justify-center px-2' : 'gap-3 px-3'}
							{isActive(item)
							? 'bg-amber-400/15 font-medium text-amber-300'
							: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
					>
						<span class="shrink-0 text-base">{item.icon}</span>
						{#if !collapsed}
							<span class="whitespace-nowrap">{item.label}</span>
						{/if}
					</a>
				{/each}
				{#if data.isSuperAdmin}
					{#each superAdminNav as item}
						<a
							href={item.href}
							title={collapsed ? item.label : ''}
							class="flex items-center rounded-lg py-2.5 text-sm transition-colors
								{collapsed ? 'justify-center px-2' : 'gap-3 px-3'}
								{isActive(item)
								? 'bg-amber-400/15 font-medium text-amber-300'
								: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
						>
							<span class="shrink-0 text-base">{item.icon}</span>
							{#if !collapsed}
								<span class="whitespace-nowrap">{item.label}</span>
							{/if}
						</a>
					{/each}
				{/if}
			</nav>

			<!-- Logout -->
			<div class="border-t border-zinc-800 p-2">
				<a
					href="/admin/logout"
					title={collapsed ? 'Logout' : ''}
					class="flex items-center rounded-lg py-2.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400
						{collapsed ? 'justify-center px-2' : 'gap-3 px-3'}"
				>
					<span class="shrink-0 text-base">🚪</span>
					{#if !collapsed}
						<span class="whitespace-nowrap">Logout</span>
					{/if}
				</a>
			</div>
		</aside>

		<!-- ── Mobile drawer overlay ── -->
		{#if mobileOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
			<div
				class="fixed inset-0 z-40 bg-black/60 lg:hidden"
				onclick={closeMobile}
			></div>
		{/if}

		<!-- ── Mobile drawer (slides in from left) ── -->
		<aside
			class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800 bg-zinc-900 transition-transform duration-200 lg:hidden
				{mobileOpen ? 'translate-x-0' : '-translate-x-full'}"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800 p-4">
				<div class="min-w-0">
					<div class="text-lg font-black tracking-tight text-amber-400">MixUp!</div>
					<div class="mt-0.5 text-xs uppercase tracking-widest text-zinc-500">Host Admin</div>
				</div>
				<button
					onclick={closeMobile}
					class="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
					aria-label="Close menu"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			</div>

			<!-- Nav -->
			<nav class="flex-1 space-y-1 p-2">
				{#each nav as item}
					<a
						href={item.href}
						onclick={closeMobile}
						class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors
							{isActive(item)
							? 'bg-amber-400/15 font-medium text-amber-300'
							: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
					>
						<span class="shrink-0 text-base">{item.icon}</span>
						<span class="whitespace-nowrap">{item.label}</span>
					</a>
				{/each}
				{#if data.isSuperAdmin}
					{#each superAdminNav as item}
						<a
							href={item.href}
							onclick={closeMobile}
							class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors
								{isActive(item)
								? 'bg-amber-400/15 font-medium text-amber-300'
								: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
						>
							<span class="shrink-0 text-base">{item.icon}</span>
							<span class="whitespace-nowrap">{item.label}</span>
						</a>
					{/each}
				{/if}
			</nav>

			<!-- Logout -->
			<div class="border-t border-zinc-800 p-2">
				<a
					href="/admin/logout"
					class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
				>
					<span class="shrink-0 text-base">🚪</span>
					<span class="whitespace-nowrap">Logout</span>
				</a>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 min-w-0 overflow-auto">
			<!-- Mobile top bar -->
			<div class="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-3 lg:hidden">
				<button
					onclick={openMobile}
					class="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
					aria-label="Open menu"
				>
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M3 12h18M3 6h18M3 18h18"/>
					</svg>
				</button>
				<div class="text-sm font-black tracking-tight text-amber-400">MixUp!</div>
			</div>
			{@render children()}
		</main>
	</div>
{/if}
