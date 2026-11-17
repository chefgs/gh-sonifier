/**
 * A console snippet the user can run on their own profile page to produce a JSON file for
 * offline mode. Shown as text only; the extension never executes it.
 */
export const CONSOLE_SNIPPET = [
  '(() => {',
  "  const tips = new Map([...document.querySelectorAll('tool-tip[for]')]",
  "    .map(t => [t.getAttribute('for'), t.textContent.replace(/\\s+/g, ' ').trim()]));",
  "  const days = [...document.querySelectorAll('td.ContributionCalendar-day[data-date]')]",
  '    .map(td => {',
  "      const m = (tips.get(td.id) || '').match(/(No|\\d+)\\s+contributions?\\s+on/i);",
  '      return {',
  '        date: td.dataset.date,',
  '        level: Math.min(4, Math.max(0, Number(td.dataset.level) || 0)),',
  '        count: m ? (/^no$/i.test(m[1]) ? 0 : Number(m[1])) : null',
  '      };',
  '    })',
  '    .sort((a, b) => a.date.localeCompare(b.date));',
  '  copy(JSON.stringify({ days }));',
  "  console.log(days.length + ' days copied');",
  '})();',
].join('\n');
