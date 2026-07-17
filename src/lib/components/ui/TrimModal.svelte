<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		file: File;
		trackId: string;
		orderIndex?: number | null;
		onClose: () => void;
		onUploaded: () => void;
	}

	let { file, trackId, orderIndex = null, onClose, onUploaded }: Props = $props();

	// ── waveform state ─────────────────────────────────────────────────────────
	let container: HTMLElement;
	let ws: import('wavesurfer.js').default | null = null;
	let wsReady = $state(false);
	let isPlaying = $state(false);
	let isLooping = $state(false);

	// ── region / trim state ────────────────────────────────────────────────────
	let regionStart = $state(0);
	let regionEnd = $state(0);
	let _audioDuration = $state(0);

	const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const selectionLabel = $derived(
		`${fmt(regionStart)} – ${fmt(regionEnd)}  (${(regionEnd - regionStart).toFixed(1)}s selected)`
	);

	// ── status ─────────────────────────────────────────────────────────────────
	type Phase = 'loading' | 'ready' | 'loadingFfmpeg' | 'trimming' | 'uploading' | 'done' | 'error';
	let phase = $state<Phase>('loading');
	let errorMsg = $state('');

	// ── ffmpeg ─────────────────────────────────────────────────────────────────
	let ffmpegInstance: import('@ffmpeg/ffmpeg').FFmpeg | null = null;

	async function loadFfmpeg() {
		if (ffmpegInstance) return ffmpegInstance;
		const { FFmpeg } = await import('@ffmpeg/ffmpeg');
		const ff = new FFmpeg();
		// Core files are copied from node_modules/@ffmpeg/core to /static/ffmpeg/ by the
		// Vite plugin in vite.config.ts. Same-origin load avoids CDN CORS and works with
		// the COOP/COEP headers set for /admin/* in hooks.server.ts.
		await ff.load({
			coreURL: '/ffmpeg/ffmpeg-core.js',
			wasmURL: '/ffmpeg/ffmpeg-core.wasm'
		});
		ffmpegInstance = ff;
		return ff;
	}

	// ── mount WaveSurfer ───────────────────────────────────────────────────────
	onMount(() => {
		const objUrl = URL.createObjectURL(file);

		import('wavesurfer.js').then(async ({ default: WaveSurfer }) => {
			const { default: Regions } = await import('wavesurfer.js/plugins/regions');

			const regionsPlugin = Regions.create();

			ws = WaveSurfer.create({
				container,
				waveColor: '#3f3f46',
				progressColor: '#fbbf24',
				height: 80,
				normalize: true,
				interact: true,
				hideScrollbar: true,
				url: objUrl,
				plugins: [regionsPlugin]
			});

			ws.on('ready', (dur: number) => {
				_audioDuration = dur;
				regionStart = 0;
				regionEnd = dur;
				wsReady = true;
				phase = 'ready';

				regionsPlugin.addRegion({
					id: 'trim',
					start: 0,
					end: dur,
					color: 'rgba(251, 191, 36, 0.15)',
					drag: true,
					resize: true
				});
			});

			ws.on('play', () => (isPlaying = true));
			ws.on('pause', () => (isPlaying = false));
			ws.on('finish', () => {
				isPlaying = false;
				isLooping = false;
			});

			// Loop playback within region
			ws.on('timeupdate', (t: number) => {
				if (isLooping && t >= regionEnd - 0.05) {
					ws?.setTime(regionStart);
				}
			});

			// Track region changes
			regionsPlugin.on('region-updated', (r: { start: number; end: number }) => {
				regionStart = r.start;
				regionEnd = r.end;
			});
		});

		return () => {
			URL.revokeObjectURL(objUrl);
		};
	});

	onDestroy(() => {
		ws?.destroy();
		ws = null;
	});

	// ── playback controls ──────────────────────────────────────────────────────
	function toggleLoopPlay() {
		if (!ws || !wsReady) return;
		if (isLooping && isPlaying) {
			ws.pause();
			isLooping = false;
		} else {
			isLooping = true;
			ws.setTime(regionStart);
			ws.play();
		}
	}

	function stopPlayback() {
		ws?.pause();
		ws?.setTime(0);
		isLooping = false;
	}

	// ── trim + upload ──────────────────────────────────────────────────────────
	async function saveTrimmed() {
		if (phase !== 'ready') return;

		try {
			phase = 'loadingFfmpeg';
			const ff = await loadFfmpeg();

			phase = 'trimming';
			const { fetchFile } = await import('@ffmpeg/util');

			const ext = file.name.split('.').pop() ?? 'mp3';
			const inputName = `input.${ext}`;
			const outputName = `output.${ext}`;

			await ff.writeFile(inputName, await fetchFile(file));
			await ff.exec([
				'-i',
				inputName,
				'-ss',
				String(regionStart.toFixed(3)),
				'-to',
				String(regionEnd.toFixed(3)),
				'-c',
				'copy',
				outputName
			]);

			const data = await ff.readFile(outputName);
			// Cast to Uint8Array<ArrayBuffer> to satisfy Blob constructor type
			const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: file.type || 'audio/mpeg' });
			const trimmedFile = new File([blob], outputName, { type: blob.type });

			// Clean up ffmpeg virtual FS
			await ff.deleteFile(inputName);
			await ff.deleteFile(outputName);

			phase = 'uploading';

			const dur = regionEnd - regionStart;
			const fd = new FormData();
			fd.append('file', trimmedFile);
			if (orderIndex != null) fd.append('order_index', String(orderIndex));
			fd.append('duration', String(dur));

			const res = await fetch(`/admin/tracks/${trackId}/upload`, { method: 'POST', body: fd });
			if (!res.ok) {
				const text = await res.text();
				throw new Error(text || `HTTP ${res.status}`);
			}

			phase = 'done';
			onUploaded();
		} catch (e) {
			phase = 'error';
			errorMsg = String(e);
		}
	}
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') onClose();
	}}
