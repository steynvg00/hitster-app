<script lang="ts">
	import { CheckCircle, AlertCircle, Info, X } from 'lucide-svelte';
	import { toasts, dismissToast } from '$lib/stores/toasts.svelte';

	const ICONS = {
		success: CheckCircle,
		error: AlertCircle,
		info: Info
	};

	const COLORS = {
		success: 'border-green-700 bg-green-950 text-green-300',
		error: 'border-red-700 bg-red-950 text-red-300',
		info: 'border-zinc-700 bg-zinc-800 text-zinc-200'
	};
</script>

<div class="pointer-events-none fixed right-5 bottom-5 z-[9999] flex flex-col-reverse gap-2">
	{#each toasts.value as toast (toast.id)}
		{@const Icon = ICONS[toast.type]}
		<div
			class="pointer-events-auto flex max-w-sm min-w-64 items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl {COLORS[
				toast.type
			]}"
		>
			<Icon size={16} class="mt-0.5 shrink-0" />
			<p class="flex-1 text-sm leading-relaxed">{toast.message}</p>
			<button
				onclick={() => dismissToast(toast.id)}
				class="shrink-0 opacity-60 transition-opacity hover:opacity-100"
				aria-label="Dismiss"
			>
				<X size={14} />
			</button>
		</div>
	{/each}
</div>
