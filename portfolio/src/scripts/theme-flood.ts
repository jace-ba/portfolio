// The new theme pours out of the toggle as a wobbly splash. Each element
// keeps the old colors, via data-tone, until the paint reaches it. A second
// press before the splash settles pours the other color over the first.

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
};

const WAVES: [number, number][] = [
  [2, 0.17],
  [3, 0.15],
  [4, 0.09],
  [6, 0.05],
];
const SMOOTHING = 0.75;

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
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
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

function drawFlood(flood: Flood, t: number) {
  if (!ctx) return;
  const radius = ease(t) * flood.Rmax;
  const rough = 1 - t * SMOOTHING;
  const count = 48;
  const pts: number[] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    let n = 0;
    for (const wave of flood.shape) n += wave.a * Math.sin(wave.f * theta + wave.p + wave.s * t);
    const rr = radius * (1 + n * rough);
    pts.push(flood.cx + rr * Math.cos(theta), flood.cy + rr * Math.sin(theta));
  }
  ctx.fillStyle = flood.color;
  ctx.beginPath();
  ctx.moveTo((pts[0] + pts[2 * (count - 1)]) / 2, (pts[1] + pts[2 * (count - 1) + 1]) / 2);
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    ctx.quadraticCurveTo(
      pts[2 * i],
      pts[2 * i + 1],
      (pts[2 * i] + pts[2 * next]) / 2,
      (pts[2 * i + 1] + pts[2 * next + 1]) / 2,
    );
  }
  ctx.closePath();
  ctx.fill();
}

function clearTones() {
  for (const el of els) el.removeAttribute('data-tone');
  els = [];
}

/** Drop the splash immediately. Used when a page swap would detach the elements it is tracking. */
export function endFlood() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  clearTimeout(cleanupTimer);
  floods = [];
  floorTone = null;
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
  const fade = ms('--dur-flood-fade', 250);
  cleanupTimer = window.setTimeout(() => root.classList.remove('flooding'), fade + 150);
}

function tick(now: number) {
  raf = 0;
  if (!ctx) return;
  fit();
  ctx.clearRect(0, 0, cw, ch);
  for (const flood of floods) {
    drawFlood(flood, Math.min(1, Math.max(0, (now - flood.start) / ms('--dur-flood', 1200))));
  }
  for (let i = 0; i < els.length; i++) {
    let tone = floorTone;
    for (const flood of floods) if (now >= flood.arr[i]) tone = flood.tone;
    if (tone && els[i].getAttribute('data-tone') !== tone) els[i].setAttribute('data-tone', tone);
  }
  const duration = ms('--dur-flood', 1200);
  while (floods.length && now - floods[0].start >= duration) {
    const done = floods.shift();
    if (!done) break;
    floorTone = done.tone;
    root.style.setProperty('--floor', done.color);
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
    els = [...document.body.querySelectorAll('*:not(#flood)')];
  }

  const box = origin.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const far = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
  const Rmax = far * cover;
  const duration = ms('--dur-flood', 1200);
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
    for (const el of els) el.setAttribute('data-tone', floorTone);
    root.classList.add('flooding');
  }
  commit(next);

  floods.push({
    tone: next,
    color: getComputedStyle(root).getPropertyValue('--bg').trim(),
    cx,
    cy,
    Rmax,
    start,
    shape: makeShape(),
    arr,
  });
  if (!raf) raf = requestAnimationFrame(tick);
}
