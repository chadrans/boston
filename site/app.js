'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const DAY = 86400000;

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const parseDay = s => Date.parse(s + 'T00:00:00Z');
const num = v => String(Math.round(v * 10) / 10);
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + num(Math.abs(v));

const fmt = {
  day: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  full: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
};

/* ---------- the shape of each update ----------
   A three-point PERT curve: zero at the floor and ceiling, peaking at the
   estimate. When the estimate sits off-center the curve leans, with the long
   tail on the side that has more room. */

function pert(u) {
  const a = u.low, b = u.high, m = u.estimate, w = b - a, N = 240;
  const al = 1 + (4 * (m - a)) / w, be = 1 + (4 * (b - m)) / w;
  const xs = [], ys = [], cdf = [0];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    xs.push(a + t * w);
    ys.push(Math.pow(t, al - 1) * Math.pow(1 - t, be - 1));
  }
  for (let i = 0; i < N; i++) cdf.push(cdf[i] + ((ys[i] + ys[i + 1]) / 2) * (w / N));
  const area = cdf[N];
  const q = p => {
    let i = 0;
    while (cdf[i + 1] < p * area) i++;
    return xs[i] + ((p * area - cdf[i]) / (cdf[i + 1] - cdf[i] || 1)) * (w / N);
  };
  return { xs, ys: ys.map(y => y / area), q25: q(0.25), q75: q(0.75) };
}

/* ---------- words ----------
   Labels live in config.json. Each one applies from its "from" value up to
   the next entry's. */

const scale = (list, v) => list.reduce((hit, s) => (v >= s.from ? s.label : hit), list[0].label);
const verdict = p => scale(C.verdictByEstimate, p);
const conviction = u => scale(C.convictionByRangeWidth, u.high - u.low);

/* ---------- dom helpers ---------- */

function svg(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function text(parent, attrs, value) {
  svg('text', attrs, parent).textContent = value;
}

function node(tag, cls, value) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined) n.textContent = value;
  return n;
}

const pathOf = pts => 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L');

/* ---------- state ---------- */

let U = [], M = [], C = null, sel = 0, hover = null, geo = null;

async function init() {
  try {
    const load = f => fetch(f, { cache: 'no-cache' }).then(r => r.json());
    const [raw, cfg] = await Promise.all([load('data.json'), load('config.json')]);
    C = cfg;
    C.verdictByEstimate.sort((a, b) => a.from - b.from);
    C.convictionByRangeWidth.sort((a, b) => a.from - b.from);
    // Several updates can share a date; the sort is stable, so they keep file order.
    U = raw.updates.map(u => ({ ...u, t: parseDay(u.date) })).sort((a, b) => a.t - b.t);
    U.forEach(u => { u.shape = pert(u); });
    M = (raw.moments || []).map(m => ({ ...m, t0: parseDay(m.start), t1: parseDay(m.end || m.start) })).sort((a, b) => a.t0 - b.t0);
  } catch (err) {
    $('#when').textContent = "Couldn't load the forecast";
    return;
  }
  if (!U.length) { $('#when').textContent = 'No updates yet'; return; }
  sel = U.length - 1;

  $('#caption').textContent = C.valueCaption;
  renderStats();
  renderLedger();
  fitReadout();
  renderChart();
  bind();
}

