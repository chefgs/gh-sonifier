import type { Settings } from './types.ts';

export const TEMPO_MIN = 60;
export const TEMPO_MAX = 240;

/** The documented defaults. Changing these changes every generated piece. */
export const DEFAULT_SETTINGS: Settings = {
  scale: 'minorPentatonic',
  rootMidi: 57, // A3
  tempo: 120,
  timeMode: 'day',
  weekdayOctave: false,
  monthShift: false,
  humanize: 0,
  seed: 1,
};

const SCALES = new Set(['minorPentatonic', 'majorPentatonic', 'dorian', 'hirajoshi']);

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Force any partial or hostile settings object into a valid one. The player and the
 * mapping layer both run this first, so no caller can smuggle an out-of-range value
 * (a 10000 BPM tempo, a negative gain) into the audio graph.
 */
export function normalizeSettings(raw: Partial<Settings> | undefined | null): Settings {
  const s = raw ?? {};
  return {
    scale: SCALES.has(String(s.scale)) ? (s.scale as Settings['scale']) : DEFAULT_SETTINGS.scale,
    rootMidi: clampInt(s.rootMidi, 21, 96, DEFAULT_SETTINGS.rootMidi),
    tempo: clampInt(s.tempo, TEMPO_MIN, TEMPO_MAX, DEFAULT_SETTINGS.tempo),
    timeMode: s.timeMode === 'week' ? 'week' : 'day',
    weekdayOctave: s.weekdayOctave === true,
    monthShift: s.monthShift === true,
    humanize: Math.min(1, Math.max(0, Number(s.humanize) || 0)),
    seed: clampInt(s.seed, 0, 2 ** 31 - 1, DEFAULT_SETTINGS.seed),
  };
}
