// The new theme pours out of the toggle as a wobbly splash. Each element
// keeps the old colors, via data-tone, until the paint reaches it. The nav
// bar, the logo, and page titles are drawn again inside themselves: the copy
// is clipped to the same polygon the background canvas fills, so the edge
// cannot drift, and only that clip changes each frame. Buttons stay whole and
// keep tilting. A second press before the splash settles pours the other
// color over the first.

type Tone = 'light' | 'dark';

type Wave = { f: number; a: number; p: number; s: number };

type Flood = {
  tone: Tone;
  color: string;
  cx: number;
  cy: number;
  Rmax: number;
  start: number;
  shape: Wave[];
  arr: number[];
  hosts: HTMLElement[];
  layers: HTMLElement[];
};

const WAVES: [number, number][] = [
  [2, 0.17],
  [3, 0.15],
  [4, 0.09],
  [6, 0.05],
];
const SMOOTHING = 0.75;
const COUNT = 160;

const root = document.documentElement;
const canvas = document.getElementById('flood') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d') ?? null;

let floods: Flood[] = [];
let els: Element[] = [];
let floorTone: Tone | null = null;
let raf = 0;
let cleanupTimer = 0;
let cw = 0;
let ch = 0;
let duration = 1200;

const ampSum = WAVES.reduce((sum, wave) => sum + wave[1], 0);
const cover = 1.02 / Math.max(0.3, 1 - ampSum * (1 - SMOOTHING));

const ease = (t: number) => 1 - (1 - t) ** 2.6;
const easeInv = (x: number) => 1 - (1 - x) ** (1 / 2.6);

function ms(name: string, fallback: number) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  return fallback;
}

function fit() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(innerWidth * dpr);
  const height = Math.round(innerHeight * dpr);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cw = innerWidth;
  ch = innerHeight;
}

function makeShape(): Wave[] {
  return WAVES.map(([f, a]) => ({
    f,
    a,
    p: Math.random() * Math.PI * 2,
    s: (Math.random() * 2 - 1) * 2,
  }));
}

function blobPoints(flood: Flood, t: number) {
  const radius = ease(t) * flood.Rmax;
  const rough = 1 - t * SMOOTHING;
  const pts = new Array<number>(COUNT * 2);
  for (let i = 0; i < COUNT; i++) {
    const theta = (i / COUNT) * Math.PI * 2;
    let n = 0;
    for (const wave of flood.shape) n += wave.a * Math.sin(wave.f * theta + wave.p + wave.s * t);
    const rr = radius * (1 + n * rough);
    pts[i * 2] = flood.cx + rr * Math.cos(theta);
    pts[i * 2 + 1] = flood.cy + rr * Math.sin(theta);
  }
  return pts;
}

function drawFlood(color: string, pts: number[]) {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < COUNT; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.closePath();
  ctx.fill();
}

/** The same outline, in the element's own coordinates. */
function clipFor(pts: number[], ox: number, oy: number) {
  let out = 'polygon(';
  for (let i = 0; i < COUNT; i++) {
    if (i) out += ',';
    out += `${(pts[i * 2] - ox).toFixed(1)}px ${(pts[i * 2 + 1] - oy).toFixed(1)}px`;
  }
  return `${out})`;
}

function barBase() {
  return document.querySelector<HTMLElement>('.bar > [data-flood-base]');
}

/** Punch the active splashes out of the old bar fill so it never sits under a covered corner. */
function applyBarHole(blobs: number[][]) {
  const base = barBase();
  if (!base) return;
  if (!blobs.length) {
    base.style.removeProperty('clip-path');
    return;
  }
  const rect = base.getBoundingClientRect();
  if (rect.width < 1) return;
  const w = rect.width.toFixed(1);
  const h = rect.height.toFixed(1);
  let d = `M0,0 H${w} V${h} H0 Z`;
  for (const pts of blobs) {
    d += ` M${(pts[0] - rect.left).toFixed(1)},${(pts[1] - rect.top).toFixed(1)}`;
    for (let i = 1; i < COUNT; i++) {
      d += ` L${(pts[i * 2] - rect.left).toFixed(1)},${(pts[i * 2 + 1] - rect.top).toFixed(1)}`;
    }
    d += ' Z';
  }
  base.style.clipPath = `path(evenodd, "${d}")`;
}

function hosts() {
  return [...document.querySelectorAll<HTMLElement>('[data-flood-host]')].filter(
    (host) => !host.closest('[data-flood-clone]'),
  );
}

function baseOf(host: HTMLElement) {
  return host.querySelector<HTMLElement>(':scope > [data-flood-base]') ?? host;
}

function markTitles() {
  document.querySelectorAll('h1').forEach((heading) => {
    if (heading instanceof HTMLElement && !heading.closest('[data-flood-host]')) {
      heading.setAttribute('data-flood-host', '');
    }
  });
}

function buildLayers(tone: Tone) {
  const hostList: HTMLElement[] = [];
  const layers: HTMLElement[] = [];
  for (const host of hosts()) {
    if (host.getBoundingClientRect().width < 1) continue;
    const clone = baseOf(host).cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-flood-clone]').forEach((node) => node.remove());
    clone.removeAttribute('data-flood-host');
    clone.removeAttribute('data-flood-base');
    clone.removeAttribute('id');
    clone.querySelectorAll('[data-tone]').forEach((node) => node.removeAttribute('data-tone'));
    clone.dataset.tone = tone;
    clone.dataset.floodClone = '';
    clone.inert = true;
    clone.setAttribute('aria-hidden', 'true');
    clone.style.clipPath = 'polygon(0px 0px, 0px 0px, 0px 0px)';
    host.append(clone);
    hostList.push(host);
    layers.push(clone);
  }
  return { hosts: hostList, layers };
}

