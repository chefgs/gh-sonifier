import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableYears, buildContributionsUrl, clampYear, isValidUsername,
  parseUsernameInput, UPSTREAM_ORIGIN, YEAR_MIN,
} from '../src/core/username.ts';

const ACCEPTED: [string, string][] = [
  ['octocat', 'octocat'],
  ['a', 'a'],
  ['a-b', 'a-b'],
  ['octo-tester', 'octo-tester'],
  ['0abc9', '0abc9'],
  ['a'.repeat(39), 'a'.repeat(39)],
  ['https://github.com/octocat', 'octocat'],
  ['https://github.com/octocat/', 'octocat'],
  ['https://www.github.com/octocat', 'octocat'],
  ['github.com/octocat', 'octocat'],
  ['www.github.com/octocat', 'octocat'],
  ['https://github.com/octocat?tab=repositories', 'octocat'],
  ['https://github.com/octocat#readme', 'octocat'],
  ['https://github.com/octocat/?tab=overview&foo=bar', 'octocat'],
  ['HTTPS://GITHUB.COM/octocat', 'octocat'],
  ['  https://github.com/octocat\n', 'octocat'],
];

test('accepts bare usernames and github.com profile URLs', () => {
  for (const [input, expected] of ACCEPTED) {
    const r = parseUsernameInput(input);
    assert.deepEqual(r, { ok: true, user: expected }, `should accept ${JSON.stringify(input)}`);
  }
});

const REJECTED = [
  // The explicit list from the brief.
  '../', '../../etc/passwd', '..', '.', './octocat',
  '@evil.com', 'octocat@evil.com',
  'https://github.com/octocat%2F..%2Fsettings',
  'https://github.com%2Fevil.com/octocat',
  '%2e%2e%2f', 'octo%2Fcat', 'octocat%00',
  'оctocat', // Cyrillic о
  'octocаt', // Cyrillic а
  'ＧitHub', 'octocat​', 'café',
  'octo cat', ' ', '\n', '\t', 'octo\ncat', 'octo\tcat', 'octo\rcat',
  'a'.repeat(40), 'a'.repeat(400), 'a'.repeat(5000),
  'github.com.evil.com', 'https://github.com.evil.com/octocat',
  'https://evil.com/octocat', 'https://gitlab.com/octocat',
  'https://evil.com/github.com/octocat', 'https://notgithub.com/octocat',
  'http://github.com/octocat',
  'ftp://github.com/octocat',
  'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'https://github.com/', 'https://github.com', 'github.com/',
  'https://github.com/octocat/hello-world',
  'https://github.com/orgs/github/people',
  'https://github.com/settings', 'settings', 'notifications', 'explore',
  '-octocat', 'octocat-', '-', 'octo--cat', 'oct--o-cat',
  'octo_cat', 'octo.cat', 'octo/cat', 'octo\\cat', 'octo:cat',
  'octo<cat>', '<script>', 'octo"cat', "octo'cat",
  '', '   ',
];

test('rejects traversal, other hosts, lookalikes, whitespace and overlong input', () => {
  for (const input of REJECTED) {
    const r = parseUsernameInput(input);
    assert.equal(r.ok, false, `should reject ${JSON.stringify(input)}`);
    if (!r.ok) {
      assert.ok(r.error.length > 0, 'rejection carries a message');
      // User-facing errors must say something, not just "invalid".
      assert.ok(!/^(error|invalid|invalid input)\.?$/i.test(r.error), `message too generic: ${r.error}`);
    }
  }
});

test('rejects non-string input', () => {
  for (const input of [undefined, null, 0, 1, {}, [], true, Symbol('x'), () => 'octocat', NaN]) {
    assert.equal(parseUsernameInput(input as unknown).ok, false);
  }
});