>
	<div class="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<div>
				<h2 class="text-lg font-black text-white">Trim Clip</h2>
				<p class="mt-0.5 max-w-sm truncate text-xs text-zinc-500">{file.name}</p>
			</div>
			<button
				onclick={onClose}
				class="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
				aria-label="Close"
			>
				✕
			</button>
		</div>

		<!-- Waveform -->
		<div class="mb-4 overflow-hidden rounded-xl bg-zinc-950 p-3">
			{#if !wsReady}
				<div class="flex h-20 items-center justify-center text-sm text-zinc-500">
					Loading waveform…
				</div>
			{/if}
			<div bind:this={container} class="w-full {!wsReady ? 'hidden' : ''}"></div>
		</div>

		{#if wsReady}
			<!-- Selection info -->
			<div class="mb-4 rounded-lg bg-zinc-800 px-4 py-2 font-mono text-sm text-amber-400">
				{selectionLabel}
			</div>

			<!-- Playback controls -->
			<div class="mb-4 flex gap-2">
				<button
					onclick={toggleLoopPlay}
					class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors
						{isLooping && isPlaying
						? 'bg-amber-400 text-zinc-950'
						: 'border border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white'}"
				>
					{isLooping && isPlaying ? '⏸ Pause' : '▶ Play selection'}
				</button>
				{#if isPlaying}
					<button
						onclick={stopPlayback}
						class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
					>
						■ Stop
					</button>
				{/if}
			</div>

		{/if}

		<!-- Status / error -->
		{#if phase === 'loadingFfmpeg'}
			<div
				class="mb-4 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-400"
			>
				Loading ffmpeg.wasm (~30 MB, once per session)…
			</div>
		{:else if phase === 'trimming'}
			<div
				class="mb-4 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-400"
			>
				Trimming audio…
			</div>
		{:else if phase === 'uploading'}
			<div
				class="mb-4 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-400"
			>
				Uploading clip…
			</div>
		{:else if phase === 'done'}
			<div
				class="mb-4 rounded-lg border border-green-800 bg-green-950/40 px-4 py-3 text-sm text-green-400"
			>
				Clip saved successfully!
			</div>
		{:else if phase === 'error'}
			<div
				class="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex justify-end gap-2">
			<button
				onclick={onClose}
				class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
			>
				{phase === 'done' ? 'Close' : 'Cancel'}
			</button>
			{#if phase === 'ready' || phase === 'error'}
				<button
					onclick={saveTrimmed}
					disabled={!wsReady || regionEnd <= regionStart}
					class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
				>
					Save trimmed clip
				</button>
			{:else if phase !== 'done'}
				<button
					disabled
					class="rounded-lg bg-amber-400/50 px-4 py-2 text-sm font-bold text-zinc-950 opacity-50"
				>
					Working…
				</button>
			{/if}
		</div>
	</div>
</div>
