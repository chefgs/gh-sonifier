import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sonify, stepCount, stepDuration, VELOCITY_MAX } from '../src/core/sonify.ts';
import { degreeToMidi, pitchClassesInScale, SCALE_STEPS, scaleLength } from '../src/core/scales.ts';
import { DEFAULT_SETTINGS, normalizeSettings, TEMPO_MAX, TEMPO_MIN } from '../src/core/settings.ts';
import { trimToToday, buildWeeks, weekday } from '../src/core/calendar.ts';
import { computeStats, caption, weekOf } from '../src/core/stats.ts';
import type { Day, ScaleName, Settings } from '../src/core/types.ts';

const SCALES: ScaleName[] = ['minorPentatonic', 'majorPentatonic', 'dorian', 'hirajoshi'];

/** A deterministic pseudo-year, so the tests do not depend on anyone's real data. */
function makeYear(year = 2025, days = 365, seed = 42): Day[] {
  let a = seed >>> 0;
  const rng = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Day[] = [];
  const start = Date.UTC(year, 0, 1);
  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const r = rng();
    const level = r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 4;
    out.push({ date, level: level as Day['level'], count: level === 0 ? 0 : Math.ceil(r * 40) });
  }
  return out;
}

test('same days and settings produce byte-identical events', () => {
  const days = makeYear();
  for (const scale of SCALES) {
    for (const timeMode of ['day', 'week'] as const) {
      for (const humanize of [0, 0.5, 1]) {
        const settings: Settings = { ...DEFAULT_SETTINGS, scale, timeMode, humanize, seed: 1234 };
        const a = JSON.stringify(sonify(days, settings));
        const b = JSON.stringify(sonify(days, settings));
        const c = JSON.stringify(sonify(structuredClone(days), { ...settings }));
        assert.equal(a, b, `${scale}/${timeMode}/${humanize} not stable across calls`);
        assert.equal(a, c, `${scale}/${timeMode}/${humanize} not stable across equal inputs`);
      }
    }
  }
});

test('a different seed changes humanised output but not unhumanised output', () => {
  const days = makeYear();
  const plain1 = JSON.stringify(sonify(days, { ...DEFAULT_SETTINGS, humanize: 0, seed: 1 }));
  const plain2 = JSON.stringify(sonify(days, { ...DEFAULT_SETTINGS, humanize: 0, seed: 999 }));
  assert.equal(plain1, plain2, 'with no humanisation the seed is irrelevant');

  const h1 = JSON.stringify(sonify(days, { ...DEFAULT_SETTINGS, humanize: 1, seed: 1 }));
  const h2 = JSON.stringify(sonify(days, { ...DEFAULT_SETTINGS, humanize: 1, seed: 999 }));
  assert.notEqual(h1, h2, 'humanisation should follow the seed');
});

test('every pitch lands on the chosen scale', () => {
  const days = makeYear();
  for (const scale of SCALES) {
    const allowed = pitchClassesInScale(DEFAULT_SETTINGS.rootMidi, scale);
    for (const timeMode of ['day', 'week'] as const) {
      for (const weekdayOctave of [false, true]) {
        for (const monthShift of [false, true]) {
          const events = sonify(days, { ...DEFAULT_SETTINGS, scale, timeMode, weekdayOctave, monthShift });
          assert.ok(events.length > 0);
          for (const e of events) {
            const midi = degreeToMidi(e.degree, DEFAULT_SETTINGS.rootMidi, scale);
            assert.ok(Number.isInteger(midi), `non-integer midi ${midi}`);
            assert.ok(allowed.has(((midi % 12) + 12) % 12),
              `${scale}: midi ${midi} (degree ${e.degree}) is not in the scale`);
            // And stay inside the range of human hearing we actually synthesise.
            assert.ok(midi >= 12 && midi <= 120, `midi out of range: ${midi}`);
          }
        }
      }
    }
  }
});