test('every rejection message is actionable', () => {
  const seen = new Set<string>();
  for (const input of REJECTED) {
    const r = parseUsernameInput(input);
    if (!r.ok) seen.add(r.error);
  }
  for (const message of seen) {
    assert.ok(message.length >= 20, `too terse: ${message}`);
    assert.ok(/[.:]$|>$/.test(message.trim()), `should read as a sentence: ${message}`);
    // No stack frames, no raw validator or engine wording leaking to the user.
    assert.ok(!/\bat [\w.$]+ \(|TypeError|ReferenceError|undefined|\bnull\b|Expected string|\bRequired\b/.test(message),
      `leaks internals: ${message}`);
  }
});

// A valid username can only ever be made of these characters.
const SAFE = /^[A-Za-z0-9-]{1,39}$/;

test('fuzz: any accepted value is a plain safe username', () => {
  const alphabet = [
    'a', 'Z', '0', '9', '-', '_', '.', '/', '\\', '%', '2F', ':', '@', ' ', '\n', '\t',
    '..', '<', '>', '"', "'", '&', '?', '#', 'о', 'é', '​', '\u0000', 'github.com',
    'https://', 'http://', 'evil.com', 'octocat', 'www.',
  ];
  const rng = mulberry32(20261114);
  for (let i = 0; i < 20000; i++) {
    const pieces = 1 + Math.floor(rng() * 5);
    let input = '';
    for (let p = 0; p < pieces; p++) {
      input += alphabet[Math.floor(rng() * alphabet.length)]!;
    }
    const r = parseUsernameInput(input);
    if (r.ok) {
      assert.match(r.user, SAFE, `accepted unsafe value from ${JSON.stringify(input)}`);
      assert.ok(isValidUsername(r.user));
      // And the URL it produces must still point at github.com.
      const url = buildContributionsUrl(r.user, 2025);
      assert.ok(url.startsWith(`${UPSTREAM_ORIGIN}/users/`), url);
      assert.equal(new URL(url).origin, UPSTREAM_ORIGIN, url);
    }
  }
});

test('fuzz: the validator never throws', () => {
  const rng = mulberry32(7);
  const chars = '\u0000\n\t %/\\.@-:<>"\'&?#abzAZ09оé​';
  for (let i = 0; i < 20000; i++) {
    const n = Math.floor(rng() * 50);
    let input = '';
    for (let k = 0; k < n; k++) input += chars[Math.floor(rng() * chars.length)]!;
    assert.doesNotThrow(() => parseUsernameInput(input));
  }
});

test('the upstream URL is always a github.com user contributions URL', () => {
  const hostile = [
    'octocat', 'a', 'a'.repeat(39), '0', 'a-b-c', 'octo-tester',
  ];
  for (const user of hostile) {
    const url = buildContributionsUrl(user, 2025);
    assert.equal(url, `https://github.com/users/${user}/contributions?from=2025-01-01&to=2025-12-31`);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'github.com');
    assert.equal(parsed.port, '');
    assert.equal(parsed.username, '');
    assert.equal(parsed.password, '');
    assert.equal(parsed.pathname, `/users/${user}/contributions`);
  }
});

test('buildContributionsUrl refuses anything the validator did not accept', () => {
  const hostile = [
    '../settings', 'octo/cat', 'octo cat', '', '-x', 'x-', 'a'.repeat(40),
    'octo%2Fcat', 'evil.com', 'оctocat', 'octo\ncat', 'octo?x=1', 'octo#f',
    'octo@evil.com', 'a'.repeat(5000),
  ];
  for (const user of hostile) {
    assert.throws(() => buildContributionsUrl(user, 2025), /invalid username/, `allowed ${JSON.stringify(user)}`);
  }
  for (const user of [undefined, null, 0, {}, [], true]) {
    assert.throws(() => buildContributionsUrl(user as unknown as string, 2025));
  }
});

test('the year is clamped into a range we are willing to fetch', () => {
  const now = new Date('2026-11-14T00:00:00Z');
  assert.equal(clampYear(2026, now), 2026);
  assert.equal(clampYear(2008, now), 2008);
  assert.equal(clampYear(2007, now), YEAR_MIN);
  assert.equal(clampYear(1900, now), YEAR_MIN);
  assert.equal(clampYear(9999, now), 2026);
  assert.equal(clampYear(Infinity, now), 2026);
  assert.equal(clampYear(-Infinity, now), YEAR_MIN);
  assert.equal(clampYear(NaN, now), 2026);
  assert.equal(clampYear('2020', now), 2020);
  assert.equal(clampYear('2020; DROP TABLE', now), 2026);
  assert.equal(clampYear(null, now), YEAR_MIN);
  assert.equal(clampYear(undefined, now), 2026);
  assert.equal(clampYear({}, now), 2026);
});

test('a clamped year always lands in the URL as a plain ISO range', () => {
  const now = new Date('2026-11-14T00:00:00Z');
  for (const year of [2007, 9999, NaN, Infinity, -1, 2026.7] as unknown[]) {
    const url = buildContributionsUrl('octocat', year as number, now);
    assert.match(url, /^https:\/\/github\.com\/users\/octocat\/contributions\?from=\d{4}-01-01&to=\d{4}-12-31$/, url);
    const y = Number(new URL(url).searchParams.get('from')!.slice(0, 4));
    assert.ok(y >= YEAR_MIN && y <= 2026, `year out of range: ${y}`);
  }
});

test('the year selector runs from this year back to 2008', () => {
  const years = availableYears(new Date('2026-11-14T00:00:00Z'));
  assert.equal(years[0], 2026);
  assert.equal(years.at(-1), YEAR_MIN);
  assert.equal(years.length, 2026 - YEAR_MIN + 1);
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