function bind() {
  let frame = 0, lastW = 0;
  new ResizeObserver(() => {
    const w = $('#chart').clientWidth;
    if (w === lastW) return;
    lastW = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { fitReadout(); renderChart(); });
  }).observe($('#chart'));

  $('#toggle').addEventListener('change', e => $('#chart').classList.toggle('flat', !e.target.checked));
  $('#back').addEventListener('click', () => select(U.length - 1, true));

  const plot = $('#plot');
  const at = e => {
    const x = e.clientX - plot.getBoundingClientRect().left;
    return clamp(Math.floor((x - geo.l) / geo.slot), 0, U.length - 1);
  };
  plot.addEventListener('pointermove', e => setHover(at(e)));
  plot.addEventListener('pointerleave', () => setHover(null));
  plot.addEventListener('click', e => select(at(e), true));
  plot.addEventListener('keydown', e => {
    const keys = { ArrowLeft: sel - 1, ArrowRight: sel + 1, Home: 0, End: U.length - 1 };
    if (e.key === 'Escape') { select(U.length - 1, true); return; }
    if (!(e.key in keys)) return;
    e.preventDefault();
    select(clamp(keys[e.key], 0, U.length - 1), true);
  });
}

function setHover(i) {
  if (i === hover) return;
  hover = i;
  refresh();
}

function select(i, announce) {
  sel = i;
  refresh();
  if (announce) {
    const u = U[i];
    $('#live').textContent = `${fmt.full.format(u.t)}: ${num(u.estimate)} percent, range ${num(u.low)} to ${num(u.high)}.`;
  }
}

function refresh() {
  const i = hover ?? sel;
  renderReadout(i);
  drawSide(U[i]);
  updateMarks();
}

/* ---------- readout ---------- */

function renderReadout(i) {
  const u = U[i], prev = U[i - 1];
  const label = i === U.length - 1 ? 'Latest' : `Update ${i + 1} of ${U.length}`;
  $('#when').replaceChildren(document.createTextNode(`${label} · ${fmt.day.format(u.t)}`),
    node('span', 'long', `, ${new Date(u.t).getUTCFullYear()}`));
  $('#back').hidden = sel === U.length - 1;
  $('#value').textContent = num(u.estimate);
  $('#verdict').textContent = verdict(u.estimate);
  // Phones hide the ".long" tail so the verdict and change always share a line.
  const diff = prev ? u.estimate - prev.estimate : null;
  const [short, tail] = diff === null ? ['First update', '']
    : diff === 0 ? ['No change', ' from the last update']
    : [`${diff > 0 ? '▲' : '▼'} ${num(Math.abs(diff))} pts`, ' from the last update'];
  $('#delta').replaceChildren(document.createTextNode(short), node('span', 'long', tail));
  $('#range').textContent = `Range ${num(u.low)} to ${num(u.high)}%`;
  $('#conv').textContent = conviction(u);
}

// One readout layout per screen width, chosen for the widest update, so
// nothing shifts as you move between updates. The facts sit beside the number
// when every update fits there, otherwise below it; they take two lines
// whenever any update would need two; the switch gets its own row whenever any
// update would push it there.
function fitReadout() {
  const readout = $('.readout'), facts = $('.facts'), sw = $('.switch'), fig = $('.figure');
  const anyUpdate = test => U.some((_, i) => { renderReadout(i); return test(); });
  const groups = () => [...facts.querySelectorAll('.facts-group')].map(g => g.getBoundingClientRect());
  const right = $('.board').getBoundingClientRect().right + 0.5;
  readout.classList.remove('stacked', 'switch-below');
  facts.classList.remove('split');
  const overflow = anyUpdate(() => groups().some(g => g.right > right));
  const wraps = anyUpdate(() => { const [a, b] = groups(); return b.top > a.top + a.height / 2; });
  readout.classList.toggle('stacked', overflow);
  facts.classList.toggle('split', overflow || wraps);
  readout.classList.toggle('switch-below', anyUpdate(() => sw.getBoundingClientRect().top >= fig.getBoundingClientRect().bottom - 1));
  renderReadout(hover ?? sel);
}

/* ---------- static bits ---------- */

