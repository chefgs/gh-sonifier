/** Derived numbers, shared by the caption line, the stat tiles and the share card. Pure. */

import { MONTH_LONG, WEEKDAY_SHORT, toUTCDate, weekday } from './calendar.ts';
import type { Day } from './types.ts';

export interface Stats {
  total: number;
  activeDays: number;
  busiest: Day | null;
  longestStreak: number;
  currentStreak: number;
}

export function computeStats(days: Day[]): Stats {
  let total = 0;
  let activeDays = 0;
  let busiest: Day | null = null;
  let longestStreak = 0;
  let run = 0;

  for (const day of days) {
    const count = day.count ?? 0;
    total += count;
    const active = day.level > 0 || count > 0;
    if (active) {
      activeDays++;
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
    if (busiest === null || (count > (busiest.count ?? 0))) busiest = day;
  }

  return { total, activeDays, busiest, longestStreak, currentStreak: run };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export function formatDayLong(day: Day): string {
  const d = toUTCDate(day.date);
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${MONTH_LONG[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}, ${d.getUTCFullYear()}`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
}

/** 1-based week of the run, counting the grid columns the way GitHub does. */
export function weekOf(days: Day[], index: number): number {
  let week = 1;
  for (let i = 1; i <= index && i < days.length; i++) {
    const day = days[i];
    if (day !== undefined && weekday(day.date) === 0) week++;
  }
  return week;
}

/**
 * The spoken-caption line, e.g.
 *   "Week 11 - Mon March 9th, 2026 - 124 contributions - busiest day of the year"
 * Written for a screen reader as much as for the eye: the app stays usable with no sound.
 */
export function caption(days: Day[], index: number, stats: Stats): string {
  const day = days[index];
  if (day === undefined) return 'Press play, or choose any day to hear it.';

  const parts = [`Week ${weekOf(days, index)}`, formatDayLong(day)];
  const count = day.count;
  parts.push(count === null ? `shade ${day.level} of 4` : count === 0 ? 'no contributions' : plural(count, 'contribution'));

  if (stats.busiest !== null && stats.busiest.date === day.date && (count ?? 0) > 0) {
    parts.push('busiest day of the year');
  }
  return parts.join(' · ');
}
