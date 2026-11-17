/** Date helpers. Everything is UTC, so playback does not change with the viewer's timezone. */

import type { Day } from './types.ts';

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** Parses YYYY-MM-DD without going through the Date string parser. */
export function toUTCDate(iso: string): Date {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

/** 0 = Sunday, matching GitHub's grid rows. */
export function weekday(iso: string): number {
  return toUTCDate(iso).getUTCDay();
}

export function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Drop days after today. The current year is always partial, and playing two months of
 * silence at the end of it is not music.
 */
export function trimToToday(days: Day[], now: Date = new Date()): Day[] {
  const today = todayISO(now);
  return days.filter((d) => d.date <= today);
}

export interface GridCell {
  day: Day | null;
  /** Index into the trimmed day list, or -1 for a day that is not playable. */
  index: number;
  future: boolean;
}

/**
 * Lay days out the way GitHub does: one column per week, seven rows starting on Sunday.
 * `future` cells exist so the current year keeps its full-width grid while only the days
 * up to today are played.
 */
export function buildWeeks(all: Day[], playable: Day[]): GridCell[][] {
  const indexByDate = new Map<string, number>();
  playable.forEach((d, i) => indexByDate.set(d.date, i));

  const weeks: GridCell[][] = [];
  let current: GridCell[] = [];

  const first = all[0];
  if (first === undefined) return weeks;

  // Pad the first column so the calendar starts on the right row.
  for (let i = 0; i < weekday(first.date); i++) current.push({ day: null, index: -1, future: false });

  for (const day of all) {
    const index = indexByDate.get(day.date);
    current.push({ day, index: index ?? -1, future: index === undefined });
    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    while (current.length < 7) current.push({ day: null, index: -1, future: false });
    weeks.push(current);
  }
  return weeks;
}
