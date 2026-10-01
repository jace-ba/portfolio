// The new theme pours out of the toggle as a wobbly splash. Each element
// keeps the old colors, via data-tone, until the paint reaches it. Text, the
// button edge, and any background or border that changes then ease on their
// own animations. A CSS transition would jump back to the original color when
// an ancestor restyles, and a background transition can also be drawn one
// frame late by the compositor. The nav bar, the logo, and page titles are
// drawn again inside themselves: the copy is clipped to the same polygon the
// background canvas fills, so the edge cannot drift, and only that clip
// changes each frame. Buttons stay whole and keep tilting. A second press
// before the splash settles pours the other color over the first.

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
/** Resolved text color in each tone. An animation eases between these. */
let colors = new Map<Element, Record<Tone, string>>();
/** Button-edge color in each tone. A separate animation eases the extrusion. */
let edges = new Map<Element, Record<Tone, string>>();
/** Background and border colors, only where the two tones differ. */
let fills = new Map<Element, Record<Tone, string>>();
let lines = new Map<Element, Record<Tone, string>>();
/** Inline `color` from before the splash, restored when it settles. */
let priorColor = new Map<Element, string>();
/** Elements already handed to an animation. A later splash reads their live color. */
let arrived = new Set<Element>();
type FadeKind = 'text' | 'edge' | 'fill' | 'line';
type Fade = { anim: Animation; el: HTMLElement; kind: FadeKind };
/** Color animations started by this splash. Nothing here is a CSS transition. */
let fades: Fade[] = [];
let fadeMs = 250;
let tail = false;
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
    const pair = colors.get(host);
    if (pair) clone.style.color = pair[tone];
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

type Sample = { color: string; bg: string; border: string; borderOn: boolean };

function sampleStyle(el: Element): Sample {
  const style = getComputedStyle(el);
  return {
    color: style.color,
    bg: style.backgroundColor,
    border: style.borderTopColor,
    borderOn:
      parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderRightWidth) > 0 ||
      parseFloat(style.borderBottomWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0,
  };
}

/** A fill or border is worth easing only when the two tones actually differ. */
function changed(now: string, next: string) {
  if (now === next) return false;
  const blank = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  return !blank(now) || !blank(next);
}

/** Record each element's colors in both themes. An inherited color would
    follow its parent; the element's own color changes when the paint reaches it. */
function recordColors(current: Tone) {
  const other: Tone = current === 'dark' ? 'light' : 'dark';
  recorded = [...els, ...hosts()];
  const edged = recorded.filter((el) => el.classList.contains('iso-btn'));
  const now = recorded.map(sampleStyle);
  const nowEdge = edged.map((el) => getComputedStyle(el, '::before').color);
  // Tones, not the root theme, so nothing keyed to the theme starts moving.
  const toned = [document.body, ...recorded];
  for (const el of toned) el.setAttribute('data-tone', other);
  const flipped = recorded.map(sampleStyle);
  const flippedEdge = edged.map((el) => getComputedStyle(el, '::before').color);
  for (const el of toned) el.setAttribute('data-tone', current);
  document.body.removeAttribute('data-tone');
  recorded.forEach((el, i) => {
    colors.set(el, { [current]: now[i].color, [other]: flipped[i].color } as Record<Tone, string>);
    if (changed(now[i].bg, flipped[i].bg)) {
      fills.set(el, { [current]: now[i].bg, [other]: flipped[i].bg } as Record<Tone, string>);
    }
    if ((now[i].borderOn || flipped[i].borderOn) && changed(now[i].border, flipped[i].border)) {
      lines.set(el, { [current]: now[i].border, [other]: flipped[i].border } as Record<Tone, string>);
    }
  });
  edged.forEach((el, i) => {
    edges.set(el, { [current]: nowEdge[i], [other]: flippedEdge[i] } as Record<Tone, string>);
  });
}

/** Pin the color already on screen, before the theme flips, so a parent
    change cannot restart this element's fade. */
function lockColors(tone: Tone) {
  for (const el of recorded) {
    const pair = colors.get(el);
    if (!pair) continue;
    const { style } = el as HTMLElement;
    if (!priorColor.has(el)) priorColor.set(el, style.getPropertyValue('color'));
    style.setProperty('color', pair[tone]);
  }
}

