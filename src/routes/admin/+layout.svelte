<script lang="ts">
	import { page } from '$app/stores';

	let { children } = $props();

	const nav = [
		{ href: '/admin/challenges', label: 'Challenges', icon: '🎯' },
		{ href: '/admin/tracks', label: 'Tracks', icon: '🎵' },
		{ href: '/admin/teams', label: 'Teams', icon: '👥' },
		{ href: '/admin/pools', label: 'Pools', icon: '🗂️' },
		{ href: '/admin/review', label: 'Review', icon: '🔍' },
		{ href: '/admin/variant-defaults', label: 'Defaults', icon: '⚙️' },
		{ href: '/admin/live', label: 'Live', icon: '📡' }
	];

	const isLogin = $derived($page.url.pathname === '/admin/login');
</script>

{#if isLogin}
	{@render children()}
{:else}
	<div class="min-h-screen bg-zinc-950 flex">
		<!-- Sidebar -->
		<aside class="w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0">
			<div class="p-4 border-b border-zinc-800">
				<div class="text-amber-400 font-black text-lg tracking-tight">HITSTER</div>
				<div class="text-zinc-500 text-xs uppercase tracking-widest mt-0.5">Host Admin</div>
			</div>

			<nav class="flex-1 p-3 space-y-1">
				{#each nav as item}
					<a
						href={item.href}
						class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
							{$page.url.pathname.startsWith(item.href)
							? 'bg-amber-400/15 text-amber-300 font-medium'
							: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}"
					>
						<span class="text-base">{item.icon}</span>
						{item.label}
					</a>
				{/each}
			</nav>

			<div class="p-3 border-t border-zinc-800">
				<a
					href="/admin/logout"
					class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors w-full"
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
