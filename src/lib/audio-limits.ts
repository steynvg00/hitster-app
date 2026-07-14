/**
 * Bounds for the tempo effect's playback rate.
 *
 * Why these are narrow: tempo is implemented as varispeed (playbackRate with
 * preservesPitch = false), and the pitch it displaces has to be put back by a
 * Tone.PitchShift of −12·log2(rate) semitones. That shifter is a crude two-delay-line
 * granular design whose artefact grows with |log2(rate)|, and whose down-shift (what
 * rate > 1 needs) is its dirty direction. The old 0.25–4.0 range demanded corrections
 * of up to ±24 semitones, which no realtime granular shifter does cleanly on
 * transient-heavy bass. 0.85–1.2 caps it at −3.16 / +2.81 semitones.
 *
 * Be honest about what this buys: the ceiling moving 1.25 → 1.2 only takes the
 * correction from −3.86 st to −3.16 st (18% less), so it does NOT on its own rescue
 * material that already sounded muddy at 1.25. Its real job is preventing the absurd
 * end of the old range. The correction only gets genuinely small further in — 1.1×
 * is −1.65 st, less than half of 1.25×. If 1.2 still sounds poor, lowering
 * TEMPO_RATE_MAX to ~1.1 is the next lever, which is why these are named constants.
 *
 * A guessing game needs a nudge in tempo, not a remix — so the range is bounded by
 * what the DSP can actually deliver rather than by what playbackRate will accept.
 *
 * These bounds are the single source of truth: EffectsEditor's slider uses them, and
 * Waveform clamps with them at apply time so a legacy saved value (or a preset, or a
 * hand-edited JSONB row) can never demand a correction outside the supported range.
 * Stored data is left untouched — the clamp lives only in the apply path.
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