function renderStats() {
  const high = U.reduce((a, b) => (b.estimate >= a.estimate ? b : a));
  const low = U.reduce((a, b) => (b.estimate < a.estimate ? b : a));
  let swing = null;
  for (let i = 1; i < U.length; i++) {
    const diff = U[i].estimate - U[i - 1].estimate;
    if (!swing || Math.abs(diff) > Math.abs(swing.diff)) swing = { diff, u: U[i] };
  }
  const tiles = [
    ['All-time high', `${num(high.estimate)}%`, fmt.day.format(high.t)],
    ['All-time low', `${num(low.estimate)}%`, fmt.day.format(low.t)],
    ['Biggest swing', swing ? `${signed(swing.diff)} pts` : '–', swing ? fmt.day.format(swing.u.t) : ''],
    ['Updates', String(U.length), `since ${fmt.day.format(U[0].t)}`],
  ];
  $('#stats').replaceChildren(...tiles.map(([label, value, note]) => {
    const tile = node('div', 'stat');
    tile.append(node('p', 'stat-label', label), node('p', 'stat-value', value), node('p', 'stat-note', note));
    return tile;
  }));
}

function renderLedger() {
  const rows = U.map((u, i) => {
    const tr = document.createElement('tr');
    const prev = U[i - 1];
    const cells = [
      [fmt.full.format(u.t)],
      [`${num(u.estimate)}%`, 'num'],
      [prev ? signed(u.estimate - prev.estimate) : '–', 'num'],
      [`${num(u.low)} to ${num(u.high)}%`, 'num'],
      [conviction(u)],
    ];
    cells.forEach(([v, cls]) => tr.append(node('td', cls, v)));
    return tr;
  }).reverse();
  $('#ledger').replaceChildren(...rows);

  $('#moments').replaceChildren(...M.map(m => {
    const li = node('li');
    const when = m.t1 > m.t0 ? `${fmt.day.format(m.t0)} to ${fmt.full.format(m.t1)}` : fmt.full.format(m.t0);
    li.append(node('b', null, m.label), document.createTextNode(`, ${when}`));
    return li;
  }));
}

/* ---------- chart ---------- */

function layoutMoments(items, right, font, blocked) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;
  // Right to left, each flag takes the lowest row where neither its label nor
  // its pole runs into something already placed.
  items.forEach(it => { it.w = ctx.measureText(it.mo.label).width; });
  items.sort((a, b) => b.x - a.x);
  const rows = [blocked, [], []];
  const free = (r, a, b) => rows[r].every(([c, d]) => b + 8 < c || a - 8 > d);
  for (const it of items) {
    it.anchor = it.x + 5 + it.w > right ? 'end' : 'start';
    const [a, b] = it.anchor === 'start' ? [it.x, it.x + 5 + it.w] : [it.x - 5 - it.w, it.x];
    it.row = -1;
    for (let r = 0; r < rows.length; r++) {
      let ok = free(r, a, b);
      for (let k = 0; k < r && ok; k++) ok = free(k, it.x - 2, it.x + 2);
      if (!ok) continue;
      it.row = r;
      rows[r].push([a, b]);
      for (let k = 0; k < r; k++) rows[k].push([it.x - 2, it.x + 2]);
      break;
    }
  }
  return Math.max(0, ...items.map(it => it.row + 1));
}

