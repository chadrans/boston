// Applies a forecast update (the body of a GitHub issue) to site/data.json.
// Reads the body from ISSUE_BODY. On success prints a summary; otherwise prints
// the problem to stderr and exits 1.
//
//   date: 2026-10-13                                  optional, defaults to today
//   estimate: 48                                      0 to 100
//   range: 35-55                                      realistic floor and ceiling
//   moment: 2026-10-10 to 2026-10-12 | Seaport day    optional, repeatable
//
// A body with only moment lines adds moments without touching the estimate.
// Several updates can share a date and keep the order they arrive in; sending
// an identical update twice (say, after editing the issue) adds it once.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = process.argv[2] ?? fileURLToPath(new URL('../site/data.json', import.meta.url));
const DAY = 86400000;
const RANGE = /^(\d+(?:\.\d+)?)\s*%?\s*(?:-|to|\u2013|\u2014)\s*(\d+(?:\.\d+)?)\s*%?$/i;
const DATES = /^(\d{4}-\d{2}-\d{2})(?:\s*(?:to|-|\u2013|\u2014|\.\.)\s*(\d{4}-\d{2}-\d{2}))?$/i;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Indiana/Indianapolis' }).format(new Date());
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

function checkDate(s, what, future = false) {
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) {
    fail(`${what} "${s}" isn't a real date. Use YYYY-MM-DD.`);
  }
  if (!future && s > tomorrow) fail(`${what} ${s} is in the future.`);
  return s;
}

function percent(v, what) {
  const n = Number(String(v).replace('%', '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) fail(`${what} "${v}" has to be a number from 0 to 100.`);
  return Math.round(n * 10) / 10;
}

function serialize(data) {
  const list = arr => (arr.length ? `[\n${arr.map(o => `    ${JSON.stringify(o)}`).join(',\n')}\n  ]` : '[]');
  return `{\n  "updates": ${list(data.updates)},\n  "moments": ${list(data.moments)}\n}\n`;
}

let date, estimate, range;
const momentLines = [];
for (const raw of (process.env.ISSUE_BODY ?? '').split(/\r?\n/)) {
  const line = raw.replace(/^[\s>*-]+/, '').replace(/\*\*|`/g, '').trim();
  const m = line.match(/^([a-z ]+?)\s*[:=]\s*(.+)$/i);
  if (!m) continue;
  const key = m[1].trim().toLowerCase(), val = m[2].trim();
  if (key === 'date') date = val;
  else if (key === 'estimate' || key === 'number' || key === 'likelihood') estimate = val;
  else if (key === 'range') range = val;
  else if (key === 'moment') momentLines.push(val);
}

if (estimate === undefined && range === undefined && !momentLines.length) {
  fail('Found nothing to apply. Expected lines like "estimate: 48" and "range: 35-55".');
}
if ((estimate === undefined) !== (range === undefined)) fail('An update needs both an "estimate" line and a "range" line.');

const data = JSON.parse(readFileSync(FILE, 'utf8'));
data.moments ??= [];
const summary = [];

if (estimate !== undefined) {
  const day = checkDate(date ?? today, 'Date');
  const p = percent(estimate, 'Estimate');
  const r = range.match(RANGE);
  if (!r) fail(`Range "${range}" should look like "35-55".`);
  const low = percent(r[1], 'Range low'), high = percent(r[2], 'Range high');
  if (!(low <= p && p <= high)) fail(`The estimate (${p}) has to sit inside the range (${low} to ${high}).`);
  if (high - low < 2) fail('The range has to be at least 2 points wide.');
  if (!data.updates.some(u => u.date === day && u.estimate === p && u.low === low && u.high === high)) {
    data.updates.push({ date: day, estimate: p, low, high });
    data.updates.sort((a, b) => a.date.localeCompare(b.date));
  }
  summary.push(`Forecast: ${p}% (range ${low} to ${high}%) on ${day}`);
}

for (const val of momentLines) {
  const bar = val.indexOf('|');
  const when = bar < 0 ? '' : val.slice(0, bar).trim();
  const label = (bar < 0 ? val : val.slice(bar + 1)).trim();
  if (!label || label.length > 40) fail(`Moment label "${label}" should be 1 to 40 characters.`);
  let start = date ?? today, end;
  if (when) {
    const d = when.match(DATES);
    if (!d) fail(`Moment dates "${when}" should look like "2026-10-10" or "2026-10-10 to 2026-10-12".`);
    [start, end] = [d[1], d[2]];
  }
  checkDate(start, 'Moment date');
  if (end) {
    checkDate(end, 'Moment end date', true);
    if (end < start) fail(`Moment "${label}" ends before it starts.`);
    if (end === start) end = undefined;
  }
  data.moments = data.moments.filter(m => !(m.start === start && m.label === label));
  data.moments.push(end ? { start, end, label } : { start, label });
  data.moments.sort((a, b) => a.start.localeCompare(b.start));
  summary.push(`Moment: ${label}, ${start}${end ? ` to ${end}` : ''}`);
}

writeFileSync(FILE, serialize(data));
console.log(summary.join('\n'));
