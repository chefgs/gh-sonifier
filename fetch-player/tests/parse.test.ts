import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countFromTooltip, isValidDate, parseContributions, totalFromHeading } from '../src/core/parse.ts';
import type { Day } from '../src/core/types.ts';

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Every invariant the rest of the app is allowed to rely on. */
function assertWellFormed(days: Day[]): void {
  for (const day of days) {
    assert.ok(isValidDate(day.date), `bad date: ${day.date}`);
    assert.ok(Number.isInteger(day.level), `level not an integer: ${day.level}`);
    assert.ok(day.level >= 0 && day.level <= 4, `level out of range: ${day.level}`);
    if (day.count !== null) {
      assert.ok(Number.isInteger(day.count), `count not an integer: ${day.count}`);
      assert.ok(day.count >= 0, `count negative: ${day.count}`);
    }
  }
  const dates = days.map((d) => d.date);
  assert.deepEqual(dates, [...dates].sort(), 'days are sorted by date');
  assert.equal(new Set(dates).size, dates.length, 'no duplicate dates');
}

test('parses the verified markup shape', () => {
  const r = parseContributions(fixture('valid-small.html'), { user: 'octo-tester', year: 2025 });
  assert.ok(r.ok);
  assertWellFormed(r.data.days);
  assert.equal(r.data.user, 'octo-tester');
  assert.equal(r.data.year, 2025);
  assert.equal(r.data.total, 1234, 'total comes from the heading, commas stripped');
  assert.equal(r.data.days.length, 4, 'legend entries are not days');
  assert.deepEqual(r.data.days, [
    { date: '2025-01-05', level: 0, count: 0 },
    { date: '2025-01-06', level: 2, count: 5 },
    { date: '2025-01-12', level: 4, count: 87 },
    { date: '2025-01-13', level: 1, count: 1 },
  ]);
});

test('an escaped > inside an attribute cannot end the tag early', () => {
  // GitHub puts a JSON blob and an HMAC on the <table>; the fixture also hides a fake
  // day cell inside an attribute value. Neither may become data.
  const r = parseContributions(fixture('script-injected.html'), { user: 'octo-tester', year: 2025 });
  assert.ok(r.ok);
  assertWellFormed(r.data.days);
  const dates = r.data.days.map((d) => d.date);
  assert.deepEqual(dates, ['2025-05-01', '2025-05-02']);
  assert.ok(!dates.includes('1999-01-01'), 'smuggled cell from data-evil was not read');
  assert.ok(!dates.includes('1998-01-01'), 'smuggled cell from title was not read');
  assert.ok(!dates.includes('1997-01-01'), 'a date inside a <script> was not read');
});

test('script and markup inside a tooltip never reaches the count', () => {
  const r = parseContributions(fixture('script-injected.html'), { user: 'octo-tester', year: 2025 });
  assert.ok(r.ok);
  assert.equal(r.data.days[0]!.count, 3, 'an <img onerror> after the number is dropped');
  assert.equal(r.data.days[1]!.count, 9, 'a leading <script> is dropped');
  assert.equal(r.data.total, 7, 'the heading total survives a script tag inside the h2');
  for (const day of r.data.days) {
    assert.ok(!JSON.stringify(day).includes('<'), 'no markup survives into the data');
    assert.ok(!JSON.stringify(day).includes('alert'), 'no script text survives into the data');
  }
});

test('malformed cells are dropped or clamped, never trusted', () => {
  const r = parseContributions(fixture('malformed.html'), { user: 'octo-tester', year: 2025 });
  assert.ok(r.ok);
  assertWellFormed(r.data.days);

  const byDate = new Map(r.data.days.map((d) => [d.date, d]));
  assert.ok(!byDate.has('2025-02-30'), 'February 30th is not a date');
  assert.ok(!byDate.has('not-a-date'));
  assert.equal(byDate.get('2025-03-01')!.level, 4, 'level 99 clamps to 4');
  assert.equal(byDate.get('2025-03-02')!.level, 0, 'level -7 clamps to 0');
  assert.equal(byDate.get('2025-03-03')!.level, 0, 'a non-numeric level is dropped to 0');
  assert.ok(byDate.has('2025-03-03'), 'a day with an unreadable shade is kept, silent');
  assert.ok(!byDate.has('2025-03-04'), 'a cell with no data-level is not a day cell');
  assert.equal(byDate.get('2025-03-05')!.count, 2, 'unquoted attribute values are read');
  assert.equal(byDate.get('2025-03-01')!.count, null, 'a negative tooltip count becomes unknown');
  assert.equal(byDate.get('2025-03-02')!.count, 99999999999999, 'an absurd count is kept as a number, not NaN');
  assert.equal(byDate.get('2025-03-03')!.count, null, 'an unparseable tooltip becomes unknown');
  assert.equal(r.data.total, 99999999999999 + 2, 'an unparseable heading falls back to the sum');
});

test('truncated input yields the days it managed to read', () => {
  const r = parseContributions(fixture('truncated.html'), { user: 'octo-tester', year: 2025 });
  assert.ok(r.ok);
  assertWellFormed(r.data.days);
  assert.equal(r.data.days.length, 2);
  assert.equal(r.data.days[0]!.count, 4);
  assert.equal(r.data.days[1]!.count, null, 'the cut-off cell has no tooltip');
});

