/**
 * The calendar grid: one block per loaded year, each 53-ish columns of seven days, in
 * GitHub's five shades.
 *
 * Built entirely with createElement/textContent. Nothing fetched or typed ever goes near
 * innerHTML, so a crafted username or a crafted JSON file cannot inject markup.
 */

import { buildWeeks, MONTH_SHORT, WEEKDAY_SHORT, toUTCDate } from '../core/calendar.ts';
import { formatDayLong, plural } from '../core/stats.ts';
import type { Day, YearData } from '../core/types.ts';

export interface GridView {
  /** Cell element for each index in the playable day list. */
  cellByDay: Map<number, HTMLButtonElement>;
  /** Column element for each playable day index, for the sweeping highlight. */
  columnByDay: Map<number, HTMLElement>;
  clearPlayhead(): void;
  highlight(dayStart: number, dayEnd: number): void;
}

function cellLabel(day: Day): string {
  const count = day.count;
  const what = count === null ? `shade ${day.level} of 4` : count === 0 ? 'no contributions' : plural(count, 'contribution');
  return `${formatDayLong(day)}, ${what}`;
}

/**
 * `all` is every day of every loaded year (so the grid keeps its shape), `playable` is the
 * days that are actually on the timeline (the current year stops at today).
 */
export function renderGrid(container: HTMLElement, years: YearData[], playable: Day[]): GridView {
  container.replaceChildren();

  const cellByDay = new Map<number, HTMLButtonElement>();
  const columnByDay = new Map<number, HTMLElement>();
  let activeColumns: HTMLElement[] = [];
  let activeCells: HTMLButtonElement[] = [];

  const offsets = new Map<string, number>();
  playable.forEach((day, i) => offsets.set(day.date, i));

  for (const year of years) {
    const block = document.createElement('div');
    block.className = 'grid-block';

    if (years.length > 1) {
      const label = document.createElement('div');
      label.className = 'grid-year';
      label.textContent = String(year.year);
      block.append(label);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', `Contribution calendar for ${year.year}`);

    const weeks = buildWeeks(year.days, playable);
    for (const week of weeks) {
      const column = document.createElement('div');
      column.className = 'col';

      let columnHasDay = false;
      for (let row = 0; row < 7; row++) {
        const cell = week[row]!;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cell';

        if (cell.day === null) {
          button.dataset['empty'] = 'true';
          button.disabled = true;
          button.setAttribute('aria-hidden', 'true');
          button.tabIndex = -1;
        } else if (cell.future) {
          button.dataset['future'] = 'true';
          button.disabled = true;
          button.setAttribute('aria-label', `${formatDayLong(cell.day)}, not yet`);
          button.tabIndex = -1;
        } else {
          const index = offsets.get(cell.day.date);
          button.dataset['level'] = String(cell.day.level);
          button.setAttribute('aria-label', cellLabel(cell.day));
          button.title = cellLabel(cell.day);
          if (index !== undefined) {
            button.dataset['day'] = String(index);
            cellByDay.set(index, button);
            columnByDay.set(index, column);
            columnHasDay = true;
          }
        }
        column.append(button);
      }

      if (columnHasDay) {
        const first = week.find((c) => c.day !== null);
        if (first?.day !== undefined && first.day !== null) {
          const date = toUTCDate(first.day.date);
          column.title = `Week of ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`;
        }
      }
      grid.append(column);
    }

    block.append(grid);

    const rows = document.createElement('div');
    rows.className = 'fine';
    rows.textContent = `Rows run ${WEEKDAY_SHORT[0]} to ${WEEKDAY_SHORT[6]}, top to bottom.`;
    block.append(rows);

    container.append(block);
  }

  function clearPlayhead(): void {
    for (const column of activeColumns) delete column.dataset['active'];
    for (const cell of activeCells) delete cell.dataset['on'];
    activeColumns = [];
    activeCells = [];
  }

  function highlight(dayStart: number, dayEnd: number): void {
    clearPlayhead();
    for (let i = dayStart; i < dayEnd; i++) {
      const cell = cellByDay.get(i);
      if (cell !== undefined) {
        cell.dataset['on'] = 'true';
        activeCells.push(cell);
      }
      const column = columnByDay.get(i);
      if (column !== undefined && !activeColumns.includes(column)) {
        column.dataset['active'] = 'true';
        activeColumns.push(column);
      }
    }
  }

  return { cellByDay, columnByDay, clearPlayhead, highlight };
}