function renderChart() {
  const W = $('#chart').clientWidth;
  if (!W) return;
  const small = W < 560;
  const plotH = small ? 260 : 300;
  const names = { 100: C.axis.top, 50: C.axis.middle, 0: C.axis.bottom };
  const font = `600 12px ${css('--sans')}`;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = font;

  // [y labels][ timeline ][gap][ sideways curve ][value label]
  // On phones the y labels move inside the plot and the value label is
  // dropped (the big number sits right above), so the timeline gets the room.
  const l = small ? 0 : Math.ceil(Math.max(...Object.values(names).map(n => ctx.measureText(n).width))) + 14;
  const valueW = small ? 6 : 40, sideW = small ? 60 : 140, gap = small ? 10 : 26;
  const plotR = W - valueW - sideW - gap, sideX = plotR + gap;
  const n = U.length, slot = (plotR - l) / n;
  const cx = i => l + slot * (i + 0.5);

  // Calendar time to x, piecewise through the updates, for placing the flags.
  const xAt = t => {
    if (t <= U[0].t) return l;
    for (let i = 0; i < n - 1; i++) {
      if (t >= U[i].t && t < U[i + 1].t) return cx(i) + ((t - U[i].t) / (U[i + 1].t - U[i].t)) * slot;
    }
    return Math.min(plotR, cx(n - 1) + ((t - U[n - 1].t) / DAY) * slot * 0.5);
  };

  // Flag labels may run over the curve's column; on wide screens they steer
  // around its caption, on small ones the caption is dropped.
  const caption = small ? '' : 'Shape of this update';
  const capW = ctx.measureText(caption).width;
  const flags = M.map(mo => ({ mo, x: xAt(mo.t0), x1: xAt(mo.t1 + DAY) })).filter(f => f.x < plotR);
  const rows = layoutMoments(flags, W - (small ? 0 : valueW), `500 12px ${css('--sans')}`, caption ? [[sideX, sideX + capW]] : []);
  const top = Math.max(rows * 20 + 14, 22);
  const H = top + plotH + 30;
  const y = v => top + plotH * (1 - v / 100);

  const root = $('#plot');
  root.replaceChildren();
  root.setAttribute('width', W);
  root.setAttribute('height', H);
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // shared y-axis: gridlines run under both the timeline and the curve
  const ticks = [100, 75, 50, 25, 0];
  for (const v of ticks) {
    svg('line', { x1: l, x2: sideX + sideW, y1: y(v), y2: y(v), class: v === 50 ? 'g-mid' : v === 0 ? 'g-base' : 'g-line' }, root);
  }
  const yLabels = () => ticks.forEach(v => {
    const cls = 'y-label' + (names[v] ? ' strong' : '') + (small ? ' inside' : '');
    const at = small ? { x: 2, y: v === 100 ? y(v) + 14 : y(v) - 5 } : { x: l - 10, y: y(v), dy: '0.32em', 'text-anchor': 'end' };
    text(root, { ...at, class: cls }, names[v] ?? `${v}%`);
  });
  if (!small) yLabels();

  for (const f of flags) {
    if (f.mo.t1 > f.mo.t0) svg('rect', { x: f.x, y: top, width: Math.max(2, Math.min(f.x1, plotR) - f.x), height: plotH, class: 'm-wash' }, root);
    else svg('line', { x1: f.x, x2: f.x, y1: top, y2: top + plotH, class: 'm-rule' }, root);
    if (f.row < 0) continue;
    const ly = top - 12 - f.row * 20;
    svg('line', { x1: f.x, x2: f.x, y1: ly - 10, y2: top, class: 'm-pole' }, root);
    text(root, { x: f.anchor === 'start' ? f.x + 5 : f.x - 5, y: ly, 'text-anchor': f.anchor, class: 'm-label' }, f.mo.label);
  }

  // bands: each update's floor-to-ceiling and middle half, joined point to point
  const band = (lo, hi, cls) => {
    const upper = U.map((u, i) => [cx(i), y(hi(u))]);
    const lower = U.map((u, i) => [cx(i), y(lo(u))]).reverse();
    upper.unshift([l, upper[0][1]]);
    upper.push([plotR, upper[upper.length - 1][1]]);
    lower.unshift([plotR, lower[0][1]]);
    lower.push([l, lower[lower.length - 1][1]]);
    svg('path', { d: pathOf(upper.concat(lower)) + 'Z', class: `band ${cls}` }, root);
  };
  band(u => u.low, u => u.high, 'band-outer');
  band(u => u.shape.q25, u => u.shape.q75, 'band-inner');

  const pts = U.map((u, i) => [cx(i), y(u.estimate)]);
  svg('path', { d: pathOf(pts), class: 'line' }, root);
  if (small) yLabels();

  // x-axis: dates under the updates, skipping repeats and crowding; a break
  // mark where the calendar jumps by more than three weeks
  let lastLeft = Infinity, lastLabel = '';
  for (let i = n - 1; i >= 0; i--) {
    const label = fmt.day.format(U[i].t);
    const half = ctx.measureText(label).width / 2;
    const x = clamp(cx(i), l + half, plotR - half);
    if (label === lastLabel || x + half + 10 > lastLeft) continue;
    text(root, { x, y: top + plotH + 20, 'text-anchor': 'middle', class: 'x-label' }, label);
    lastLeft = x - half;
    lastLabel = label;
  }
  for (let i = 0; i < n - 1; i++) {
    if (U[i + 1].t - U[i].t <= 21 * DAY) continue;
    const bx = cx(i) + slot / 2, by = y(0);
    svg('rect', { x: bx - 4, y: by - 5, width: 8, height: 10, class: 'brk-gap' }, root);
    svg('line', { x1: bx - 5, y1: by + 5, x2: bx - 1, y2: by - 5, class: 'brk' }, root);
    svg('line', { x1: bx + 1, y1: by + 5, x2: bx + 5, y2: by - 5, class: 'brk' }, root);
  }

  const side = svg('g', {}, root);
  if (caption) text(root, { x: sideX, y: top - 12, class: 's-cap' }, caption);
  const cross = svg('line', { y1: top, y2: top + plotH, class: 'crosshair', visibility: 'hidden' }, root);
  const dots = pts.map(([x, yy]) => svg('circle', { cx: x, cy: yy, r: 4, class: 'dot' }, root));
  svg('rect', { x: 0, y: 0, width: W, height: H, class: 'hit' }, root);

  geo = { l, slot, pts, dots, cross, side, sideX, sideW, y, top, plotH, small };
  refresh();
}

