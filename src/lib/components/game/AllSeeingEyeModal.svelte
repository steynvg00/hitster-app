<script lang="ts">
	import type { EyeTeam } from '$lib/powerups-meta';

	let {
		teams,
		fields,
		onclose
	}: {
		// Already stripped server-side (stripAnswersForEye). This component renders
		// what it is given and derives NOTHING — in particular it never compares a
		// value to a correct answer, because it has no correct answer to compare to.
		teams: EyeTeam[];
		// The challenge's field order, so columns line up with the player's own form
		// instead of following whatever order a team's JSON happened to have.
		fields: string[];
		onclose: () => void;
	} = $props();

	const TEAM_DOT: Record<string, string> = {
		blue: 'bg-blue-500',
		yellow: 'bg-yellow-400',
		green: 'bg-green-500',
		red: 'bg-red-500',
		indigo: 'bg-indigo-500',
		black: 'bg-neutral-600'
	};

	// Field labels match the ones the player's own form uses.
	const FIELD_LABEL: Record<string, string> = {
		artist: 'Artist',
		title: 'Title',
		year: 'Year',
		label: 'Label',
		festival: 'Festival',
		vocal_source: 'Vocal',
		grouping: 'Grouping'
	};

	function label(f: string): string {
		return FIELD_LABEL[f] ?? f;
	}

	// A team's answers are shown exactly as typed. An empty string means they left
	// it blank, which is information the Eye is allowed to show — it is what they
	// wrote (nothing), not a judgement on it.
	function shown(value: string | undefined): string {
		return value && value.trim() !== '' ? value : '—';
	}

	// The multi-line artist input stores tags newline-separated; join them the way
	// the results screen does so the panel reads as one answer.
	function display(field: string, value: string | undefined): string {
		const v = shown(value);
		return field === 'artist' ? v.split('\n').filter(Boolean).join(' & ') || '—' : v;
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
	role="dialog"
	aria-modal="true"
	aria-label="All Seeing Eye"
>
	<div
		class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-zinc-700 bg-zinc-900 shadow-2xl sm:rounded-2xl"
	>
		<!-- Header -->
		<div class="flex items-start justify-between gap-3 border-b border-zinc-800 p-5 pb-4">
			<div>
				<p class="text-xs font-bold tracking-widest text-purple-400 uppercase">👁️ All Seeing Eye</p>
				<p class="mt-1 text-sm text-zinc-400">
					{teams.length}
					{teams.length === 1 ? 'team has' : 'teams have'} already finished this challenge. This is what
					they wrote.
				</p>
			</div>
			<button
				type="button"
				onclick={onclose}
				aria-label="Close"
				class="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
			>
				✕
			</button>
		</div>

		<!-- Teams -->
		<div class="flex-1 overflow-y-auto p-5 pt-4">
			<div class="flex flex-col gap-5">
				{#each teams as team (team.teamId)}
					<div class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
						<div class="mb-3 flex items-center gap-2">
							<span class="h-3 w-3 rounded-sm {TEAM_DOT[team.color] ?? 'bg-neutral-600'}"></span>
							<span class="text-sm font-bold text-white">{team.displayName}</span>
							<!-- Only rendered when the host switched show_scores on. When it is
							     off the server omits the key entirely, so there is nothing here
							     to fall back to. -->
							{#if typeof team.score === 'number'}
								<span
									class="ml-auto rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-bold text-amber-300"
								>
									{team.score} pts
								</span>
							{/if}
						</div>

						<div class="flex flex-col gap-3">
							{#each team.tabs as tab (tab.tabPosition)}
								<div>
									{#if team.tabs.length > 1}
										<p class="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
											Track {tab.tabPosition + 1}
										</p>
									{/if}
									{#each tab.slots as slot (slot.slotIndex)}
										<div class="mb-1.5 flex flex-col gap-1 last:mb-0">
											{#each fields as field (field)}
												<div class="flex items-baseline gap-2 text-sm">
													<span class="w-16 shrink-0 text-xs text-zinc-500">{label(field)}</span>
													<!-- Plain zinc-200, deliberately: no green, no red, no
													     strikethrough. The Eye shows what a team wrote and
													     says nothing about whether it is right. -->
													<span class="min-w-0 flex-1 break-words text-zinc-200"
														>{display(field, slot.fieldValues[field])}</span
													>
												</div>
											{/each}
											{#if slot.fragments?.length}
												<div class="flex items-baseline gap-2 text-sm">
													<span class="w-16 shrink-0 text-xs text-zinc-500">Fragments</span>
													<span class="min-w-0 flex-1 text-zinc-200"
														>{slot.fragments.join(', ')}</span
													>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<p class="mt-5 text-center text-xs text-zinc-500">
				The Eye shows what was written, not what was right.
			</p>
		</div>

		<!-- Footer -->
		<div class="border-t border-zinc-800 p-5 pt-4">
			<button
				type="button"
				onclick={onclose}
				class="w-full rounded-xl bg-purple-500 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-400"
			>
				Close the Eye
			</button>
		</div>
	</div>
</div>