test('degreeToMidi wraps octaves instead of running off the end of the table', () => {
  for (const scale of SCALES) {
    const len = scaleLength(scale);
    const steps = SCALE_STEPS[scale];
    for (let d = -3 * len; d <= 3 * len; d++) {
      const midi = degreeToMidi(d, 60, scale);
      assert.ok(Number.isFinite(midi), `degree ${d} gave ${midi}`);
      const octave = Math.floor(d / len);
      assert.equal(midi, 60 + 12 * octave + steps[d - octave * len]!);
    }
    assert.equal(degreeToMidi(0, 60, scale), 60, 'degree 0 is the root');
    assert.equal(degreeToMidi(len, 60, scale), 72, 'a full scale up is an octave up');
    assert.equal(degreeToMidi(-len, 60, scale), 48, 'a full scale down is an octave down');
  }
});

test('velocity never exceeds the cap, in any configuration', () => {
  const extreme: Day[] = [
    { date: '2025-01-01', level: 4, count: 10_000_000 },
    { date: '2025-01-02', level: 4, count: Number.MAX_SAFE_INTEGER },
    { date: '2025-01-03', level: 0, count: 0 },
    { date: '2025-01-04', level: 2, count: null },
    { date: '2025-01-05', level: 4, count: 1 },
  ];
  for (const days of [makeYear(), extreme]) {
    for (const timeMode of ['day', 'week'] as const) {
      for (const humanize of [0, 0.25, 0.5, 1]) {
        for (const e of sonify(days, { ...DEFAULT_SETTINGS, timeMode, humanize })) {
          assert.ok(e.velocity >= 0, `negative velocity ${e.velocity}`);
          assert.ok(e.velocity <= VELOCITY_MAX, `velocity ${e.velocity} over cap ${VELOCITY_MAX}`);
          assert.ok(Number.isFinite(e.velocity));
          assert.ok(e.offset >= 0 && e.offset < 1, `offset out of a step: ${e.offset}`);
          assert.ok(e.duration > 0 && e.duration <= 7, `duration out of range: ${e.duration}`);
        }
      }
    }
  }
});

test('level 0 is a rest: no lead note is ever emitted for an empty day', () => {
  const days = makeYear();
  const events = sonify(days, { ...DEFAULT_SETTINGS, timeMode: 'day' });
  const leadSteps = new Set(events.filter((e) => e.voice === 'lead').map((e) => e.step));
  days.forEach((day, i) => {
    if (day.level === 0) assert.ok(!leadSteps.has(i), `empty day ${day.date} produced a note`);
  });
  const expected = days.filter((d) => d.level > 0).length;
  assert.equal(events.filter((e) => e.voice === 'lead').length, expected);
});

test('a darker green is a lower note', () => {
  const days: Day[] = [
    { date: '2025-01-01', level: 1, count: 1 },
    { date: '2025-01-02', level: 2, count: 1 },
    { date: '2025-01-03', level: 3, count: 1 },
    { date: '2025-01-04', level: 4, count: 1 },
  ];
  const lead = sonify(days, { ...DEFAULT_SETTINGS, timeMode: 'day' })
    .filter((e) => e.voice === 'lead')
    .sort((a, b) => a.step - b.step);
  const pitches = lead.map((e) => degreeToMidi(e.degree, DEFAULT_SETTINGS.rootMidi, DEFAULT_SETTINGS.scale));
  assert.deepEqual(pitches, [...pitches].sort((a, b) => a - b), 'levels 1-4 ascend');
  assert.equal(new Set(pitches).size, 4, 'four distinct pitches');
});

test('a busier day is louder than a quiet day of the same shade', () => {
  const days: Day[] = [
    { date: '2025-01-01', level: 2, count: 1 },
    { date: '2025-01-02', level: 2, count: 50 },
  ];
  const lead = sonify(days, { ...DEFAULT_SETTINGS, timeMode: 'day' }).filter((e) => e.voice === 'lead');
  assert.equal(lead.length, 2);
  assert.ok(lead[1]!.velocity > lead[0]!.velocity, 'count should raise velocity');
  assert.equal(lead[0]!.degree, lead[1]!.degree, 'but not change the pitch');
});

test('empty input produces no events and no crash', () => {
  for (const timeMode of ['day', 'week'] as const) {
    assert.deepEqual(sonify([], { ...DEFAULT_SETTINGS, timeMode }), []);
    assert.equal(stepCount([], { ...DEFAULT_SETTINGS, timeMode }), 0);
  }
});

