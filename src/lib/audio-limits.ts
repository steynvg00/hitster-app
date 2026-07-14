/**
 * Bounds for the tempo effect's playback rate.
 *
 * These are load-bearing, not cosmetic. Tempo is the browser's WSOLA time-stretcher
 * (playbackRate with preservesPitch = true). WSOLA is clean at mild rates but has to
 * repeat or drop grains as the rate departs from 1, which is what produced the
 * stuttering that started this whole investigation — worst when slowing down, and
 * unusable at the old 0.25–4.0 extremes. 0.85–1.2 keeps the stretcher inside the
 * range it was designed for, where it measured transparent: on a hard-bass kick train
 * it held the dry reference's 60 Hz sub bin exactly at both 0.9× and 1.2×, with
 * transients intact.
 *
 * This range is also why tempo needs no pitch correction. The alternative — varispeed
 * (preservesPitch = false) plus a −12·log2(rate) Tone.PitchShift — was built, measured
 * and rejected: it detuned a 60 Hz sub by ~1 st and smeared transients, because Tone's
 * crude delay-line shifter is erratic exactly at bass fundamentals. Narrowing the
 * range removed the need for that machinery rather than improving it. Widening this
 * range again would bring the stutter back and re-open that whole problem; the real
 * fix for a wide range is offline pre-rendering, not a client-side shifter.
 *
 * A guessing game needs a nudge in tempo, not a remix — so the range is bounded by
 * what the playback path can actually deliver cleanly, not by what playbackRate accepts.
 *
 * Single source of truth: EffectsEditor's slider uses these, and Waveform clamps with
 * them at apply time, so a legacy saved value (or a preset, or a hand-edited JSONB row)
 * can never drive the stretcher outside its supported range. Stored data is left
 * untouched — the clamp lives only in the apply path.
 */
export const TEMPO_RATE_MIN = 0.85;
export const TEMPO_RATE_MAX = 1.2;
export const TEMPO_RATE_STEP = 0.01;
export const TEMPO_RATE_DEFAULT = 1.0;

/** Clamp a stored/authored tempo rate into the supported range. Non-finite or absent
 *  values fall back to 1.0 (no tempo change) rather than to a bound. */
export function clampTempoRate(rate: number | undefined | null): number {
	if (typeof rate !== 'number' || !Number.isFinite(rate)) return TEMPO_RATE_DEFAULT;
	return Math.min(TEMPO_RATE_MAX, Math.max(TEMPO_RATE_MIN, rate));
}