function dropFades(el: Element) {
  fades = fades.filter((fade) => {
    if (fade.el !== el) return true;
    fade.anim.cancel();
    return false;
  });
}

/** Ease from the color on screen to the destination. A later call continues from the current frame, not the original color. */
function fadeColor(el: Element, from: string, to: string, pseudoElement?: string) {
  if (from === to) return;
  const anim = (el as HTMLElement).animate([{ color: from }, { color: to }], {
    duration: fadeMs,
    easing: 'ease',
    fill: 'forwards',
    ...(pseudoElement ? { pseudoElement } : {}),
  });
  fades.push({ anim, el: el as HTMLElement, kind: pseudoElement ? 'edge' : 'text' });
}

/** A registered custom property, animated on the main thread. The from value is
    written in the same task as the attribute, so the first frame is the color
    already showing and never the property's transparent initial value. */
function fadePaint(
  el: HTMLElement,
  kind: 'fill' | 'line',
  from: string,
  to: string,
) {
  const prop = kind === 'fill' ? '--flood-bg' : '--flood-border';
  const attr = kind === 'fill' ? 'data-flood-fill' : 'data-flood-line';
  if (from === to) {
    el.removeAttribute(attr);
    el.style.removeProperty(prop);
    return;
  }
  el.style.setProperty(prop, from);
  el.setAttribute(attr, '');
  const frames: Keyframe[] = [{ [prop]: from }, { [prop]: to }];
  const anim = el.animate(frames, { duration: fadeMs, easing: 'ease', fill: 'forwards' });
  fades.push({ anim, el, kind });
}

type Live = { text?: string; edge?: string; fill?: string; line?: string };

/** Move this element to the tone now under it. Hosts snap; the clipped copy already shows the destination. */
function paint(el: Element, tone: Tone, snap = false, live?: Live) {
  const pair = colors.get(el);
  const edge = edges.get(el);
  const fill = fills.get(el);
  const line = lines.get(el);
  const showing = el.getAttribute('data-tone') === 'dark' ? 'dark' : 'light';
  const node = el as HTMLElement;
  if (snap) {
    dropFades(el);
    node.removeAttribute('data-flood-fill');
    node.removeAttribute('data-flood-line');
    node.style.removeProperty('--flood-bg');
    node.style.removeProperty('--flood-border');
    if (pair) node.style.setProperty('color', pair[tone]);
  } else {
    dropFades(el);
    if (pair) fadeColor(el, live?.text ?? pair[showing], pair[tone]);
    if (edge) fadeColor(el, live?.edge ?? edge[showing], edge[tone], '::before');
    if (fill) fadePaint(node, 'fill', live?.fill ?? fill[showing], fill[tone]);
    if (line) fadePaint(node, 'line', live?.line ?? line[showing], line[tone]);
  }
  if (el.getAttribute('data-tone') !== tone) el.setAttribute('data-tone', tone);
  arrived.add(el);
}

function stopFades() {
  for (const fade of fades) fade.anim.cancel();
  fades = [];
}

/** Hand a finished fill back to the stylesheet. The tone is already the destination, so nothing jumps, and hover works again. */
function releaseFinished() {
  fades = fades.filter((fade) => {
    if (fade.kind !== 'fill' && fade.kind !== 'line') return true;
    if (fade.anim.playState !== 'finished') return true;
    const prop = fade.kind === 'fill' ? '--flood-bg' : '--flood-border';
    const attr = fade.kind === 'fill' ? 'data-flood-fill' : 'data-flood-line';
    fade.el.removeAttribute(attr);
    fade.el.style.removeProperty(prop);
    fade.anim.cancel();
    return false;
  });
}

function fillsOpen() {
  return fades.some(
    (fade) => (fade.kind === 'fill' || fade.kind === 'line') && fade.anim.playState !== 'finished',
  );
}

