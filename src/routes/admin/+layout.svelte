<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';

	let { children } = $props();

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

	function isActive(item: { href: string; exact?: boolean }) {
		return item.exact
			? $page.url.pathname === item.href
			: $page.url.pathname.startsWith(item.href);
	}

	const isLogin = $derived($page.url.pathname === '/admin/login');

	let collapsed = $state(false);

	onMount(() => {
		collapsed = localStorage.getItem('admin_sidebar_collapsed') === 'true';
	});

	function toggleSidebar() {
		collapsed = !collapsed;
		localStorage.setItem('admin_sidebar_collapsed', String(collapsed));
	}
</script>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-zinc-950">
		<!-- Sidebar -->
		<aside
			class="flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-200 {collapsed
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

		<!-- Main content -->
		<main class="flex-1 overflow-auto">
			{@render children()}
		</main>
	</div>
{/if}