test('timeline length matches the mode', () => {
  const days = makeYear(2025, 365);
  assert.equal(stepCount(days, { ...DEFAULT_SETTINGS, timeMode: 'day' }), 365);
  const weeks = stepCount(days, { ...DEFAULT_SETTINGS, timeMode: 'week' });
  assert.ok(weeks >= 52 && weeks <= 54, `unexpected week count ${weeks}`);
  for (const e of sonify(days, { ...DEFAULT_SETTINGS, timeMode: 'week' })) {
    assert.ok(e.step < weeks, `step ${e.step} past the end of ${weeks} weeks`);
    assert.ok(e.dayIndex >= 0 && e.dayIndex < days.length, `dayIndex out of range: ${e.dayIndex}`);
  }
});

test('every event points at a real day', () => {
  const days = makeYear();
  for (const timeMode of ['day', 'week'] as const) {
    for (const e of sonify(days, { ...DEFAULT_SETTINGS, timeMode })) {
      assert.ok(days[e.dayIndex] !== undefined, `dayIndex ${e.dayIndex} has no day`);
    }
  }
});

test('events come out in a stable, sorted order', () => {
  const events = sonify(makeYear(), DEFAULT_SETTINGS);
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const cur = events[i]!;
    assert.ok(prev.step < cur.step || (prev.step === cur.step && prev.offset <= cur.offset),
      `events out of order at ${i}`);
  }
});

test('settings are clamped, so hostile values cannot reach the audio graph', () => {
  const hostile = {
    scale: 'evil' as unknown as ScaleName,
    rootMidi: 9999,
    tempo: 100000,
    timeMode: 'forever' as unknown as 'day',
    weekdayOctave: 'yes' as unknown as boolean,
    monthShift: 1 as unknown as boolean,
    humanize: 50,
    seed: -1e30,
  };
  const s = normalizeSettings(hostile);
  assert.equal(s.scale, DEFAULT_SETTINGS.scale);
  assert.ok(s.rootMidi >= 21 && s.rootMidi <= 96);
  assert.ok(s.tempo >= TEMPO_MIN && s.tempo <= TEMPO_MAX);
  assert.equal(s.timeMode, 'day');
  assert.equal(s.weekdayOctave, false, 'only a real boolean turns a flag on');
  assert.equal(s.monthShift, false);
  assert.ok(s.humanize >= 0 && s.humanize <= 1);
  assert.ok(s.seed >= 0 && Number.isInteger(s.seed));

  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  for (const tempo of [0, -1, NaN, Infinity, 1e9]) {
    const t = normalizeSettings({ tempo }).tempo;
    assert.ok(t >= TEMPO_MIN && t <= TEMPO_MAX, `tempo ${tempo} became ${t}`);
  }
});

test('step duration follows the tempo', () => {
  assert.equal(stepDuration({ ...DEFAULT_SETTINGS, tempo: 120, timeMode: 'day' }), 0.5);
  assert.equal(stepDuration({ ...DEFAULT_SETTINGS, tempo: 60, timeMode: 'day' }), 1);
  assert.ok(stepDuration({ ...DEFAULT_SETTINGS, tempo: 1e9 }) > 0, 'a clamped tempo still has a duration');
});

test('the current year stops at today', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const days: Day[] = [
    { date: '2026-11-13', level: 2, count: 4 },
    { date: '2026-11-14', level: 1, count: 1 },
    { date: '2026-11-15', level: 0, count: 0 },
    { date: '2026-12-31', level: 0, count: 0 },
  ];
  const playable = trimToToday(days, now);
  assert.deepEqual(playable.map((d) => d.date), ['2026-11-13', '2026-11-14']);

  // The grid still shows the rest of the year, marked as future.
  const weeks = buildWeeks(days, playable);
  const cells = weeks.flat().filter((c) => c.day !== null);
  assert.equal(cells.filter((c) => c.future).length, 2);
  assert.equal(cells.filter((c) => !c.future).length, 2);
  for (const cell of cells) {
    assert.equal(cell.future, cell.index === -1, 'a future day has no place on the timeline');
  }
});

