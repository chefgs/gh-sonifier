/**
 * A small hand-written scanner for GitHub's contribution calendar HTML.
 *
 * Verified against the live response from
 *   https://github.com/users/<user>/contributions?from=YYYY-01-01&to=YYYY-12-31
 * on 2026-11-14. The shape it relies on:
 *
 *   <td data-date="2026-01-04" data-level="1" id="contribution-day-component-0-1"
 *       class="ContributionCalendar-day" ...>
 *   <tool-tip for="contribution-day-component-0-1">6 contributions on January 4th.</tool-tip>
 *   <h2 id="js-contribution-activity-description">4,317 contributions in 2026</h2>
 *
 * This is scraping, so it can break when GitHub changes its markup. It is written to fail
 * closed and never throw: if no day cells are recognised, the caller gets an error rather
 * than a silently empty year. Attribute values are read quote-aware, so a `>` inside an
 * attribute (GitHub puts a JSON blob and an HMAC on the <table>) cannot end a tag early.
 */

import type { Day, Level, YearData } from './types.ts';

/** Refuse anything far larger than a real response (a real one is ~230 KB). */
const HTML_MAX = 6 * 1024 * 1024;
const TAG_MAX = 400_000;
const ATTRS_PER_TAG_MAX = 64;
const ATTR_VALUE_MAX = 65_536;
const TEXT_MAX = 4096;
const DAYS_MAX = 4000;

/** Only these tags are worth reading; everything else is skipped without allocating. */
const WANTED = new Set(['td', 'tool-tip', 'h2']);

export type ParseResult =
  | { ok: true; data: YearData }
  | { ok: false; error: 'empty' | 'too-large' | 'unrecognised' };

interface OpenTag {
  name: string;
  attrs: Map<string, string>;
  /** Index just past the closing `>`. */
  end: number;
}

function isNameStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/**
 * Read the tag starting at `lt` (the index of `<`). Returns null when this is not a tag
 * open we care to parse; `end` always advances so the caller cannot loop forever.
 */
function readTag(html: string, lt: number): OpenTag | null {
  let i = lt + 1;
  if (i >= html.length) return null;
  if (!isNameStart(html[i]!)) return null; // closing tag, comment, doctype

  let j = i;
  while (j < html.length) {
    const c = html[j]!;
    if (isSpace(c) || c === '>' || c === '/') break;
    j++;
  }
  const name = html.slice(i, j).toLowerCase();
  i = j;

  const attrs = new Map<string, string>();
  const parse = WANTED.has(name);
  let count = 0;

  while (i < html.length) {
    while (i < html.length && isSpace(html[i]!)) i++;
    const c = html[i];
    if (c === undefined) break;
    if (c === '>') { i++; break; }
    if (c === '/') { i++; continue; }

    // Attribute name.
    const nameStart = i;
    while (i < html.length) {
      const d = html[i]!;
      if (isSpace(d) || d === '=' || d === '>' || d === '/') break;
      i++;
    }
    const attrName = html.slice(nameStart, i).toLowerCase();

    while (i < html.length && isSpace(html[i]!)) i++;

    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < html.length && isSpace(html[i]!)) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        i++;
        const close = html.indexOf(q, i);
        const stop = close === -1 ? html.length : close;
        if (stop - i <= ATTR_VALUE_MAX) value = html.slice(i, stop);
        i = close === -1 ? html.length : close + 1;
      } else {
        const valStart = i;
        while (i < html.length) {
          const d = html[i]!;
          if (isSpace(d) || d === '>') break;
          i++;
        }
        if (i - valStart <= ATTR_VALUE_MAX) value = html.slice(valStart, i);
      }
    }

    if (parse && attrName !== '' && count < ATTRS_PER_TAG_MAX) {
      if (!attrs.has(attrName)) attrs.set(attrName, value);
      count++;
    }
  }

  return { name, attrs, end: i };
}

const ENTITIES = new Map([
  ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'],
  ['&#39;', "'"], ['&apos;', "'"], ['&nbsp;', ' '],
]);

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES.get(m) ?? m);
}

/**
 * Text between `from` and the next `</name>`, with nested tags dropped, entities decoded
 * and whitespace collapsed. Returns null when the close tag is missing (truncated input).
 */
