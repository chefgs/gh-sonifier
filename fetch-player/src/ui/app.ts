/**
 * App wiring: input, loading, playback, settings, share card, offline mode.
 *
 * Rules this file sticks to:
 *   - no innerHTML anywhere; all text goes in through textContent
 *   - the AudioContext is created inside a click handler, never before
 *   - the network is only ever reached by asking the service worker
 *   - every failure path ends in a message naming the cause and the next step
 */

import { importJson, exportJson } from '../core/importJson.ts';
import { availableYears, parseUsernameInput } from '../core/username.ts';
import { buildSteps, dayIndexToStep, sonify, stepCount, stepDuration } from '../core/sonify.ts';
import { DEFAULT_SETTINGS, normalizeSettings } from '../core/settings.ts';
import { SCALE_LABELS, midiToName } from '../core/scales.ts';
import { caption, computeStats, formatDayLong } from '../core/stats.ts';
import { trimToToday } from '../core/calendar.ts';
import { createEngine } from '../player/synth.ts';
import { createTransport } from '../player/scheduler.ts';
import { renderGrid } from './grid.ts';
import { shareCardBlob } from './sharecard.ts';
import { CONSOLE_SNIPPET } from './snippet.ts';
import { MESSAGES } from '../ext/protocol.ts';
import type { FetchYearResponse } from '../ext/protocol.ts';
import type { Engine } from '../player/synth.ts';
import type { Transport } from '../player/scheduler.ts';
import type { GridView } from './grid.ts';
import type { Day, ScaleName, Settings, SoundEvent, YearData } from '../core/types.ts';
import type { StepInfo } from '../core/sonify.ts';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element: ${id}`);
  return node as T;
}

const ui = {
  form: el<HTMLFormElement>('load-form'),
  user: el<HTMLInputElement>('user'),
  span: el<HTMLSelectElement>('span'),
  load: el<HTMLButtonElement>('load'),
  loadStatus: el<HTMLParagraphElement>('load-status'),
  years: el<HTMLDivElement>('years'),
  grids: el<HTMLDivElement>('grids'),
  source: el<HTMLParagraphElement>('source'),
  play: el<HTMLButtonElement>('play'),
  stop: el<HTMLButtonElement>('stop'),
  mute: el<HTMLButtonElement>('mute'),
  volume: el<HTMLInputElement>('volume'),
  speed: el<HTMLInputElement>('speed'),
  speedOut: el<HTMLOutputElement>('speed-out'),
  caption: el<HTMLParagraphElement>('caption'),
  seek: el<HTMLInputElement>('seek'),
  scale: el<HTMLSelectElement>('scale'),
  root: el<HTMLSelectElement>('root'),
  mode: el<HTMLSelectElement>('mode'),
  humanize: el<HTMLInputElement>('humanize'),
  weekdayOctave: el<HTMLInputElement>('weekday-octave'),
  monthShift: el<HTMLInputElement>('month-shift'),
  stTotal: el<HTMLSpanElement>('st-total'),
  stActive: el<HTMLSpanElement>('st-active'),
  stActiveSub: el<HTMLSpanElement>('st-active-s'),
  stBest: el<HTMLSpanElement>('st-best'),
  stBestSub: el<HTMLSpanElement>('st-best-s'),
  stStreak: el<HTMLSpanElement>('st-streak'),
  share: el<HTMLButtonElement>('share'),
  export: el<HTMLButtonElement>('export'),
  shareStatus: el<HTMLParagraphElement>('share-status'),
  drop: el<HTMLDivElement>('drop'),
  file: el<HTMLInputElement>('file'),
  paste: el<HTMLTextAreaElement>('paste'),
  pasteLoad: el<HTMLButtonElement>('paste-load'),
  snippet: el<HTMLPreElement>('snippet'),
  copySnippet: el<HTMLButtonElement>('copy-snippet'),
  copyStatus: el<HTMLParagraphElement>('copy-status'),
  offlineStatus: el<HTMLParagraphElement>('offline-status'),
};

interface State {
  years: YearData[];
  playable: Day[];
  events: SoundEvent[];
  steps: StepInfo[];
  settings: Settings;
  selectedYear: number;
  sourceLabel: string;
}

const state: State = {
  years: [],
  playable: [],
  events: [],
  steps: [],
  settings: { ...DEFAULT_SETTINGS },
  selectedYear: availableYears()[0] ?? new Date().getUTCFullYear(),
  sourceLabel: '',
};

let engine: Engine | null = null;
let transport: Transport | null = null;
let view: GridView | null = null;
let frame = 0;
let lastStep = -1;

function setStatus(node: HTMLElement, message: string, kind: 'ok' | 'error' | 'none' = 'none'): void {
  node.textContent = message;
  if (kind === 'none') delete node.dataset['kind'];
  else node.dataset['kind'] = kind;
}

/* ---------- settings ---------- */

function fillSelectors(): void {
  for (const [value, label] of Object.entries(SCALE_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === DEFAULT_SETTINGS.scale) option.selected = true;
    ui.scale.append(option);
  }
  // A sensible range of roots, named so the choice means something musically.
  for (let midi = 45; midi <= 69; midi++) {
    const option = document.createElement('option');
    option.value = String(midi);
    option.textContent = midiToName(midi);
    if (midi === DEFAULT_SETTINGS.rootMidi) option.selected = true;
    ui.root.append(option);
  }
}

function readSettings(): Settings {
  return normalizeSettings({
    scale: ui.scale.value as ScaleName,
    rootMidi: Number(ui.root.value),
    tempo: DEFAULT_SETTINGS.tempo,
    timeMode: ui.mode.value === 'week' ? 'week' : 'day',
    weekdayOctave: ui.weekdayOctave.checked,
    monthShift: ui.monthShift.checked,
    humanize: Number(ui.humanize.value) / 100,
    seed: DEFAULT_SETTINGS.seed,
  });
}

function speedMultiplier(): number {
  // The slider is "steps per second"; one step is 0.5s at the default tempo in day mode.
  const perSecond = Math.max(1, Number(ui.speed.value) || 4);
  return perSecond * stepDuration(state.settings);
}

function updateSpeedLabel(): void {
  const unit = state.settings.timeMode === 'day' ? 'days' : 'weeks';
  ui.speedOut.textContent = `${ui.speed.value} ${unit}/sec`;
}

/* ---------- rebuilding after any change ---------- */

function rebuild(options: { keepPosition?: boolean } = {}): void {
  state.settings = readSettings();
  state.playable = trimToToday(state.years.flatMap((y) => y.days));
  state.events = sonify(state.playable, state.settings);
  state.steps = buildSteps(state.playable, state.settings);

  const total = stepCount(state.playable, state.settings);
  ui.seek.max = String(Math.max(0, total - 1));
  ui.seek.disabled = total === 0;

  const hasData = state.playable.length > 0;
  ui.play.disabled = !hasData;
  ui.stop.disabled = !hasData;
  ui.mute.disabled = !hasData;
  ui.share.disabled = !hasData;
  ui.export.disabled = !hasData;

  view = renderGrid(ui.grids, state.years, state.playable);
  for (const cell of view.cellByDay.values()) {
    cell.addEventListener('click', onCellClick);
  }

  updateStats();
  updateSpeedLabel();

  if (transport !== null) {
    transport.replace(state.events, total);
    transport.setSpeed(speedMultiplier());
    if (options.keepPosition !== true) transport.seekStep(0);
  }

  lastStep = -1;
  if (hasData) showStep(0);
  else {
    setStatus(ui.caption, 'Load a profile, then press play.');
    ui.source.textContent = '';
  }
}

function updateStats(): void {
  const stats = computeStats(state.playable);
  ui.stTotal.textContent = stats.total.toLocaleString('en-US');
  ui.stActive.textContent = String(stats.activeDays);
  ui.stActiveSub.textContent = `of ${state.playable.length} days`;
  ui.stBest.textContent = String(stats.busiest?.count ?? 0);
  ui.stBestSub.textContent = stats.busiest !== null && (stats.busiest.count ?? 0) > 0
    ? formatDayLong(stats.busiest)
    : 'busiest day';
  ui.stStreak.textContent = String(stats.longestStreak);

  if (state.years.length > 0) {
    const first = state.years[0]!;
    const last = state.years.at(-1)!;
    const range = state.years.length === 1 ? String(first.year) : `${first.year}–${last.year}`;
    ui.source.textContent = `${state.sourceLabel} · ${range} · ${state.playable.length} days`;
  }
}

/* ---------- playback ---------- */

function ensureEngine(): Engine {
  if (engine === null) {
    engine = createEngine();
    engine.setVolume(Number(ui.volume.value));
    engine.setMuted(false);
  }
  return engine;
}

function ensureTransport(): Transport {
  const audio = ensureEngine();
  if (transport === null) {
    transport = createTransport({
      engine: audio,
      events: state.events,
      totalSteps: stepCount(state.playable, state.settings),
      stepDuration: stepDuration(state.settings),
      scale: state.settings.scale,
      rootMidi: state.settings.rootMidi,
      onEnded: () => {
        ui.play.textContent = 'Play';
        showStep(0);
      },
    });
    transport.setSpeed(speedMultiplier());
  }
  return transport;
}

function showStep(step: number): void {
  const info = state.steps[step];
  if (info === undefined || view === null) return;
  if (step !== lastStep) {
    view.highlight(info.dayStart, info.dayEnd);
    ui.caption.textContent = caption(state.playable, info.focusDay, computeStats(state.playable));
    lastStep = step;
  }
}

function tick(): void {
  if (transport !== null && transport.isPlaying()) {
    const step = Math.floor(transport.position());
    showStep(Math.min(step, state.steps.length - 1));
    ui.seek.value = String(step);
  }
  frame = requestAnimationFrame(tick);
}

function onCellClick(event: Event): void {
  const target = event.currentTarget as HTMLButtonElement;
  const dayIndex = Number(target.dataset['day']);
  if (!Number.isFinite(dayIndex)) return;
  const step = dayIndexToStep(state.playable, dayIndex, state.settings);
  const player = ensureTransport();
  player.seekStep(step);
  ui.seek.value = String(step);
  showStep(step);
  if (!player.isPlaying()) {
    player.play();
    ui.play.textContent = 'Pause';
  }
}

/* ---------- loading ---------- */

function extensionAvailable(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

async function requestYear(user: string, year: number): Promise<FetchYearResponse> {
  try {
    const response = await chrome.runtime.sendMessage({ kind: 'fetch-year', user, year });
    if (response === null || typeof response !== 'object' || !('ok' in response)) {
      return { ok: false, code: 'upstream', message: MESSAGES['upstream'] };
    }
    return response as FetchYearResponse;
  } catch {
    return {
      ok: false,
      code: 'network',
      message: 'The extension background worker did not answer. Reload this page and try again.',
    };
  }
}

async function load(rawUser: string, endYear: number, span: number): Promise<void> {
  const parsed = parseUsernameInput(rawUser);
  if (!parsed.ok) {
    setStatus(ui.loadStatus, parsed.error, 'error');
    ui.user.focus();
    return;
  }
  if (!extensionAvailable()) {
    setStatus(ui.loadStatus,
      'This page can only fetch from GitHub when it is open as the extension. Use offline mode below to load a saved JSON file.',
      'error');
    return;
  }

  const user = parsed.user;
  const wanted: number[] = [];
  for (let y = endYear - span + 1; y <= endYear; y++) {
    if (y >= 2008) wanted.push(y);
  }

  ui.load.disabled = true;
  setStatus(ui.loadStatus, span === 1 ? 'Reading the contribution graph…' : `Reading ${wanted.length} years…`);

  const loaded: YearData[] = [];
  const failures: string[] = [];
  for (const year of wanted) {
    const response = await requestYear(user, year);
    if (response.ok) loaded.push(response.data);
    else failures.push(`${year}: ${response.message}`);
  }

  ui.load.disabled = false;

  if (loaded.length === 0) {
    setStatus(ui.loadStatus, failures[0] ?? MESSAGES['upstream'], 'error');
    return;
  }

  loaded.sort((a, b) => a.year - b.year);
  state.years = loaded;
  state.sourceLabel = `github.com/${user}`;
  state.selectedYear = endYear;
  renderYearChips();
  rebuild();

  if (failures.length === 0) {
    const count = loaded.reduce((acc, y) => acc + y.days.length, 0);
    setStatus(ui.loadStatus, `Loaded ${count.toLocaleString('en-US')} days. Press play.`, 'ok');
  } else {
    // Partial success: say exactly what is missing rather than failing the whole load.
    setStatus(ui.loadStatus,
      `Loaded ${loaded.length} of ${wanted.length} years. ${failures.join(' ')}`, 'error');
  }
}

function loadOffline(text: string, label: string): void {
  const result = importJson(text);
  if (!result.ok) {
    setStatus(ui.offlineStatus, result.message, 'error');
    return;
  }
  state.years = [result.data];
  state.sourceLabel = label;
  state.selectedYear = result.data.year;
  renderYearChips();
  rebuild();
  const dropped = result.dropped > 0 ? ` ${result.dropped} entries were skipped as unreadable.` : '';
  setStatus(ui.offlineStatus,
    `Loaded ${result.data.days.length} days for ${result.data.year}.${dropped} Press play.`, 'ok');
  setStatus(ui.loadStatus, '');
}

function renderYearChips(): void {
  ui.years.replaceChildren();
  for (const year of availableYears()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'year';
    chip.textContent = String(year);
    chip.setAttribute('aria-pressed', year === state.selectedYear ? 'true' : 'false');
    chip.addEventListener('click', () => {
      state.selectedYear = year;
      renderYearChips();
      const user = ui.user.value.trim();
      if (user === '') {
        setStatus(ui.loadStatus, 'Enter a username above, then choose a year.', 'error');
        return;
      }
      void load(user, year, Number(ui.span.value) || 1);
    });
    ui.years.append(chip);
  }
}

/* ---------- events ---------- */

function wire(): void {
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load(ui.user.value, state.selectedYear, Number(ui.span.value) || 1);
  });

  ui.play.addEventListener('click', () => {
    const player = ensureTransport();
    void ensureEngine().resume();
    const playing = player.toggle();
    ui.play.textContent = playing ? 'Pause' : 'Play';
  });

  ui.stop.addEventListener('click', () => {
    if (transport === null) return;
    transport.pause();
    transport.seekStep(0);
    ui.play.textContent = 'Play';
    ui.seek.value = '0';
    lastStep = -1;
    showStep(0);
  });

  ui.mute.addEventListener('click', () => {
    const audio = ensureEngine();
    audio.setMuted(!audio.isMuted());
    ui.mute.textContent = audio.isMuted() ? 'Unmute' : 'Mute';
  });

  ui.volume.addEventListener('input', () => {
    engine?.setVolume(Number(ui.volume.value));
  });

  ui.speed.addEventListener('input', () => {
    updateSpeedLabel();
    transport?.setSpeed(speedMultiplier());
  });

  ui.seek.addEventListener('input', () => {
    const step = Number(ui.seek.value);
    transport?.seekStep(step);
    lastStep = -1;
    showStep(step);
  });

  for (const control of [ui.scale, ui.root, ui.mode]) {
    control.addEventListener('change', () => rebuild({ keepPosition: true }));
  }
  for (const control of [ui.weekdayOctave, ui.monthShift]) {
    control.addEventListener('change', () => rebuild({ keepPosition: true }));
  }
  ui.humanize.addEventListener('change', () => rebuild({ keepPosition: true }));

  ui.share.addEventListener('click', () => {
    setStatus(ui.shareStatus, 'Drawing the card…');
    void shareCardBlob({ years: state.years, playable: state.playable, settings: state.settings })
      .then((blob) => {
        if (blob === null) {
          setStatus(ui.shareStatus, 'The card could not be drawn in this browser. Try the JSON download instead.', 'error');
          return;
        }
        const name = `${state.years[0]?.user ?? 'contributions'}-${state.years[0]?.year ?? ''}.png`;
        download(blob, name);
        setStatus(ui.shareStatus, `Saved ${name}.`, 'ok');
      })
      .catch(() => {
        setStatus(ui.shareStatus, 'The card could not be saved. Check that downloads are allowed, then try again.', 'error');
      });
  });

  ui.export.addEventListener('click', () => {
    const first = state.years[0];
    if (first === undefined) return;
    const payload = state.years.length === 1
      ? exportJson(first)
      : JSON.stringify({ user: first.user, years: state.years }, null, 2);
    download(new Blob([payload], { type: 'application/json' }), `${first.user}-${first.year}.json`);
    setStatus(ui.shareStatus, 'Saved the JSON. Drop it into offline mode any time.', 'ok');
  });

  ui.drop.addEventListener('click', () => ui.file.click());
  ui.drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      ui.file.click();
    }
  });
  ui.drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    ui.drop.dataset['over'] = 'true';
  });
  ui.drop.addEventListener('dragleave', () => delete ui.drop.dataset['over']);
  ui.drop.addEventListener('drop', (event) => {
    event.preventDefault();
    delete ui.drop.dataset['over'];
    const file = event.dataTransfer?.files?.[0];
    if (file === undefined) {
      setStatus(ui.offlineStatus, 'That drop had no file in it. Try dragging the .json file again.', 'error');
      return;
    }
    void readFile(file);
  });
  ui.file.addEventListener('change', () => {
    const file = ui.file.files?.[0];
    if (file !== undefined) void readFile(file);
  });

  ui.pasteLoad.addEventListener('click', () => {
    const text = ui.paste.value;
    if (text.trim() === '') {
      setStatus(ui.offlineStatus, 'Paste the JSON into the box first, then press this button.', 'error');
      return;
    }
    loadOffline(text, 'pasted JSON');
  });

  ui.copySnippet.addEventListener('click', () => {
    void navigator.clipboard.writeText(CONSOLE_SNIPPET).then(
      () => setStatus(ui.copyStatus, 'Copied.', 'ok'),
      () => setStatus(ui.copyStatus, 'Copying was blocked. Select the snippet above and copy it by hand.', 'error'),
    );
  });

  // Space toggles playback unless the user is typing.
  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ') return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (state.playable.length === 0) return;
    event.preventDefault();
    const playing = ensureTransport().toggle();
    ui.play.textContent = playing ? 'Pause' : 'Play';
  });
}

async function readFile(file: File): Promise<void> {
  if (file.size > 8 * 1024 * 1024) {
    setStatus(ui.offlineStatus, 'That file is far larger than a year of contributions. Choose a smaller file.', 'error');
    return;
  }
  try {
    const text = await file.text();
    loadOffline(text, file.name);
  } catch {
    setStatus(ui.offlineStatus, 'That file could not be read. Check that it is a .json file and try again.', 'error');
  }
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function start(): void {
  fillSelectors();
  ui.snippet.textContent = CONSOLE_SNIPPET;
  renderYearChips();
  wire();
  rebuild();
  frame = requestAnimationFrame(tick);

  if (!extensionAvailable()) {
    setStatus(ui.loadStatus,
      'Opened outside the extension, so GitHub cannot be fetched from here. Offline mode below still works.',
      'error');
  }
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame);
    transport?.dispose();
    void engine?.close();
  });
}

start();
