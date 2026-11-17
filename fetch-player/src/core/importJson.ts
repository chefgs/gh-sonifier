/**
 * Offline loader. A dropped or pasted file is untrusted input, so it gets the same
 * treatment as scraped HTML: validate every field, clamp every number, keep nothing we
 * do not understand, and never throw.
 *
 * Accepted shapes:
 *   { user, year, total, days: [{ date, level, count }] }   (what this app exports)
 *   { days: [...] }                                         (the console snippet)
 *   [ { date, level, count }, ... ]                         (a bare array of days)
 */

import { isValidDate } from './parse.ts';
import { isValidUsername, clampYear } from './username.ts';
import type { Day, Level, YearData } from './types.ts';

const DAYS_MAX = 20_000;
const TEXT_MAX = 8 * 1024 * 1024;

export type ImportResult =
  | { ok: true; data: YearData; dropped: number }
  | { ok: false; message: string };

function toDay(raw: unknown): Day | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  const date = value['date'];
  if (typeof date !== 'string' || !isValidDate(date)) return null;

  const rawLevel = Number(value['level']);
  const level = (Number.isFinite(rawLevel) ? Math.min(4, Math.max(0, Math.round(rawLevel))) : 0) as Level;

  let count: number | null = null;
  const rawCount = value['count'];
  if (rawCount !== null && rawCount !== undefined && rawCount !== '') {
    const n = Number(rawCount);
    if (Number.isFinite(n) && n >= 0) count = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
  }

  return { date, level, count };
}

/** Parse and validate the text of a JSON file. */
export function importJson(text: unknown): ImportResult {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'That file was empty. Choose a saved contributions JSON file.' };
  }
  if (text.length > TEXT_MAX) {
    return { ok: false, message: 'That file is much larger than a year of contributions. Choose a smaller file.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: 'That file is not valid JSON. Export it again, or paste the output of the console snippet shown below.',
    };
  }

  const container = Array.isArray(parsed) ? { days: parsed } : parsed;
  if (container === null || typeof container !== 'object') {
    return { ok: false, message: 'That JSON does not look like contribution data. It needs a "days" list.' };
  }

  const record = container as Record<string, unknown>;
  const rawDays = record['days'];
  if (!Array.isArray(rawDays)) {
    return { ok: false, message: 'That JSON has no "days" list, so there is nothing to play.' };
  }
  if (rawDays.length === 0) {
    return { ok: false, message: 'That file has an empty "days" list, so there is nothing to play.' };
  }

  const byDate = new Map<string, Day>();
  let dropped = 0;
  for (const entry of rawDays.slice(0, DAYS_MAX)) {
    const day = toDay(entry);
    if (day === null) {
      dropped++;
      continue;
    }
    if (byDate.has(day.date)) {
      dropped++;
      continue;
    }
    byDate.set(day.date, day);
  }
  dropped += Math.max(0, rawDays.length - DAYS_MAX);

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (days.length === 0) {
    return {
      ok: false,
      message: 'None of the entries in that file had a usable date and shade, so there is nothing to play.',
    };
  }

  const rawUser = record['user'];
  const user = typeof rawUser === 'string' && isValidUsername(rawUser) ? rawUser : 'offline';

  const firstDate = days[0]!.date;
  const rawYear = record['year'];
  const year = Number.isFinite(Number(rawYear))
    ? clampYear(rawYear)
    : clampYear(Number(firstDate.slice(0, 4)));

  const summed = days.reduce((acc, d) => acc + (d.count ?? 0), 0);
  const rawTotal = Number(record['total']);
  const total = Number.isFinite(rawTotal) && rawTotal >= 0 ? Math.floor(rawTotal) : summed;

  return { ok: true, data: { user, year, total, days }, dropped };
}

/** What the app writes out, so an exported file can be loaded back in. */
export function exportJson(data: YearData): string {
  return JSON.stringify(
    { user: data.user, year: data.year, total: data.total, days: data.days },
    null,
    2,
  );
}
