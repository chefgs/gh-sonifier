/**
 * Username parsing and upstream URL construction.
 *
 * This is the only place a user-supplied string becomes part of a network request, so
 * it is deliberately strict and deliberately boring: no URL class, no normalisation, no
 * percent-decoding, no unicode folding. Anything that is not plainly a github.com
 * profile reference is rejected with a message the user can act on.
 */

/** GitHub's own rule: 1-39 chars, alphanumeric or single hyphens, no hyphen at either end. */
const USERNAME = /^[A-Za-z0-9](?:-?[A-Za-z0-9])*$/;
export const USERNAME_MAX = 39;

/** Longer than any legitimate input; checked before any regex runs. */
const INPUT_MAX = 400;

/** Printable ASCII only, and no space. Kills unicode lookalikes, newlines and control bytes. */
const SAFE_CHARS = /^[\x21-\x7e]+$/;

/**
 * github.com paths that are site pages, not profiles. Not exhaustive -- GitHub reserves
 * more -- it just turns the most likely mistaken pastes into a useful message instead of
 * a confusing "user not found" later.
 */
const RESERVED = new Set([
  'about', 'apps', 'blog', 'codespaces', 'collections', 'contact', 'customer-stories',
  'dashboard', 'enterprise', 'events', 'explore', 'features', 'home', 'issues', 'join',
  'login', 'logout', 'marketplace', 'new', 'notifications', 'organizations', 'orgs',
  'pricing', 'pulls', 'readme', 'search', 'security', 'session', 'settings', 'signup',
  'site', 'sponsors', 'stars', 'topics', 'trending', 'users', 'watching',
]);

export type UsernameResult =
  | { ok: true; user: string }
  | { ok: false; error: string };

const HOST_PREFIXES = [
  'https://github.com/',
  'https://www.github.com/',
  'github.com/',
  'www.github.com/',
];

/**
 * Accepts a bare username, `github.com/<user>`, or `https://github.com/<user>`, each with
 * an optional trailing slash and an ignored query or fragment. Rejects everything else.
 *
 * Leading and trailing whitespace is trimmed, because pasting a URL commonly brings a
 * newline with it. Whitespace anywhere inside the value is a rejection.
 */
export function parseUsernameInput(raw: unknown): UsernameResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a GitHub username or profile URL.' };

  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: 'Enter a GitHub username or profile URL.' };
  if (trimmed.length > INPUT_MAX) return { ok: false, error: 'That is too long to be a GitHub profile URL.' };
  if (!SAFE_CHARS.test(trimmed)) {
    return {
      ok: false,
      error: 'Use only letters, numbers and hyphens. Spaces and accented or non-Latin characters are not valid in a GitHub username.',
    };
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith('http://')) {
    return { ok: false, error: 'Use the https:// address: https://github.com/<username>' };
  }

  let rest = trimmed;
  let matchedHost = false;
  for (const prefix of HOST_PREFIXES) {
    if (lower.startsWith(prefix)) {
      rest = trimmed.slice(prefix.length);
      matchedHost = true;
      break;
    }
  }

  // A scheme or a host we did not match is some other site. Reject before looking at the path.
  if (!matchedHost && (lower.includes('://') || lower.includes('.') || lower.includes('@'))) {
    return { ok: false, error: 'That is not a github.com profile URL. Use https://github.com/<username>' };
  }

  // Drop an ignored query or fragment.
  const cut = rest.search(/[?#]/);
  if (cut !== -1) rest = rest.slice(0, cut);

  // One optional trailing slash.
  if (rest.endsWith('/')) rest = rest.slice(0, -1);

  if (rest === '') return { ok: false, error: 'That URL has no username in it. Use https://github.com/<username>' };

  if (rest.includes('/')) {
    return {
      ok: false,
      error: 'That looks like a link to a repository or a page inside GitHub. Use just the profile part: https://github.com/<username>',
    };
  }

  if (rest.length > USERNAME_MAX) {
    return { ok: false, error: `GitHub usernames are at most ${USERNAME_MAX} characters.` };
  }

  if (!USERNAME.test(rest)) {
    return {
      ok: false,
      error: 'That is not a valid GitHub username. Usernames use letters, numbers and single hyphens, and cannot start or end with a hyphen.',
    };
  }

  if (RESERVED.has(rest.toLowerCase())) {
    return { ok: false, error: `"${rest}" is a GitHub site page, not a profile. Enter a username.` };
  }

  return { ok: true, user: rest };
}

/** True only for a string that is already a valid username. */
export function isValidUsername(user: unknown): boolean {
  return (
    typeof user === 'string' &&
    user.length > 0 &&
    user.length <= USERNAME_MAX &&
    SAFE_CHARS.test(user) &&
    USERNAME.test(user)
  );
}

/** GitHub launched in 2008; nothing earlier can have contributions. */
export const YEAR_MIN = 2008;

/** Clamp a requested year into the range we are willing to fetch. */
export function clampYear(year: unknown, now: Date = new Date()): number {
  const max = now.getUTCFullYear();
  const n = Math.round(Number(year));
  // NaN has no sensible direction to clamp towards, so fall back to the current year.
  // Infinities do, and Math.min/max handle them, so they clamp to the ends of the range.
  if (Number.isNaN(n)) return max;
  return Math.min(max, Math.max(YEAR_MIN, n));
}

/** Years to offer in the selector, newest first. */
export function availableYears(now: Date = new Date()): number[] {
  const years: number[] = [];
  for (let y = now.getUTCFullYear(); y >= YEAR_MIN; y--) years.push(y);
  return years;
}

export const UPSTREAM_ORIGIN = 'https://github.com';

/**
 * The single upstream URL this project ever requests. Built from a re-validated username
 * and a clamped year, never by concatenating anything the user typed.
 */
export function buildContributionsUrl(user: string, year: number, now: Date = new Date()): string {
  if (!isValidUsername(user)) {
    throw new Error('buildContributionsUrl called with an invalid username');
  }
  const y = clampYear(year, now);
  return `${UPSTREAM_ORIGIN}/users/${user}/contributions?from=${y}-01-01&to=${y}-12-31`;
}