function readTextUntilClose(html: string, name: string, from: number): string | null {
  const close = html.toLowerCase().indexOf(`</${name}`, from);
  if (close === -1) return null;
  const raw = html.slice(from, Math.min(close, from + TEXT_MAX));
  // A <script> or <style> block is not text, so drop it whole rather than leaving its
  // source behind once the tags are stripped.
  const withoutCode = raw.replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  return decodeEntities(withoutCode.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * null means "no data-level attribute at all", which is how a day cell is told apart from
 * a legend swatch. An attribute that is present but unreadable becomes level 0: dropping
 * the cell instead would leave a hole in the calendar and shift every later day.
 */
function toLevel(raw: string | undefined): Level | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(4, Math.max(0, Math.round(n))) as Level;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date in ISO form (rejects 2026-02-30). */
export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const COUNT_RE = /^(no|\d{1,15})\s+contributions?\s+on\b/i;

/** `6 contributions on January 4th.` -> 6; `No contributions on ...` -> 0; anything else -> null. */
export function countFromTooltip(text: string): number | null {
  const m = COUNT_RE.exec(text.trim());
  if (!m) return null;
  const head = m[1]!;
  if (/^no$/i.test(head)) return 0;
  const n = Number(head);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
}

const TOTAL_RE = /([\d,]{1,12})\s+contributions?\s+in\s+(\d{4})/i;

export function totalFromHeading(text: string): number | null {
  const m = TOTAL_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export interface ParseOptions {
  user: string;
  year: number;
  /** Drop day cells outside `year`. GitHub does not currently send any, so this is a net. */
  clipToYear?: boolean;
}

/**
 * Parse the contributions fragment. Never throws: malformed, truncated, hostile or
 * unrecognised input comes back as `{ ok: false }`.
 */
export function parseContributions(html: unknown, opts: ParseOptions): ParseResult {
  if (typeof html !== 'string' || html.length === 0) return { ok: false, error: 'empty' };
  if (html.length > HTML_MAX) return { ok: false, error: 'too-large' };

  const cells: { id: string; date: string; level: Level }[] = [];
  const tooltips = new Map<string, string>();
  let headingTotal: number | null = null;

  try {
    let i = 0;
    let tags = 0;
    while (i < html.length && tags < TAG_MAX) {
      const lt = html.indexOf('<', i);
      if (lt === -1) break;
      tags++;

      const tag = readTag(html, lt);
      if (tag === null) {
        i = lt + 1;
        continue;
      }
      i = Math.max(tag.end, lt + 1);

      if (tag.name === 'td') {
        if (cells.length >= DAYS_MAX) continue;
        const date = tag.attrs.get('data-date');
        const level = toLevel(tag.attrs.get('data-level'));
        // Both attributes required: this is what separates day cells from the legend.
        if (date === undefined || level === null) continue;
        if (!isValidDate(date)) continue;
        cells.push({ id: tag.attrs.get('id') ?? '', date, level });
      } else if (tag.name === 'tool-tip') {
        const target = tag.attrs.get('for');
        if (target === undefined || target === '' || tooltips.has(target)) continue;
        if (tooltips.size >= DAYS_MAX) continue;
        const text = readTextUntilClose(html, 'tool-tip', tag.end);
        if (text !== null) tooltips.set(target, text);
      } else if (tag.name === 'h2' && headingTotal === null) {
        const text = readTextUntilClose(html, 'h2', tag.end);
        if (text !== null) headingTotal = totalFromHeading(text);
      }
    }
  } catch {
    // A scanner bug must not take the extension down; fall through to the fail-closed check.
    return { ok: false, error: 'unrecognised' };
  }

  if (cells.length === 0) return { ok: false, error: 'unrecognised' };

  const byDate = new Map<string, Day>();
  for (const cell of cells) {
    if (opts.clipToYear !== false && Number(cell.date.slice(0, 4)) !== opts.year) continue;
    if (byDate.has(cell.date)) continue;
    const tip = cell.id === '' ? undefined : tooltips.get(cell.id);
    byDate.set(cell.date, {
      date: cell.date,
      level: cell.level,
      count: tip === undefined ? null : countFromTooltip(tip),
    });
  }

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (days.length === 0) return { ok: false, error: 'unrecognised' };

  const summed = days.reduce((acc, d) => acc + (d.count ?? 0), 0);

  return {
    ok: true,
    data: { user: opts.user, year: opts.year, total: headingTotal ?? summed, days },
  };
}