test('the grid starts on the right weekday and is always seven rows', () => {
  const days = makeYear(2025, 365);
  const weeks = buildWeeks(days, days);
  for (const week of weeks) assert.equal(week.length, 7, 'every column has seven rows');
  const firstReal = weeks[0]!.findIndex((c) => c.day !== null);
  assert.equal(firstReal, weekday('2025-01-01'), 'padding puts Jan 1st on its real weekday');
  const flat = weeks.flat().filter((c) => c.day !== null);
  assert.equal(flat.length, days.length, 'no day is lost or duplicated by the layout');
  assert.deepEqual(flat.map((c) => c.day!.date), days.map((d) => d.date), 'order is preserved');
});

test('stats and captions describe the data without sound', () => {
  const days: Day[] = [
    { date: '2025-01-01', level: 1, count: 2 },
    { date: '2025-01-02', level: 4, count: 30 },
    { date: '2025-01-03', level: 0, count: 0 },
    { date: '2025-01-04', level: 2, count: 5 },
    { date: '2025-01-05', level: 2, count: 5 },
  ];
  const stats = computeStats(days);
  assert.equal(stats.total, 42);
  assert.equal(stats.activeDays, 4);
  assert.equal(stats.busiest!.date, '2025-01-02');
  assert.equal(stats.longestStreak, 2);
  assert.equal(stats.currentStreak, 2);

  assert.match(caption(days, 1, stats), /Week 1/);
  assert.match(caption(days, 1, stats), /30 contributions/);
  assert.match(caption(days, 1, stats), /busiest day of the year/);
  assert.match(caption(days, 2, stats), /no contributions/);
  assert.match(caption(days, 999, stats), /Press play/);
  assert.match(caption([{ date: '2025-01-01', level: 3, count: null }], 0, stats), /shade 3 of 4/);

  const year = makeYear(2025, 365);
  assert.equal(weekOf(year, 0), 1);
  assert.ok(weekOf(year, 364) >= 52, 'the last day is in the last week');
  for (let i = 0; i < year.length; i++) {
    const w = weekOf(year, i);
    assert.ok(w >= 1 && w <= 54, `week ${w} out of range at day ${i}`);
  }
});

test('an empty year is handled everywhere', () => {
  const stats = computeStats([]);
  assert.deepEqual(stats, { total: 0, activeDays: 0, busiest: null, longestStreak: 0, currentStreak: 0 });
  assert.deepEqual(buildWeeks([], []), []);
  assert.match(caption([], 0, stats), /Press play/);
});

test('steps cover every day exactly once, in both modes', async () => {
  const { buildSteps, dayIndexToStep } = await import('../src/core/sonify.ts');
  const days = makeYear(2025, 365);
  for (const timeMode of ['day', 'week'] as const) {
    const settings = { ...DEFAULT_SETTINGS, timeMode };
    const steps = buildSteps(days, settings);
    assert.equal(steps.length, stepCount(days, settings), 'one step per timeline position');

    let covered = 0;
    steps.forEach((step, i) => {
      assert.ok(step.dayEnd > step.dayStart, `empty step at ${i}`);
      assert.ok(step.focusDay >= step.dayStart && step.focusDay < step.dayEnd, 'focus day inside the step');
      if (i > 0) assert.equal(step.dayStart, steps[i - 1]!.dayEnd, 'steps are contiguous');
      covered += step.dayEnd - step.dayStart;
    });
    assert.equal(covered, days.length, 'every day is covered once');
    assert.equal(steps[0]!.dayStart, 0);
    assert.equal(steps.at(-1)!.dayEnd, days.length);

    // Clicking any day seeks to the step that contains it.
    for (let i = 0; i < days.length; i++) {
      const step = dayIndexToStep(days, i, settings);
      assert.ok(i >= steps[step]!.dayStart && i < steps[step]!.dayEnd, `day ${i} mapped to step ${step}`);
    }
    // Out-of-range clicks are clamped, not crashes.
    assert.equal(dayIndexToStep(days, -5, settings), 0);
    assert.equal(dayIndexToStep(days, 99999, settings), steps.length - 1);
  }
  assert.deepEqual(buildSteps([], DEFAULT_SETTINGS), []);
});
