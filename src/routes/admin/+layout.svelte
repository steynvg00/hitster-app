<script lang="ts">
	import { page } from '$app/stores';

	let { children } = $props();

	const nav = [
		{ href: '/admin', label: 'Dashboard', icon: '🏠', exact: true },
		{ href: '/admin/sets', label: 'Sets', icon: '🎮' },
		{ href: '/admin/challenges', label: 'Challenges', icon: '🎯' },
		{ href: '/admin/tracks', label: 'Tracks', icon: '🎵' },
		{ href: '/admin/teams', label: 'Teams', icon: '👥' },
		{ href: '/admin/pools', label: 'Pools', icon: '🗂️' },
		{ href: '/admin/review', label: 'Review', icon: '🔍' },
		{ href: '/admin/variant-defaults', label: 'Defaults', icon: '⚙️' },
		{ href: '/admin/live', label: 'Live', icon: '📡' }
	];

	function isActive(item: { href: string; exact?: boolean }) {
		return item.exact
			? $page.url.pathname === item.href
			: $page.url.pathname.startsWith(item.href);
	}

	const isLogin = $derived($page.url.pathname === '/admin/login');
</script>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-zinc-950">
		<!-- Sidebar -->
		<aside class="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
			<div class="border-b border-zinc-800 p-4">
				<div class="text-lg font-black tracking-tight text-amber-400">MixUp!</div>
				<div class="mt-0.5 text-xs uppercase tracking-widest text-zinc-500">Host Admin</div>
			</div>

			<nav class="flex-1 space-y-1 p-3">
				{#each nav as item}
					<a
						href={item.href}
						class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors
							{isActive(item)
							? 'bg-amber-400/15 font-medium text-amber-300'
							: 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}"
					>
						<span class="text-base">{item.icon}</span>
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="border-t border-zinc-800 p-3">
				<a
					href="/admin/logout"
					class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
				>
					<span class="text-base">🚪</span>
					Logout
				</a>
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 overflow-auto">
			{@render children()}
		</main>
	</div>
{/if}
