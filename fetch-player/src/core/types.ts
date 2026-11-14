/** Shared data shapes. Everything here is plain JSON: no classes, no methods. */

/** GitHub's five contribution shades. 0 is an empty day. */
export type Level = 0 | 1 | 2 | 3 | 4;

/** One calendar day. `count` is null when the exact number could not be read. */
export interface Day {
  date: string; // YYYY-MM-DD
  level: Level;
  count: number | null;
}

/** One year of contributions, as produced by the parser and by offline JSON. */
export interface YearData {
  user: string;
  year: number;
  total: number;
  days: Day[];
}

export type ScaleName = 'minorPentatonic' | 'majorPentatonic' | 'dorian' | 'hirajoshi';

export type TimeMode = 'day' | 'week';

/** Everything that affects the generated notes. Same days + same settings -> same events. */
export interface Settings {
  scale: ScaleName;
  rootMidi: number; // MIDI note of scale degree 0
  tempo: number; // BPM, one beat per day in 'day' mode
  timeMode: TimeMode;
  weekdayOctave: boolean; // map weekday to octave
  monthShift: boolean; // move the melody up and down the scale as months pass (stays in key)
  humanize: number; // 0..1, seeded jitter on timing and velocity
  seed: number;
}

export type Voice = 'lead' | 'bass';

/** A single note to play. Serialisable, no audio objects. */
export interface SoundEvent {
  step: number; // index on the timeline (day index, or week index in 'week' mode)
  offset: number; // fraction of a step, 0..1, for chord spread and humanisation
  degree: number; // scale degree, may be negative or beyond one octave
  velocity: number; // 0..1
  duration: number; // in steps
  voice: Voice;
  dayIndex: number; // which day this came from, for the playhead and caption
}
