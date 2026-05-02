<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type PhotoMode = 'camera' | 'gallery';

	let photoMode = $state<PhotoMode | null>(null);
	let photoPreviewUrl = $state<string | null>(null);
	let photoFile = $state<File | null>(null);
	let submitting = $state(false);

	const isTeams = $derived(data.mode === 'teams');
	const heading = $derived(isTeams ? 'Join the Team Game' : 'Play Solo');
	const subheading = $derived(
		isTeams ? 'Enter your name to join your team' : 'Enter your name to start playing'
	);

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
		photoFile = file;
		photoPreviewUrl = URL.createObjectURL(file);
	}

	function clearPhoto() {
		if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
		photoPreviewUrl = null;
		photoFile = null;
		photoMode = null;
	}
</script>

<svelte:head>
	<title>{heading} — Hitster</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-zinc-950 px-5 py-8">
	<a href="/" class="mb-8 self-start text-sm text-zinc-500 transition-colors hover:text-zinc-300">
		← Back
	</a>

	<div class="mx-auto w-full max-w-sm flex-1">
		<div class="mb-8">
			<h1 class="text-3xl font-black text-white">{heading}</h1>
			<p class="mt-1 text-sm text-zinc-400">{subheading}</p>
		</div>

		{#if form?.error}
			<div
				class="mb-5 rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-300"
			>
				{form.error}
			</div>
		{/if}

		<!--
			enctype="multipart/form-data" required for file upload.
			The photo file is stored in `photoFile` state and injected into FormData
			via the use:enhance callback — this works even when the <input> is not in the
			DOM (e.g. when the preview is showing instead).
		-->
		<form
			method="POST"
			enctype="multipart/form-data"
			use:enhance={({ formData }) => {
				// Inject the in-memory file into FormData regardless of DOM state
				if (photoFile) formData.set('photo', photoFile, photoFile.name);
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
			class="space-y-6"
		>
			{#if data.next}
				<input type="hidden" name="next" value={data.next} />
			{/if}
			<!-- Name -->
			<div>
				<label class="mb-1.5 block text-sm font-semibold text-zinc-300" for="player-name">
					Your name
				</label>
				<input
					id="player-name"
					name="name"
					type="text"
					value={form?.name ?? ''}
					required
					minlength="2"
					maxlength="30"
					placeholder="Enter your name"
					autocomplete="given-name"
					class="player-input"
				/>
			</div>

			<!-- Photo section (entirely optional) -->
			<div>
				<div class="mb-2 flex items-center justify-between">
					<span class="text-sm font-semibold text-zinc-300">
						Photo <span class="font-normal text-zinc-500">(optional)</span>
					</span>
					{#if photoPreviewUrl}
						<button
							type="button"
							onclick={clearPhoto}
							class="text-xs text-zinc-500 transition-colors hover:text-red-400"
						>
							Remove
						</button>
					{/if}
				</div>

				{#if photoPreviewUrl}
					<!-- Preview -->
					<div class="flex justify-center py-2">
						<img
							src={photoPreviewUrl}
							alt="Selected avatar preview"
							class="h-28 w-28 rounded-full object-cover ring-2 ring-amber-400/50"
						/>
					</div>
				{:else}
					<!-- Mode picker buttons -->
					<div class="flex gap-3">
						<button
							type="button"
							onclick={() => (photoMode = 'camera')}
							class="flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-4 text-sm font-medium transition-colors {photoMode ===
							'camera'
								? 'border-amber-400 bg-amber-400/10 text-amber-300'
								: 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}"
						>
							<span class="text-2xl">📷</span>
							Take photo
						</button>
						<button
							type="button"
							onclick={() => (photoMode = 'gallery')}
							class="flex flex-1 flex-col items-center gap-1.5 rounded-xl border py-4 text-sm font-medium transition-colors {photoMode ===
							'gallery'
								? 'border-amber-400 bg-amber-400/10 text-amber-300'
								: 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}"
						>
							<span class="text-2xl">🖼</span>
							Upload
						</button>
					</div>

					<!--
						File inputs: only one is mounted at a time.
						capture="user" on the camera variant opens the front camera directly on
						Android Chrome. On iOS Safari it presents a system sheet (Camera / Photo
						Library / Browse) regardless of the capture attribute — expected iOS behaviour.
					-->
					{#if photoMode === 'camera'}
						<label
							class="mt-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-600 py-4 text-sm text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
						>
							Tap to open camera
							<input
								type="file"
								accept="image/*"
								capture="user"
								class="sr-only"
								onchange={handleFileChange}
							/>
						</label>
					{:else if photoMode === 'gallery'}
						<label
							class="mt-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-zinc-600 py-4 text-sm text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-200"
						>
							Tap to choose from gallery
							<input
								type="file"
								accept="image/*"
								class="sr-only"
								onchange={handleFileChange}
							/>
						</label>
					{/if}
				{/if}
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="w-full rounded-xl bg-amber-400 py-4 text-lg font-black text-zinc-950 transition-all hover:bg-amber-300 active:scale-[0.98] disabled:opacity-50"
			>
				{submitting ? 'Saving…' : 'Continue →'}
			</button>

			<p class="text-center text-xs text-zinc-600">
				No account needed. Session lasts 12 hours.
			</p>
		</form>
	</div>
</div>

<style>
	:global(.player-input) {
		width: 100%;
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 0.625rem;
		padding: 0.75rem 1rem;
		color: #f4f4f5;
		font-size: 1rem;
		transition: border-color 0.15s;
	}
	:global(.player-input:focus) {
		outline: none;
		border-color: #fbbf24;
	}
</style>
