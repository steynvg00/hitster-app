<script lang="ts">
	import type { ActivityLogRow } from '$lib/types/database';

	interface Props {
		events: ActivityLogRow[];
		limit?: number;
		teams?: { id: string; display_name: string; color: string }[];
	}

	let { events, limit = 10, teams = [] }: Props = $props();

	const teamColorHex: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#64748b'
	};

	function teamLabel(teamId: string | null): string {
		if (!teamId) return '';
		return teams.find((t) => t.id === teamId)?.display_name ?? teamId.slice(0, 8);
	}

	function teamColor(teamId: string | null): string {
		if (!teamId) return '#52525b';
		const team = teams.find((t) => t.id === teamId);
		return teamColorHex[team?.color ?? ''] ?? '#52525b';
	}

	function eventLabel(a: ActivityLogRow): string {
		const payload = a.payload as Record<string, unknown> | null;
		if (a.event_type === 'challenge_submit') {
			const p = payload as { challenge_title?: string; score?: number } | null;
			return p?.challenge_title
				? `Submitted "${p.challenge_title}" · ${p.score ?? 0} pts`
				: 'Submitted a challenge';
		}
		if (a.event_type === 'score_adjustment' && payload) {
			const delta = Number(payload.delta ?? 0);
			const sign = delta >= 0 ? '+' : '';
			return `Score adjusted (${sign}${delta}): ${payload.reason ?? ''}`;
		}
		if (a.event_type === 'score_reset') return 'Score reset to 0';
		if (a.event_type === 'challenge_closed') return 'Challenge closed';
		if (a.event_type === 'attempt_reset' && payload?.reason) {
			return `Challenge reset (−${payload.score_deducted ?? 0}): ${payload.reason}`;
		}
		if (a.event_type === 'attempt_reset') return 'Attempt reset';
		// Host interventions (host-tools). Both carry a mandatory reason.
		if (a.event_type === 'host_powerup_granted' && payload) {
			return `Host granted ${payload.powerup_name ?? 'a powerup'}: ${payload.reason ?? ''}`;
		}
		if (a.event_type === 'host_time_granted' && payload) {
			return `Host gave +${payload.seconds ?? '?'}s: ${payload.reason ?? ''}`;
		}
		if (a.event_type === 'team_entry') return 'Team entry scan';
		return a.event_type.replace(/_/g, ' ');
	}

	const EVENT_ICONS: Record<string, string> = {
		challenge_submit: '🎯',
		score_adjustment: '±',
		score_reset: '↺',
		challenge_closed: '✕',
		attempt_reset: '↺',
		host_powerup_granted: '🎁',
		host_time_granted: '⏱',
		team_entry: '→'
	};

	function eventIcon(type: string): string {
		return EVENT_ICONS[type] ?? '·';
	}

	function relativeTime(iso: string): string {
		const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	}

	const visible = $derived(events.slice(0, limit));
</script>

{#if visible.length === 0}
	<p class="py-3 text-center text-sm text-zinc-600">No recent activity.</p>
{:else}
	<div class="space-y-1">
		{#each visible as a (a.id)}
			{@const color = teamColor(a.team_id)}
			<div class="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-800/50">
				<span class="mt-px shrink-0 font-mono text-zinc-600">{eventIcon(a.event_type)}</span>
				<div class="min-w-0 flex-1">
					<span class="text-zinc-300">{eventLabel(a)}</span>
					{#if a.team_id}
						<span class="ml-1 font-medium" style="color: {color};">{teamLabel(a.team_id)}</span>
					{/if}
				</div>
				<span class="shrink-0 text-zinc-600 tabular-nums">{relativeTime(a.created_at)}</span>
			</div>
		{/each}
	</div>
{/if}