function clearTones() {
  for (const el of els) el.removeAttribute('data-tone');
  for (const el of recorded) {
    const node = el as HTMLElement;
    const { style } = node;
    const previous = priorColor.get(el);
    if (previous) style.setProperty('color', previous);
    else style.removeProperty('color');
    node.removeAttribute('data-flood-fill');
    node.removeAttribute('data-flood-line');
    style.removeProperty('--flood-bg');
    style.removeProperty('--flood-border');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  els = [];
  recorded = [];
  colors = new Map();
  edges = new Map();
  fills = new Map();
  lines = new Map();
  priorColor = new Map();
  arrived = new Set();
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
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  tail = false;
  root.classList.remove('flooding');
  root.style.removeProperty('color-scheme');
  stopFades();
  clearTones();
  document.querySelectorAll('[data-tone]').forEach((el) => el.removeAttribute('data-tone'));
  document.querySelectorAll('[data-flood-fill], [data-flood-line]').forEach((el) => {
    el.removeAttribute('data-flood-fill');
    el.removeAttribute('data-flood-line');
    if (el instanceof HTMLElement) {
      el.style.removeProperty('--flood-bg');
      el.style.removeProperty('--flood-border');
    }
  });
}


/** Colors a second splash has to continue from. Read in one pass, before any write. */
function readLive(jobs: { el: Element }[]): Map<Element, Live> {
  const live = new Map<Element, Live>();
  for (const job of jobs) {
    if (!arrived.has(job.el)) continue;
    const sample: Live = {};
    if (colors.has(job.el)) sample.text = getComputedStyle(job.el).color;
    if (edges.has(job.el)) sample.edge = getComputedStyle(job.el, '::before').color;
    if (fills.has(job.el)) sample.fill = getComputedStyle(job.el).backgroundColor;
    if (lines.has(job.el)) sample.line = getComputedStyle(job.el).borderTopColor;
    live.set(job.el, sample);
  }
  return live;
}

function tick(now: number) {
  raf = 0;
  if (!ctx) return;

  const jobs: { el: Element; tone: Tone }[] = [];
  for (let i = 0; i < els.length; i++) {
    let tone = floorTone;
    for (const flood of floods) if (now >= flood.arr[i]) tone = flood.tone;
    if (tone && els[i].getAttribute('data-tone') !== tone) jobs.push({ el: els[i], tone });
  }
  // First arrivals use the color recorded for the tone still on screen.
  const live = readLive(jobs);
  const viewH = viewport().height;
  const rects = new Map<HTMLElement, DOMRect>();
  for (const flood of floods) {
    for (const layer of flood.layers) {
      if (rects.has(layer)) continue;
      const rect = layer.getBoundingClientRect();
      if (rect.width > 0 && rect.bottom > 0 && rect.top < viewH) rects.set(layer, rect);
    }
  }

  fit();
  ctx.clearRect(0, 0, cw, ch);
  for (const flood of floods) {
    const t = Math.min(1, Math.max(0, (now - flood.start) / duration));
    const pts = blobPoints(flood, t);
    drawFlood(flood.color, pts);
    for (const layer of flood.layers) {
      const rect = rects.get(layer);
      if (rect) layer.style.clipPath = clipFor(pts, rect.left, rect.top);
    }
  }
  for (const job of jobs) paint(job.el, job.tone, false, live.get(job.el));
  while (floods.length && now - floods[0].start >= duration) {
    const done = floods.shift();
    if (!done) break;
    floorTone = done.tone;
    root.style.setProperty('--floor', done.color);
    for (const host of done.hosts) paint(host, done.tone, true);
    for (const layer of done.layers) layer.remove();
  }
  releaseFinished();
  if (floods.length) {
    raf = requestAnimationFrame(tick);
    return;
  }
  if (!tail) {
    tail = true;
    ctx.clearRect(0, 0, cw, ch);
    root.style.removeProperty('--floor');
    // Tones stay through the fade. Removing them here retargets any color that
    // is still easing, which reads as a flicker on the elements just reached.
    cleanupTimer = window.setTimeout(settle, fadeMs + 150);
  }
  if (fillsOpen()) raf = requestAnimationFrame(tick);
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
    fadeMs = ms('--dur-flood-fade', 250);
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
    // Pin the color already showing before the theme flips. The fade is armed
    // after that flip: if it is already on, Chromium eases from the new theme
    // back to this pinned color.
    lockColors(floorTone);
  }
  commit(next);
  if (fresh) {
    void root.offsetWidth;
    root.classList.add('flooding');
    void root.offsetWidth;
  }

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