test('fails closed when no day cells are recognised', () => {
  for (const name of ['no-days.html']) {
    const r = parseContributions(fixture(name), { user: 'octo-tester', year: 2025 });
    assert.deepEqual(r, { ok: false, error: 'unrecognised' });
  }
});

test('fails closed on empty, non-string and oversized input', () => {
  assert.deepEqual(parseContributions('', { user: 'u', year: 2025 }), { ok: false, error: 'empty' });
  for (const bad of [undefined, null, 0, {}, [], true, Symbol('x')]) {
    assert.deepEqual(parseContributions(bad as unknown, { user: 'u', year: 2025 }), { ok: false, error: 'empty' });
  }
  const huge = '<td data-date="2025-01-01" data-level="1" id="a" class="ContributionCalendar-day"></td>'
    .repeat(100_000); // ~8.6 MB, over the cap
  assert.deepEqual(parseContributions(huge, { user: 'u', year: 2025 }), { ok: false, error: 'too-large' });
});

test('days outside the requested year are clipped', () => {
  const html = `
    <td data-date="2024-12-31" data-level="4" id="a" class="ContributionCalendar-day"></td>
    <td data-date="2025-01-01" data-level="2" id="b" class="ContributionCalendar-day"></td>
    <td data-date="2026-01-01" data-level="3" id="c" class="ContributionCalendar-day"></td>`;
  const r = parseContributions(html, { user: 'u', year: 2025 });
  assert.ok(r.ok);
  assert.deepEqual(r.data.days.map((d) => d.date), ['2025-01-01']);
});

test('never throws, whatever it is handed', () => {
  const inputs = [
    '<', '>', '<<<<<<', '<td', '<td ', '<td data-date', '<td data-date=', '<td data-date="',
    '<td data-date="2025-01-01', '<tool-tip for=', '<tool-tip for="a">', '</td>', '<!--',
    '<!doctype html>', '<td data-date="2025-01-01" data-level="1" id="a">'.repeat(5000),
    '<'.repeat(100_000), '\u0000\u0000\u0000', '\ud800', 'ok'.repeat(50_000),
    '<td ' + 'a='.repeat(50_000) + '>', '<tool-tip for="a">' + 'x'.repeat(200_000),
    '<td data-date="2025-01-01" data-level="1" id="a" ' + 'z="1" '.repeat(500) + '>',
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      const r = parseContributions(input, { user: 'u', year: 2025 });
      if (r.ok) assertWellFormed(r.data.days);
    }, `threw on ${JSON.stringify(input.slice(0, 40))}`);
  }
});

test('fuzz: mutating valid markup never throws and never breaks an invariant', () => {
  const base = fixture('valid-small.html');
  let a = 20261114;
  const rng = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const poison = ['<', '>', '"', "'", '=', '/', '\u0000', 'data-level="9"', 'data-date="x"', '</td>', '<script>'];

  for (let i = 0; i < 600; i++) {
    const cut = Math.floor(rng() * base.length);
    const mode = Math.floor(rng() * 3);
    const chunk = poison[Math.floor(rng() * poison.length)]!;
    const mutated = mode === 0
      ? base.slice(0, cut) // truncate
      : mode === 1
        ? base.slice(0, cut) + chunk + base.slice(cut) // inject
        : base.slice(0, cut) + base.slice(cut + 1 + Math.floor(rng() * 20)); // delete
    assert.doesNotThrow(() => {
      const r = parseContributions(mutated, { user: 'u', year: 2025 });
      if (r.ok) {
        assertWellFormed(r.data.days);
        assert.ok(r.data.total >= 0);
      }
    }, `threw on mutation ${i}`);
  }
});

test('tooltip counts', () => {
  assert.equal(countFromTooltip('No contributions on January 5th.'), 0);
  assert.equal(countFromTooltip('1 contribution on January 13th.'), 1);
  assert.equal(countFromTooltip('87 contributions on January 12th.'), 87);
  assert.equal(countFromTooltip('  124 contributions on March 9th.  '), 124);
  assert.equal(countFromTooltip('no contributions on x'), 0);
  assert.equal(countFromTooltip('-5 contributions on March 1st.'), null);
  assert.equal(countFromTooltip('3.5 contributions on x'), null);
  assert.equal(countFromTooltip('Some unexpected sentence entirely.'), null);
  assert.equal(countFromTooltip(''), null);
  assert.equal(countFromTooltip('12 commits on January 1st.'), null);
  assert.equal(countFromTooltip('99999999 contributions on x'), 99999999);
});

test('heading totals', () => {
  assert.equal(totalFromHeading('4,317 contributions in 2026'), 4317);
  assert.equal(totalFromHeading('1 contribution in 2020'), 1);
  assert.equal(totalFromHeading('0 contributions in 2015'), 0);
  assert.equal(totalFromHeading('not a number contributions in abcd'), null);
  assert.equal(totalFromHeading(''), null);
});

test('date validation rejects impossible dates', () => {
  for (const good of ['2025-01-01', '2024-02-29', '2026-12-31']) assert.ok(isValidDate(good), good);
  for (const bad of [
    '2025-02-30', '2025-13-01', '2025-00-01', '2025-01-00', '2025-01-32', '2023-02-29',
    '2025-1-1', 'x', '', '2025-01-01T00:00:00Z', '20250101', '2025/01/01', '-2025-01-01',
  ]) assert.ok(!isValidDate(bad), bad);
});
