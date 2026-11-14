import type { ScaleName } from './types.ts';

/** Semitone offsets from the root. Degrees are indices into these arrays. */
export const SCALE_STEPS: Record<ScaleName, readonly number[]> = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  hirajoshi: [0, 2, 3, 7, 8],
};

export const SCALE_LABELS: Record<ScaleName, string> = {
  minorPentatonic: 'Minor pentatonic',
  majorPentatonic: 'Major pentatonic',
  dorian: 'Dorian',
  hirajoshi: 'Hirajoshi',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function scaleLength(scale: ScaleName): number {
  return SCALE_STEPS[scale].length;
}

/**
 * Turn a scale degree into a MIDI note. Degrees outside one octave wrap, so degree -1 is
 * the note below the root and degree `length` is the root an octave up. Because pitch is
 * only ever produced this way, every note is in the chosen scale by construction.
 */
export function degreeToMidi(degree: number, rootMidi: number, scale: ScaleName): number {
  const steps = SCALE_STEPS[scale];
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const index = degree - octave * len;
  const semitone = steps[index] ?? 0;
  return rootMidi + 12 * octave + semitone;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const n = Math.round(midi);
  const name = NOTE_NAMES[((n % 12) + 12) % 12] ?? 'C';
  return `${name}${Math.floor(n / 12) - 1}`;
}

/** Every MIDI note the scale can produce from this root, for tests and the UI. */
export function pitchClassesInScale(rootMidi: number, scale: ScaleName): Set<number> {
  const out = new Set<number>();
  for (const step of SCALE_STEPS[scale]) out.add(((rootMidi + step) % 12 + 12) % 12);
  return out;
}
