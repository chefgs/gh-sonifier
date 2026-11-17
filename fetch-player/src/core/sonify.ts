/**
 * The mapping layer: contribution days in, note events out.
 *
 * Pure. No audio objects, no Date.now(), no randomness beyond the seeded RNG. The same
 * days and the same settings always produce an identical SoundEvent[], which is what makes
 * the player, the share card and the tests agree about what is playing.
 *
 * How the mapping works:
 *   level 0            -> rest, no note
 *   levels 1-4         -> scale degrees 0-3, so a darker green is a lower note
 *   exact daily count  -> velocity, on a log curve against the busiest day in the data
 *   each week          -> one bass note underneath, picked from how busy that week was
 */

import { makeRng } from './rng.ts';
import { normalizeSettings } from './settings.ts';
import { monthIndex, weekday } from './calendar.ts';
import { scaleLength } from './scales.ts';
import type { Day, Settings, SoundEvent } from './types.ts';

/** Quiet floor and ceiling for a note that sounds at all. Never reaches 1.0. */
const VELOCITY_MIN = 0.28;
const VELOCITY_SPAN = 0.52;
export const VELOCITY_MAX = 0.9;

/** Scale degrees added per month when monthShift is on. Degrees, so it stays in key. */
const MONTH_DRIFT = [0, 0, 1, 1, 2, 2, 1, 1, 0, 0, -1, -1];

/** Keeps floats comparable across engines so determinism tests can use exact equality. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return VELOCITY_MIN;
  return round6(Math.min(VELOCITY_MAX, Math.max(0, v)));
}

/** How loud a day is, 0..1, relative to the busiest day present. */
function intensityOf(day: Day, maxCount: number): number {
  if (day.count !== null && maxCount > 0) {
    return Math.log1p(day.count) / Math.log1p(maxCount);
  }
  // No tooltip count available: fall back to the shade alone.
  return day.level === 0 ? 0 : (day.level - 1) / 3;
}

