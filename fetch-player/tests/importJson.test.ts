import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJson, importJson } from '../src/core/importJson.ts';

test('loads the shape this app exports', () => {
  const original = {
    user: 'octo-tester',
    year: 2025,
    total: 42,
    days: [
      { date: '2025-01-01', level: 1, count: 2 },
      { date: '2025-01-02', level: 4, count: 40 },
    ],
  };
  const r = importJson(JSON.stringify(original));
  assert.ok(r.ok);
  assert.deepEqual(r.data, original);
  assert.equal(r.dropped, 0);
  // And a round trip is stable.
  const again = importJson(exportJson(r.data));
  assert.ok(again.ok);
  assert.deepEqual(again.data, r.data);
});

test('loads the console snippet shape and a bare array', () => {
  const days = [{ date: '2025-03-01', level: 2, count: null }];
  for (const text of [JSON.stringify({ days }), JSON.stringify(days)]) {
    const r = importJson(text);
    assert.ok(r.ok);
    assert.equal(r.data.days.length, 1);
    assert.equal(r.data.user, 'offline', 'no username in the file means we do not invent one');
    assert.equal(r.data.year, 2025, 'the year comes from the data');
    assert.equal(r.data.days[0]!.count, null);
  }
});

test('clamps and drops bad entries instead of trusting them', () => {
  const r = importJson(JSON.stringify({
    user: '../evil',
    year: 'not a year',
    total: -5,
    days: [
      { date: '2025-01-01', level: 99, count: -3 },
      { date: '2025-01-02', level: -4, count: '7' },
      { date: '2025-02-30', level: 1, count: 1 },
      { date: 'nope', level: 1, count: 1 },
      { date: '2025-01-01', level: 1, count: 1 },
      { level: 2, count: 2 },
      null,
      'string',
      42,
      { date: '2025-01-03', level: 2, count: 1e308 },
    ],
  }));
  assert.ok(r.ok);
  assert.equal(r.data.user, 'offline', 'a hostile username is replaced, not used');
  assert.ok(r.data.year >= 2008 && r.data.year <= new Date().getUTCFullYear());
  assert.equal(r.data.days.length, 3);
  assert.equal(r.data.days[0]!.level, 4, 'level 99 clamps');
  assert.equal(r.data.days[0]!.count, null, 'a negative count becomes unknown');
  assert.equal(r.data.days[1]!.level, 0, 'a negative level clamps');
  assert.equal(r.data.days[1]!.count, 7, 'a numeric string count is read');
  assert.ok(r.data.days[2]!.count! <= Number.MAX_SAFE_INTEGER, 'an absurd count is capped');
  assert.equal(r.dropped, 7);
  assert.ok(r.data.total >= 0);
});

test('every rejection explains what to do', () => {
  const bad: unknown[] = [
    '', '   ', 'not json', '{', '[', 'null', 'true', '42', '"text"',
    JSON.stringify({}), JSON.stringify({ days: 'nope' }), JSON.stringify({ days: [] }),
    JSON.stringify({ days: [{ date: 'x' }] }), JSON.stringify([null, 1, 'a']),
    undefined, null, 0, {}, [],
  ];
  for (const input of bad) {
    const r = importJson(input as string);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(input)}`);
    if (!r.ok) {
      assert.ok(r.message.length > 25, `too terse: ${r.message}`);
      assert.match(r.message, /[.!]$/, `not a sentence: ${r.message}`);
      assert.ok(!/SyntaxError|JSON\.parse|undefined|position \d+/.test(r.message), `leaks internals: ${r.message}`);
    }
  }
});

test('refuses a file far too large to be a year', () => {
  const r = importJson(`{"days":[${'0,'.repeat(5_000_000)}0]}`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /larger/);
});

test('never throws, and output always satisfies the day invariants', () => {
  const inputs = [
    '{"days":[{"date":"2025-01-01","level":{},"count":[]}]}',
    '{"days":[{"date":"2025-01-01","level":"4","count":"abc"}]}',
    '{"days":{"0":{"date":"2025-01-01","level":1}}}',
    '{"days":[{"date":"2025-01-01","level":1,"count":1,"__proto__":{"polluted":true}}]}',
    '{"days":[{"date":"2025-01-01","level":1}],"user":{"toString":"x"},"year":{},"total":[]}',
    '[[[[[]]]]]', '{"days":[[]]}', '{"days":[1e309]}',
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => {
      const r = importJson(input);
      if (r.ok) {
        for (const day of r.data.days) {
          assert.ok(day.level >= 0 && day.level <= 4);
          assert.ok(day.count === null || day.count >= 0);
          assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }, `threw on ${input}`);
  }
  // Prototype pollution via a crafted key must not touch Object.prototype.
  importJson('{"days":[{"date":"2025-01-01","level":1,"count":1}],"__proto__":{"polluted":true}}');
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
});
