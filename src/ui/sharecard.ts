/**
 * Share card: the grid, the headline numbers and the settings that made the sound, drawn
 * on a canvas and handed back as a PNG blob. No external image, no font download.
 */

import { buildWeeks } from '../core/calendar.ts';
import { SCALE_LABELS } from '../core/scales.ts';
import { midiToName } from '../core/scales.ts';
import { computeStats, formatDayLong } from '../core/stats.ts';
import type { Day, Settings, YearData } from '../core/types.ts';

const WIDTH = 1200;
const HEIGHT = 630;

const SHADES = ['#1d2630', '#0e4429', '#006d32', '#26a641', '#39d353'];

export interface CardInput {
  years: YearData[];
  playable: Day[];
  settings: Settings;
}

function yearLabel(years: YearData[]): string {
  if (years.length === 0) return '';
  if (years.length === 1) return String(years[0]!.year);
  return `${years[0]!.year}–${years.at(-1)!.year}`;
}

export function drawShareCard(canvas: HTMLCanvasElement, input: CardInput): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const all = input.years.flatMap((y) => y.days);
  const stats = computeStats(input.playable);
  const user = input.years[0]?.user ?? 'offline';

  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#e6edf3';
  ctx.font = '600 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(user, 64, 96);

  ctx.fillStyle = '#8b949e';
  ctx.font = '400 24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`${yearLabel(input.years)} as music`, 64, 132);

  // The calendar, scaled so however many years were loaded still fit.
  const blocks = input.years.length;
  const available = 250;
  const cellSize = Math.max(3, Math.min(14, Math.floor((available / blocks - 10) / 7) - 2));
  const gap = cellSize > 7 ? 3 : 1;
  let top = 180;

  for (const year of input.years) {
    const weeks = buildWeeks(year.days, input.playable);
    weeks.forEach((week, columnIndex) => {
      const x = 64 + columnIndex * (cellSize + gap);
      week.forEach((cell, row) => {
        const y = top + row * (cellSize + gap);
        if (cell.day === null) return;
        ctx.fillStyle = cell.future ? '#161b22' : SHADES[cell.day.level] ?? SHADES[0]!;
        ctx.fillRect(x, y, cellSize, cellSize);
      });
    });
    top += 7 * (cellSize + gap) + 12;
  }

  // Headline numbers.
  const tiles: [string, string][] = [
    [stats.total.toLocaleString('en-US'), 'contributions'],
    [String(stats.activeDays), 'active days'],
    [String(stats.busiest?.count ?? 0), 'busiest day'],
    [String(stats.longestStreak), 'longest streak'],
  ];
  const tileY = HEIGHT - 150;
  tiles.forEach(([value, label], i) => {
    const x = 64 + i * 270;
    ctx.fillStyle = '#e6edf3';
    ctx.font = '600 38px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(value, x, tileY);
    ctx.fillStyle = '#8b949e';
    ctx.font = '400 19px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(label, x, tileY + 28);
  });

  // The settings that produced this piece, so the card is reproducible.
  const { settings } = input;
  const recipe = [
    SCALE_LABELS[settings.scale],
    `root ${midiToName(settings.rootMidi)}`,
    `${settings.tempo} BPM`,
    settings.timeMode === 'day' ? 'a note per day' : 'a chord per week',
  ].join(' · ');

  ctx.fillStyle = '#6e7681';
  ctx.font = '400 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText(recipe, 64, HEIGHT - 56);
  if (stats.busiest !== null && (stats.busiest.count ?? 0) > 0) {
    ctx.fillText(`busiest: ${formatDayLong(stats.busiest)}`, 64, HEIGHT - 30);
  }

  ctx.fillStyle = '#484f58';
  ctx.font = '400 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mark = 'Contribution Sonifier';
  ctx.fillText(mark, WIDTH - 64 - ctx.measureText(mark).width, HEIGHT - 30);

  // Guard against an empty load producing a blank card with no explanation.
  if (all.length === 0) {
    ctx.fillStyle = '#8b949e';
    ctx.font = '400 22px system-ui, sans-serif';
    ctx.fillText('No contribution data loaded.', 64, 220);
  }
}

export async function shareCardBlob(input: CardInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  drawShareCard(canvas, input);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