// The selected update's curve, turned on its side so it shares the y-axis.
function drawSide(u) {
  const { side, sideX, sideW, y, top, plotH } = geo;
  side.replaceChildren();
  const { xs, ys, q25, q75 } = u.shape;
  const peak = Math.max(...ys);
  const px = d => sideX + (d / peak) * sideW;
  const at = v => { // density at value v, linear between grid points
    const f = ((v - xs[0]) / (xs[xs.length - 1] - xs[0])) * (xs.length - 1);
    const i = clamp(Math.floor(f), 0, xs.length - 2);
    return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
  };
  const curve = xs.map((v, i) => [px(ys[i]), y(v)]);
  const area = (a, b) => {
    const inside = xs.filter(v => v > a && v < b).map(v => [px(at(v)), y(v)]);
    return pathOf([[sideX, y(a)], [px(at(a)), y(a)], ...inside, [px(at(b)), y(b)], [sideX, y(b)]]) + 'Z';
  };
  svg('path', { d: area(u.low, u.high), class: 's-outer' }, side);
  svg('path', { d: area(q25, q75), class: 's-inner' }, side);
  svg('path', { d: pathOf(curve), class: 's-line' }, side);
  svg('line', { x1: sideX, x2: px(at(u.estimate)), y1: y(u.estimate), y2: y(u.estimate), class: 's-mark' }, side);
  svg('line', { x1: sideX, x2: sideX, y1: top, y2: top + plotH, class: 's-base' }, side);
  if (!geo.small) text(side, { x: sideX + sideW + 8, y: y(u.estimate), dy: '0.32em', class: 's-value' }, `${num(u.estimate)}%`);
}

function updateMarks() {
  const active = hover ?? sel;
  geo.dots.forEach((c, i) => {
    c.setAttribute('r', i === active ? 6 : 4);
    c.classList.toggle('on', i === active);
  });
  const [px] = geo.pts[active];
  geo.cross.setAttribute('visibility', hover == null ? 'hidden' : 'visible');
  geo.cross.setAttribute('x1', px);
  geo.cross.setAttribute('x2', px);
}

init();