function busiestIndex(days: Day[], from: number, to: number): number {
  let best = from;
  let bestScore = -1;
  for (let i = from; i < to; i++) {
    const d = days[i];
    if (d === undefined) continue;
    const score = d.count ?? d.level;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function sonify(days: Day[], rawSettings?: Partial<Settings>): SoundEvent[] {
  const settings = normalizeSettings(rawSettings);
  const events: SoundEvent[] = [];
  if (days.length === 0) return events;

  const len = scaleLength(settings.scale);
  const rng = makeRng(settings.seed);
  const humanize = settings.humanize;

  let maxCount = 0;
  for (const d of days) if (d.count !== null && d.count > maxCount) maxCount = d.count;

  const jitterOffset = (): number => (humanize === 0 ? 0 : (rng() - 0.5) * 0.08 * humanize);
  const jitterVelocity = (v: number): number => (humanize === 0 ? v : v * (1 + (rng() - 0.5) * 0.25 * humanize));

  // Week boundaries, used by both modes for the bass line.
  const weekStarts: number[] = [];
  days.forEach((d, i) => {
    if (i === 0 || weekday(d.date) === 0) weekStarts.push(i);
  });

  const bassFor = (step: number, start: number, end: number): SoundEvent => {
    let sum = 0;
    for (let i = start; i < end; i++) {
      const d = days[i];
      if (d !== undefined) sum += d.count ?? d.level;
    }
    const perDay = sum / Math.max(1, end - start);
    const bucket = perDay > 12 ? 2 : perDay > 3 ? 1 : 0;
    const degree = -len + [0, 2, 4][bucket]!;
    return {
      step,
      offset: 0,
      degree,
      velocity: clampVelocity(0.3 + bucket * 0.08),
      duration: round6(settings.timeMode === 'day' ? Math.min(7, end - start) : 1),
      voice: 'bass',
      dayIndex: start,
    };
  };

  if (settings.timeMode === 'day') {
    days.forEach((day, i) => {
      if (day.level === 0) return; // rest
      let degree = day.level - 1;
      if (settings.weekdayOctave) degree += len * (Math.floor(weekday(day.date) / 3) - 1);
      if (settings.monthShift) degree += MONTH_DRIFT[monthIndex(day.date)] ?? 0;

      const velocity = clampVelocity(jitterVelocity(VELOCITY_MIN + VELOCITY_SPAN * intensityOf(day, maxCount)));
      events.push({
        step: i,
        offset: round6(Math.max(0, jitterOffset())),
        degree,
        velocity,
        duration: day.level >= 3 ? 0.9 : 0.55,
        voice: 'lead',
        dayIndex: i,
      });
    });

    weekStarts.forEach((start, w) => {
      const end = weekStarts[w + 1] ?? days.length;
      events.push(bassFor(start, start, end));
    });
  } else {
    weekStarts.forEach((start, w) => {
      const end = weekStarts[w + 1] ?? days.length;
      const week = days.slice(start, end);

      // Up to three distinct shades in the week become a chord, lowest first.
      const levels = [...new Set(week.map((d) => d.level).filter((l) => l > 0))].sort((a, b) => a - b).slice(0, 3);
      let weekSum = 0;
      for (const d of week) weekSum += d.count ?? d.level;
      const peak = week.reduce<Day | undefined>((a, b) => ((b.count ?? b.level) > (a?.count ?? -1) ? b : a), undefined);
      const dayIndex = busiestIndex(days, start, end);

      levels.forEach((level, k) => {
        let degree = level - 1;
        if (settings.weekdayOctave && peak !== undefined) {
          degree += len * (Math.floor(weekday(peak.date) / 3) - 1);
        }
        const firstDay = week[0];
        if (settings.monthShift && firstDay !== undefined) degree += MONTH_DRIFT[monthIndex(firstDay.date)] ?? 0;

        const intensity = maxCount > 0 ? Math.log1p(weekSum / 7) / Math.log1p(maxCount) : 0;
        events.push({
          step: w,
          offset: round6(k * 0.05 + Math.max(0, jitterOffset())),
          degree,
          velocity: clampVelocity(jitterVelocity(VELOCITY_MIN + VELOCITY_SPAN * intensity)),
          duration: 0.9,
          voice: 'lead',
          dayIndex,
        });
      });

      events.push(bassFor(w, start, end));
    });
  }

  // Stable order: by step, then offset, then voice. Makes the output byte-comparable.
  events.sort((a, b) =>
    a.step - b.step || a.offset - b.offset || (a.voice === b.voice ? a.degree - b.degree : a.voice === 'bass' ? -1 : 1));

  return events;
}

/** How many steps the piece runs for, given the same settings. */
export function stepCount(days: Day[], rawSettings?: Partial<Settings>): number {
  const settings = normalizeSettings(rawSettings);
  if (days.length === 0) return 0;
  if (settings.timeMode === 'day') return days.length;
  let weeks = 0;
  days.forEach((d, i) => {
    if (i === 0 || weekday(d.date) === 0) weeks++;
  });
  return weeks;
}

/** Seconds per step, from the tempo. One beat per step. */
export function stepDuration(rawSettings?: Partial<Settings>): number {
  const settings = normalizeSettings(rawSettings);
  const perBeat = 60 / settings.tempo;
  return settings.timeMode === 'day' ? perBeat : perBeat * 2;
}

export interface StepInfo {
  /** First day index this step covers. */
  dayStart: number;
  /** One past the last day index this step covers. */
  dayEnd: number;
  /** The day worth naming in the caption: the day itself, or the week's busiest. */
  focusDay: number;
}

/**
 * What each timeline step covers, so the playhead and the caption can agree with the
 * audio without re-deriving week boundaries in the UI.
 */
export function buildSteps(days: Day[], rawSettings?: Partial<Settings>): StepInfo[] {
  const settings = normalizeSettings(rawSettings);
  if (days.length === 0) return [];

  if (settings.timeMode === 'day') {
    return days.map((_, i) => ({ dayStart: i, dayEnd: i + 1, focusDay: i }));
  }

  const starts: number[] = [];
  days.forEach((d, i) => {
    if (i === 0 || weekday(d.date) === 0) starts.push(i);
  });
  return starts.map((start, w) => {
    const end = starts[w + 1] ?? days.length;
    return { dayStart: start, dayEnd: end, focusDay: busiestIndex(days, start, end) };
  });
}

/** The step to seek to when the user clicks a particular day. */
export function dayIndexToStep(days: Day[], dayIndex: number, rawSettings?: Partial<Settings>): number {
  const steps = buildSteps(days, rawSettings);
  if (steps.length === 0) return 0;
  const target = Math.min(days.length - 1, Math.max(0, Math.floor(Number(dayIndex) || 0)));
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (target >= step.dayStart && target < step.dayEnd) return i;
  }
  return Math.max(0, steps.length - 1);
}
