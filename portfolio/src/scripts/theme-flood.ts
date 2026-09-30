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
let recorded: Element[] = [];
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

/** The canvas covers the layout viewport, which excludes the scrollbar.
    innerWidth includes it, so sizing from that scales every point toward the corner. */
function viewport() {
  const view = document.documentElement;
  return { width: view.clientWidth, height: view.clientHeight };
}

function fit() {
  if (!canvas || !ctx) return;
  const { width: viewW, height: viewH } = viewport();
  if (viewW < 1 || viewH < 1) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(viewW * dpr);
  const height = Math.round(viewH * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // Browser zoom keeps viewW * dpr constant, so the bitmap often does not
  // change. The scale still has to follow the new CSS size, or the splash
  // stays where it was at the previous zoom.
  ctx.setTransform(width / viewW, 0, 0, height / viewH, 0, 0);
  cw = viewW;
  ch = viewH;
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

function hosts() {
  return [...document.querySelectorAll<HTMLElement>('[data-flood-host]')].filter(
    (host) => !host.closest('[data-flood-clone]'),
  );
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
    const clone = host.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-flood-clone]').forEach((node) => node.remove());
    clone.removeAttribute('data-flood-host');
    clone.removeAttribute('id');
    clone.querySelectorAll('[data-tone]').forEach((node) => node.removeAttribute('data-tone'));
    const fg = clone.style.getPropertyValue(`--flood-fg-${tone}`);
    if (fg) clone.style.setProperty('--flood-fg', fg);
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

/** Record each element's text color in both themes, so an inherited color can
    change when the paint reaches that element instead of its parent. */
function recordColors(current: Tone) {
  const other: Tone = current === 'dark' ? 'light' : 'dark';
  recorded = [...els, ...hosts()];
  const now = recorded.map((el) => getComputedStyle(el).color);
  // Tones, not the root theme, so nothing keyed to the theme starts moving.
  const toned = [document.body, ...recorded];
  for (const el of toned) el.setAttribute('data-tone', other);
  const flipped = recorded.map((el) => getComputedStyle(el).color);
  for (const el of toned) el.setAttribute('data-tone', current);
  document.body.removeAttribute('data-tone');
  recorded.forEach((el, i) => {
    const { style } = el as HTMLElement;
    style.setProperty(`--flood-fg-${current}`, now[i]);
    style.setProperty(`--flood-fg-${other}`, flipped[i]);
    style.setProperty('--flood-fg', now[i]);
  });
}

/** Point the fading color at this tone. The property is one registered color,
    so changing it eases. Swapping which variable `color` points at does not. */
function paint(el: Element, tone: Tone) {
  const { style } = el as HTMLElement;
  const value = style.getPropertyValue(`--flood-fg-${tone}`);
  if (value) style.setProperty('--flood-fg', value);
  if (el.getAttribute('data-tone') !== tone) el.setAttribute('data-tone', tone);
}

function clearTones() {
  for (const el of els) el.removeAttribute('data-tone');
  for (const el of recorded) {
    const { style } = el as HTMLElement;
    style.removeProperty('--flood-fg');
    style.removeProperty('--flood-fg-light');
    style.removeProperty('--flood-fg-dark');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  els = [];
  recorded = [];
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
  ctx?.clearRect(0, 0, cw, ch);
  root.style.removeProperty('--floor');
  settle();
}

/** Leave splash mode. Drop the recorded colors only after the flood rules are
    gone, so a fade that is still running is not retargeted. */
function settle() {
  root.classList.remove('flooding', 'flood-fade');
  root.style.removeProperty('color-scheme');
  clearTones();
  document.querySelectorAll('[data-tone]').forEach((el) => el.removeAttribute('data-tone'));
}

function finish() {
  ctx?.clearRect(0, 0, cw, ch);
  root.style.removeProperty('--floor');
  // Tones stay through the fade. Removing them here retargets any color that
  // is still easing, which reads as a flicker on the elements just reached.
  const fade = ms('--dur-flood-fade', 250);
  cleanupTimer = window.setTimeout(settle, fade + 150);
}

function tick(now: number) {
  raf = 0;
  if (!ctx) return;
  fit();
  ctx.clearRect(0, 0, cw, ch);
  const rects = new Map<HTMLElement, DOMRect>();
  for (const flood of floods) {
    for (const layer of flood.layers) {
      if (rects.has(layer)) continue;
      const rect = layer.getBoundingClientRect();
      if (rect.width > 0 && rect.bottom > 0 && rect.top < ch) rects.set(layer, rect);
    }
  }
  for (const flood of floods) {
    const t = Math.min(1, Math.max(0, (now - flood.start) / duration));
    const pts = blobPoints(flood, t);
    drawFlood(flood.color, pts);
    for (const layer of flood.layers) {
      const rect = rects.get(layer);
      if (rect) layer.style.clipPath = clipFor(pts, rect.left, rect.top);
    }
  }
  for (let i = 0; i < els.length; i++) {
    let tone = floorTone;
    for (const flood of floods) if (now >= flood.arr[i]) tone = flood.tone;
    if (tone && els[i].getAttribute('data-tone') !== tone) paint(els[i], tone);
  }
  while (floods.length && now - floods[0].start >= duration) {
    const done = floods.shift();
    if (!done) break;
    floorTone = done.tone;
    root.style.setProperty('--floor', done.color);
    for (const host of done.hosts) paint(host, done.tone);
    for (const layer of done.layers) layer.remove();
  }
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
    // Colors are recorded below with no flood transitions running.
    settle();
    markTitles();
    els = [...document.body.querySelectorAll('*:not(#flood)')].filter(
      (el) => !el.closest('[data-flood-host]'),
    );
    duration = ms('--dur-flood', 1200);
  }

  const box = origin.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const view = viewport();
  const far = Math.hypot(Math.max(cx, view.width - cx), Math.max(cy, view.height - cy));
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
  if (fresh) {
    floorTone = root.dataset.theme === 'dark' ? 'dark' : 'light';
    if (oldBg) root.style.setProperty('--floor', oldBg);
    recordColors(floorTone);
    for (const el of els) el.setAttribute('data-tone', floorTone);
    for (const host of hosts()) host.setAttribute('data-tone', floorTone);
    // Changing the root color-scheme mid-fade makes Chromium restart every
    // inherited color transition on each frame, so text crawls and icons flicker.
    root.style.setProperty('color-scheme', floorTone);
    root.classList.add('flooding');
    // Commit the recorded color before the fade exists, or text eases in from transparent.
    void root.offsetWidth;
    root.classList.add('flood-fade');
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