function clearTones() {
  for (const el of els) el.removeAttribute('data-tone');
  els = [];
}

function removeClones() {
  document.querySelectorAll('[data-flood-clone]').forEach((node) => node.remove());
}

/** Drop the splash immediately. Used when a page swap would detach the elements it is tracking. */
export function endFlood() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  clearTimeout(cleanupTimer);
  floods = [];
  floorTone = null;
  removeClones();
  barBase()?.style.removeProperty('clip-path');
  ctx?.clearRect(0, 0, cw, ch);
  root.style.removeProperty('--floor');
  clearTones();
  document.querySelectorAll('[data-tone]').forEach((el) => el.removeAttribute('data-tone'));
  root.classList.remove('flooding');
}

function finish() {
  ctx?.clearRect(0, 0, cw, ch);
  root.style.removeProperty('--floor');
  clearTones();
  // The root theme already matches the settled splash, so the hosts can inherit it.
  for (const host of hosts()) baseOf(host).removeAttribute('data-tone');
  const fade = ms('--dur-flood-fade', 250);
  cleanupTimer = window.setTimeout(() => root.classList.remove('flooding'), fade + 150);
}

function tick(now: number) {
  raf = 0;
  if (!ctx) return;
  fit();
  ctx.clearRect(0, 0, cw, ch);
  // The bar fill is larger than its shell, so clip each copy in its own box.
  const rects = new Map<HTMLElement, DOMRect>();
  for (const flood of floods) {
    for (const layer of flood.layers) {
      if (rects.has(layer)) continue;
      const rect = layer.getBoundingClientRect();
      if (rect.width > 0 && rect.bottom > 0 && rect.top < ch) rects.set(layer, rect);
    }
  }
  const drawn: { flood: Flood; pts: number[] }[] = [];
  for (const flood of floods) {
    const t = Math.min(1, Math.max(0, (now - flood.start) / duration));
    const pts = blobPoints(flood, t);
    drawn.push({ flood, pts });
    drawFlood(flood.color, pts);
    for (const layer of flood.layers) {
      const rect = rects.get(layer);
      if (rect) layer.style.clipPath = clipFor(pts, rect.left, rect.top);
    }
  }
  for (let i = 0; i < els.length; i++) {
    let tone = floorTone;
    for (const flood of floods) if (now >= flood.arr[i]) tone = flood.tone;
    if (tone && els[i].getAttribute('data-tone') !== tone) els[i].setAttribute('data-tone', tone);
  }
  while (floods.length && now - floods[0].start >= duration) {
    const done = floods.shift();
    if (!done) break;
    floorTone = done.tone;
    root.style.setProperty('--floor', done.color);
    for (const host of done.hosts) baseOf(host).setAttribute('data-tone', done.tone);
    for (const layer of done.layers) layer.remove();
  }
  const live = new Set(floods);
  applyBarHole(drawn.filter((item) => live.has(item.flood)).map((item) => item.pts));
  if (floods.length) raf = requestAnimationFrame(tick);
  else finish();
}

export function floodTo(origin: Element, commit: (theme: Tone) => void) {
  const next: Tone = root.dataset.theme === 'dark' ? 'light' : 'dark';
  if (!canvas || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    endFlood();
    commit(next);
    return;
  }

  const fresh = floods.length === 0;
  if (fresh) {
    clearTimeout(cleanupTimer);
    markTitles();
    els = [...document.body.querySelectorAll('*:not(#flood)')].filter(
      (el) => !el.closest('[data-flood-host]'),
    );
    duration = ms('--dur-flood', 1200);
  }

  const box = origin.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
  const Rmax = far * cover;
  const lead = ms('--dur-flood-lead', 120);
  const start = performance.now();
  const arr = els.map((el) => {
    const rect = el.getBoundingClientRect();
    const dist = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
    return start + Math.max(0, easeInv(Math.min(1, dist / Rmax)) * duration - lead);
  });
  const oldBg = fresh ? getComputedStyle(document.body).backgroundColor : null;

  fit();
  // A resize may have returned before recording the viewport, so keep cw current.
  cw = innerWidth;
  ch = innerHeight;
  if (fresh) {
    floorTone = root.dataset.theme === 'dark' ? 'dark' : 'light';
    if (oldBg) root.style.setProperty('--floor', oldBg);
    for (const el of els) el.setAttribute('data-tone', floorTone);
    for (const host of hosts()) baseOf(host).setAttribute('data-tone', floorTone);
    root.classList.add('flooding');
  }
  commit(next);

  const built = buildLayers(next);
  floods.push({
    tone: next,
    color: getComputedStyle(root).getPropertyValue('--bg').trim(),
    cx,
    cy,
    Rmax,
    start,
    shape: makeShape(),
    arr,
    hosts: built.hosts,
    layers: built.layers,
  });
  if (!raf) raf = requestAnimationFrame(tick);
}
