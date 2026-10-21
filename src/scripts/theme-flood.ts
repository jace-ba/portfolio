// The new theme pours out of the toggle as a wobbly splash. A unit keeps the
// old colors, via data-tone, until the paint reaches it. Text, the button
// edge, and any background or border that changes then ease on their own
// animations. A descendant that would change with that unit, and that the
// wave reaches in the same moment, inherits the fade instead. A CSS transition
// would jump back to the original color when
// an ancestor restyles, and a background transition can also be drawn one
// frame late by the compositor. The nav bar, the logo, and page titles are
// drawn again inside themselves: the copy is clipped to the same polygon the
// background canvas fills, so the edge cannot drift. That clip is rewritten
// only while the polygon actually cuts the copy. Buttons stay whole and keep
// tilting. A second press before the splash settles pours the other color
// over the first.

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
  pts: Float64Array;
  rIn: number;
  rOut: number;
};

const WAVES: [number, number][] = [
  [2, 0.17],
  [3, 0.15],
  [4, 0.09],
  [6, 0.05],
];
const SMOOTHING = 0.75;
const COUNT = 160;
/** Glyphs can paint a little outside the border box. The clip test uses this
    margin so a skipped update cannot shear off ink or reveal any past the wave. */
const INK = 64;
/** The covering fill starts once the antialiased fringe is outside the bitmap. */
const COVER_PAD = 2;
const EMPTY_CLIP = 'polygon(0px 0px, 0px 0px, 0px 0px)';
/** Descendants farther apart than this keep their own fade, so matching text
    still sweeps down the page instead of turning with one ancestor. */
const FOLLOW_MS = 100;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE', 'NOSCRIPT', 'BR', 'WBR']);

const root = document.documentElement;
const canvas = document.getElementById('flood') as HTMLCanvasElement | null;
const ctx = canvas?.getContext('2d') ?? null;

let floods: Flood[] = [];
/** Units. Each eases on its own; `followers` inherit that fade. */
let els: Element[] = [];
/** Border boxes for `els`, measured when the splash starts. */
let rects: DOMRect[] = [];
/** Inherit a nearby unit's color. No tone and no animation of their own. */
let followers: Element[] = [];
/** data-tone last written for els[i]. Avoids reading the attribute every frame. */
let shown: Tone[] = [];
let recorded: Element[] = [];
/** Resolved text color in each tone. An animation eases between these. */
let colors = new Map<Element, Record<Tone, string>>();
/** Button-edge color in each tone. A separate animation eases the extrusion. */
let edges = new Map<Element, Record<Tone, string>>();
/** Background and border colors, only where the two tones differ. */
let fills = new Map<Element, Record<Tone, string>>();
let lines = new Map<Element, Record<Tone, string>>();
/** --bg for each tone, sampled while colors are recorded. */
let bgOf: Record<Tone, string> = { light: '', dark: '' };
/** Inline `color` from before the splash, restored when it settles. */
let priorColor = new Map<Element, string>();
/** Elements already handed to an animation. A later splash reads their live color. */
let arrived = new Set<Element>();
type FadeKind = 'text' | 'edge' | 'paint';
type Fade = { anim: Animation; el: HTMLElement; kind: FadeKind };
/** Color animations started by this splash. Nothing here is a CSS transition. */
let fades = new Map<Element, Fade[]>();
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

const clipParts = new Array<string>(COUNT);
const lastClip = new WeakMap<HTMLElement, string>();
/** The clip already on this layer contains every pixel it can paint. */
const clipHolds = new WeakMap<HTMLElement, boolean>();

type Job = { el: Element; tone: Tone; i: number; rect: DOMRect | null };
const jobs: Job[] = [];
let jobCount = 0;
const hostRects = new Map<HTMLElement, DOMRect>();
/** Set on scroll or resize. The next frame remeasures before it writes. */
let rectsStale = false;
let watching = false;

function markRectsStale() {
  rectsStale = true;
}

function watchViewport() {
  if (watching) return;
  watching = true;
  window.addEventListener('scroll', markRectsStale, { capture: true, passive: true });
  window.addEventListener('resize', markRectsStale);
  // The iOS toolbar moves the visual viewport without a window scroll.
  window.visualViewport?.addEventListener('scroll', markRectsStale);
  window.visualViewport?.addEventListener('resize', markRectsStale);
}

function unwatchViewport() {
  if (!watching) return;
  watching = false;
  window.removeEventListener('scroll', markRectsStale, { capture: true });
  window.removeEventListener('resize', markRectsStale);
  window.visualViewport?.removeEventListener('scroll', markRectsStale);
  window.visualViewport?.removeEventListener('resize', markRectsStale);
  rectsStale = false;
}

function measureHosts() {
  hostRects.clear();
  const view = viewport();
  for (const flood of floods) {
    for (const layer of flood.layers) {
      const host = layer.parentElement;
      if (!(host instanceof HTMLElement) || hostRects.has(host)) continue;
      const rect = layer.getBoundingClientRect();
      if (rect.width > 0 && rect.bottom > 0 && rect.top < view.height) hostRects.set(host, rect);
    }
  }
}

/** The box the splash uses to time an element. A KaTeX radical is one path
    with a bar hundreds of ems long, clipped to the mark. The geometry box
    ignores that clip, so its center sits far to the right and the fade
    starts late. */
function paintedBox(el: Element): DOMRect | null {
  const rect = el.getBoundingClientRect();
  if (!(el instanceof SVGGeometryElement)) return rect;
  const svg = el.ownerSVGElement;
  if (!svg) return rect;
  const box = svg.getBoundingClientRect();
  const left = Math.max(rect.left, box.left);
  const top = Math.max(rect.top, box.top);
  const right = Math.min(rect.right, box.right);
  const bottom = Math.min(rect.bottom, box.bottom);
  if (right - left < 1 || bottom - top < 1) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function refreshGeometry() {
  for (let i = 0; i < els.length; i++) {
    const box = paintedBox(els[i]);
    if (box) rects[i] = box;
  }
  measureHosts();
  rectsStale = false;
}
type Live = { text?: string; edge?: string; fill?: string; line?: string };
const live = new Map<Element, Live>();

function ms(name: string, fallback: number) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (raw.endsWith('ms')) return parseFloat(raw);
  if (raw.endsWith('s')) return parseFloat(raw) * 1000;
  return fallback;
}

/** The visible page. clientWidth excludes the scrollbar; innerWidth includes
    it, so sizing from that scales every point toward the corner. On iPhone
    the layout viewport, the visual viewport, and the window height disagree,
    and a fixed layer is clipped short of the glass. Take the tallest, and
    place the canvas over the visual viewport. */
function viewport() {
  const vv = window.visualViewport;
  const width = document.documentElement.clientWidth;
  const height = Math.max(
    document.documentElement.clientHeight,
    window.innerHeight,
    vv?.height ?? 0,
  );
  return {
    left: window.scrollX + (vv?.offsetLeft ?? 0),
    top: window.scrollY + (vv?.offsetTop ?? 0),
    width,
    height,
  };
}

function fit() {
  if (!canvas || !ctx) return;
  const view = viewport();
  if (view.width < 1 || view.height < 1) return;
  canvas.style.left = `${view.left}px`;
  canvas.style.top = `${view.top}px`;
  canvas.style.width = `${view.width}px`;
  canvas.style.height = `${view.height}px`;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.round(view.width * dpr);
  const height = Math.round(view.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // Browser zoom keeps view.width * dpr constant, so the bitmap often does not
  // change. The scale still has to follow the new CSS size, or the splash
  // stays where it was at the previous zoom.
  ctx.setTransform(width / view.width, 0, 0, height / view.height, 0, 0);
  cw = view.width;
  ch = view.height;
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
  const pts = flood.pts;
  const { cx, cy, shape } = flood;
  for (let i = 0; i < COUNT; i++) {
    const theta = (i / COUNT) * Math.PI * 2;
    let n = 0;
    for (const wave of shape) n += wave.a * Math.sin(wave.f * theta + wave.p + wave.s * t);
    const rr = radius * (1 + n * rough);
    pts[i * 2] = cx + rr * Math.cos(theta);
    pts[i * 2 + 1] = cy + rr * Math.sin(theta);
  }
}

/** Inscribed and circumscribed radii. The outline is a polar blob, so the
    center sees every edge and these two numbers bound it exactly. */
function measure(flood: Flood) {
  const pts = flood.pts;
  const cx = flood.cx;
  const cy = flood.cy;
  let rOut = 0;
  let rIn = Infinity;
  for (let i = 0; i < COUNT; i++) {
    const ax = pts[i * 2] - cx;
    const ay = pts[i * 2 + 1] - cy;
    const r = Math.hypot(ax, ay);
    if (r > rOut) rOut = r;
    const j = (i + 1) % COUNT;
    const bx = pts[j * 2] - cx;
    const by = pts[j * 2 + 1] - cy;
    const abx = bx - ax;
    const aby = by - ay;
    const ab2 = abx * abx + aby * aby;
    let along = 0;
    if (ab2 > 0) {
      along = -(ax * abx + ay * aby) / ab2;
      if (along < 0) along = 0;
      else if (along > 1) along = 1;
    }
    const px = ax + abx * along;
    const py = ay + aby * along;
    const d = Math.hypot(px, py);
    if (d < rIn) rIn = d;
  }
  flood.rOut = rOut;
  flood.rIn = rIn;
}

function drawFlood(color: string, pts: Float64Array) {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < COUNT; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.closePath();
  ctx.fill();
}

function rectInside(
  left: number,
  top: number,
  right: number,
  bottom: number,
  cx: number,
  cy: number,
  r: number,
) {
  if (r <= 0) return false;
  const r2 = r * r;
  const x0 = left - cx;
  const x1 = right - cx;
  const y0 = top - cy;
  const y1 = bottom - cy;
  return (
    x0 * x0 + y0 * y0 <= r2 &&
    x1 * x1 + y0 * y0 <= r2 &&
    x0 * x0 + y1 * y1 <= r2 &&
    x1 * x1 + y1 * y1 <= r2
  );
}

function rectOutside(
  left: number,
  top: number,
  right: number,
  bottom: number,
  cx: number,
  cy: number,
  r: number,
) {
  const x = cx < left ? left : cx > right ? right : cx;
  const y = cy < top ? top : cy > bottom ? bottom : cy;
  const dx = cx - x;
  const dy = cy - y;
  return dx * dx + dy * dy >= r * r;
}

function coversViewport(flood: Flood) {
  return rectInside(0, 0, cw, ch, flood.cx, flood.cy, flood.rIn - COVER_PAD);
}

/** The same outline, in the element's own coordinates. */
function clipFor(pts: Float64Array, ox: number, oy: number) {
  for (let i = 0; i < COUNT; i++) {
    clipParts[i] = `${(pts[i * 2] - ox).toFixed(1)}px ${(pts[i * 2 + 1] - oy).toFixed(1)}px`;
  }
  return `polygon(${clipParts.join(',')})`;
}

const clipAnim = new WeakMap<HTMLElement, Animation>();

function setClip(layer: HTMLElement, value: string) {
  if (lastClip.get(layer) === value) return;
  lastClip.set(layer, value);
  layer.style.clipPath = value;
  // Assigning clip-path does not repaint a composited layer in iOS Safari,
  // so the header copy stays clipped to nothing and the bar never changes.
  // A fill of the same polygon does.
  clipAnim.get(layer)?.cancel();
  clipAnim.set(
    layer,
    layer.animate(
      [
        { clipPath: value, offset: 0 },
        { clipPath: value, offset: 1 },
      ],
      { duration: 1, fill: 'forwards' },
    ),
  );
}

function updateClip(flood: Flood, layer: HTMLElement) {
  const host = layer.parentElement;
  if (!(host instanceof HTMLElement)) return;
  const rect = hostRects.get(host);
  if (!rect) return;
  const left = rect.left - INK;
  const top = rect.top - INK;
  const right = rect.right + INK;
  const bottom = rect.bottom + INK;
  // Both this polygon and the one already clipped contain the whole copy, so
  // leaving the clip alone paints the same pixels and skips a style recalc.
  if (rectInside(left, top, right, bottom, flood.cx, flood.cy, flood.rIn)) {
    if (!clipHolds.get(layer)) {
      setClip(layer, clipFor(flood.pts, rect.left, rect.top));
      clipHolds.set(layer, true);
    }
    return;
  }
  if (clipHolds.get(layer)) clipHolds.set(layer, false);
  if (rectOutside(left, top, right, bottom, flood.cx, flood.cy, flood.rOut)) {
    setClip(layer, EMPTY_CLIP);
    return;
  }
  setClip(layer, clipFor(flood.pts, rect.left, rect.top));
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
  const visible: HTMLElement[] = [];
  for (const host of hosts()) {
    if (host.getBoundingClientRect().width >= 1) visible.push(host);
  }
  const hostList: HTMLElement[] = [];
  const layers: HTMLElement[] = [];
  for (const host of visible) {
    // Earlier copies sit on the host. Parking them keeps cloneNode from
    // duplicating every splash that is already running.
    const parked = [...host.querySelectorAll<HTMLElement>(':scope > [data-flood-clone]')];
    for (const node of parked) node.remove();
    const clone = host.cloneNode(true) as HTMLElement;
    for (const node of parked) host.append(node);
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
    clone.style.clipPath = EMPTY_CLIP;
    lastClip.set(clone, EMPTY_CLIP);
    clipHolds.set(clone, false);
    host.append(clone);
    hostList.push(host);
    layers.push(clone);
  }
  return { hosts: hostList, layers };
}

type Sample = {
  color: string;
  bg: string;
  border: string;
  borderOn: boolean;
  fill: string;
  stroke: string;
};

function sampleStyle(el: Element, style: CSSStyleDeclaration): Sample {
  const svg = el instanceof SVGElement;
  return {
    color: style.color,
    bg: style.backgroundColor,
    border: style.borderTopColor,
    borderOn:
      parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderRightWidth) > 0 ||
      parseFloat(style.borderBottomWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0,
    fill: svg ? style.fill : '',
    stroke: svg ? style.stroke : '',
  };
}

function isSkipped(el: Element) {
  return (
    el.id === 'flood' ||
    el.id === 'theme-chrome' ||
    SKIP_TAGS.has(el.tagName) ||
    !!el.closest('.katex-mathml') ||
    !!el.closest('[hidden]') ||
    !!el.closest('[data-flood-host]')
  );
}

/** Arrival along the splash, without the lead. Two elements within FOLLOW_MS
    of each other would overlap their fades anyway. */
function waveAt(rect: DOMRect, cx: number, cy: number, Rmax: number) {
  const dist = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
  return easeInv(Math.min(1, dist / Math.max(Rmax, 1))) * duration;
}

/** A fill or border is worth easing only when the two tones actually differ. */
function changed(now: string, next: string) {
  if (now === next) return false;
  const blank = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  return !blank(now) || !blank(next);
}

type Row = { el: Element; now: Sample; next: Sample; rect: DOMRect | null };

function rememberPaint(el: Element, now: Sample, next: Sample, current: Tone, other: Tone) {
  colors.set(el, { [current]: now.color, [other]: next.color } as Record<Tone, string>);
  if (changed(now.bg, next.bg)) {
    fills.set(el, { [current]: now.bg, [other]: next.bg } as Record<Tone, string>);
  }
  if ((now.borderOn || next.borderOn) && changed(now.border, next.border)) {
    lines.set(el, { [current]: now.border, [other]: next.border } as Record<Tone, string>);
  }
}

function themePaint(now: Sample, next: Sample) {
  if (now.color !== next.color) return true;
  if (changed(now.bg, next.bg)) return true;
  if ((now.borderOn || next.borderOn) && changed(now.border, next.border)) return true;
  if (changed(now.fill, next.fill) || changed(now.stroke, next.stroke)) return true;
  return false;
}

/** Record colors for units and for the sliced header copies. One flip of
    data-tone on the body restyles the page: custom properties inherit, so
    each element does not need the attribute to be sampled. Descendants that
    match a nearby unit become followers and are left out of the fade. */
function recordColors(current: Tone, cx: number, cy: number, Rmax: number) {
  const other: Tone = current === 'dark' ? 'light' : 'dark';
  const hostList = hosts();
  const pending: { el: Element; now: Sample; rect: DOMRect | null }[] = [];
  const nowBy = new Map<Element, Sample>();
  const consider = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === 'none') return;
    const contents = style.display === 'contents';
    const rect = contents ? null : paintedBox(el);
    // A horizontal stroke has no height. Drop only boxes that paint nothing.
    if (!contents && (rect === null || (rect.width < 1 && rect.height < 1))) return;
    const now = sampleStyle(el, style);
    nowBy.set(el, now);
    pending.push({ el, now, rect });
  };
  const blankBg = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  // KaTeX never sets `color` (it inherits), so a span that matches its parent
  // in this theme matches in the other one too. Skip the second style read.
  const copyTone = (el: Element, now: Sample) => {
    if (!(el instanceof HTMLElement) || !el.closest('.katex-html')) return false;
    if (now.borderOn || !blankBg(now.bg)) return false;
    let parent = el.parentElement;
    let sample: Sample | undefined;
    while (parent) {
      sample = nowBy.get(parent);
      if (sample) break;
      parent = parent.parentElement;
    }
    return !!sample && sample.color === now.color;
  };
  consider(document.body);
  for (const el of document.body.querySelectorAll<Element>('*')) {
    if (!isSkipped(el)) consider(el);
  }
  for (const el of hostList) consider(el);

  const edged = pending.filter((row) => row.el.classList.contains('iso-btn'));
  const nowEdge = edged.map((row) => getComputedStyle(row.el, '::before').color);
  // One tone on the body. Descendants inherit the tokens, so this samples the
  // other theme without matching [data-tone] on every element.
  document.body.setAttribute('data-tone', other);
  const nextOf = new Map<Element, Sample>();
  const deferred: Element[] = [];
  for (const row of pending) {
    if (copyTone(row.el, row.now)) {
      deferred.push(row.el);
      continue;
    }
    nextOf.set(row.el, sampleStyle(row.el, getComputedStyle(row.el)));
  }
  for (const el of deferred) {
    const now = nowBy.get(el);
    if (!now) continue;
    let parent = el.parentElement;
    let source: Sample | undefined;
    while (parent) {
      source = nextOf.get(parent);
      if (source) break;
      parent = parent.parentElement;
    }
    nextOf.set(el, source ? { ...now, color: source.color } : now);
  }
  bgOf[other] = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  const flippedEdge = edged.map((row) => getComputedStyle(row.el, '::before').color);
  document.body.removeAttribute('data-tone');
  bgOf[current] = getComputedStyle(document.body).getPropertyValue('--bg').trim();

  const rows = new Map<Element, Row>();
  for (const row of pending) {
    const next = nextOf.get(row.el);
    if (next) rows.set(row.el, { el: row.el, now: row.now, next, rect: row.rect });
  }
  const edgeChanged = new Set<Element>();
  edged.forEach((row, i) => {
    edges.set(row.el, { [current]: nowEdge[i], [other]: flippedEdge[i] } as Record<Tone, string>);
    if (nowEdge[i] !== flippedEdge[i]) edgeChanged.add(row.el);
  });

  const unitSet = new Set<Element>();
  const units: Element[] = [];
  const unitRects: DOMRect[] = [];
  followers = [];
  const hostSet = new Set<Element>(hostList);

  const ancestorColors = (el: Element) => {
    let parent = el.parentElement;
    while (parent) {
      const row = rows.get(parent);
      if (row) return row;
      parent = parent.parentElement;
    }
    return rows.get(document.body) ?? null;
  };
  const nearestUnit = (el: Element) => {
    let parent = el.parentElement;
    while (parent) {
      if (unitSet.has(parent)) return parent;
      parent = parent.parentElement;
    }
    return null;
  };

  for (const row of pending) {
    const next = nextOf.get(row.el);
    if (!next || row.rect === null || hostSet.has(row.el) || row.el === document.body) continue;
    const bgChanges = changed(row.now.bg, next.bg);
    const borderChanges =
      (row.now.borderOn || next.borderOn) && changed(row.now.border, next.border);
    const ownFace = bgChanges || borderChanges || edgeChanged.has(row.el);
    if (!ownFace && !themePaint(row.now, next)) continue;

    const parent = ancestorColors(row.el);
    const colorDiffers =
      !parent || row.now.color !== parent.now.color || next.color !== parent.next.color;
    const unit = nearestUnit(row.el);
    const unitRect = unit ? (rows.get(unit)?.rect ?? null) : null;
    const near =
      unitRect !== null &&
      Math.abs(waveAt(row.rect, cx, cy, Rmax) - waveAt(unitRect, cx, cy, Rmax)) <= FOLLOW_MS;
    if (!ownFace && !colorDiffers && near) {
      followers.push(row.el);
      continue;
    }
    unitSet.add(row.el);
    units.push(row.el);
    unitRects.push(row.rect);
    rememberPaint(row.el, row.now, next, current, other);
  }

  for (const el of hostList) {
    const row = rows.get(el);
    if (row) rememberPaint(el, row.now, row.next, current, other);
  }

  els = units;
  rects = unitRects;
  recorded = [...units, ...hostList];
  for (const el of recorded) el.setAttribute('data-tone', current);
}

/** Pin the color already on screen, before the theme flips, so a parent
    change cannot restart this element's fade. */
function lockColors(tone: Tone) {
  for (const el of recorded) {
    const pair = colors.get(el);
    if (!pair) continue;
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (!priorColor.has(el)) priorColor.set(el, el.style.getPropertyValue('color'));
    el.style.setProperty('color', pair[tone]);
  }
}

/** Followers take the unit's animated color. An inline color of their own
    would keep the token and snap when the root theme flips. KaTeX and SVG
    geometry already inherit, so writing `color` on each one only restyles. */
function pinFollowers() {
  for (const el of followers) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest('.katex-html') || el.closest('svg')) continue;
    if (!priorColor.has(el)) priorColor.set(el, el.style.getPropertyValue('color'));
    el.style.setProperty('color', 'inherit');
  }
}

function dropFades(el: Element) {
  const list = fades.get(el);
  if (!list) return;
  for (const fade of list) fade.anim.cancel();
  fades.delete(el);
}

function trackFade(fade: Fade) {
  const list = fades.get(fade.el);
  if (list) list.push(fade);
  else fades.set(fade.el, [fade]);
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
  trackFade({ anim, el: el as HTMLElement, kind: pseudoElement ? 'edge' : 'text' });
}

/** Ease text, fill, and border in one animation. The custom properties are set
    in the same task as the tone, so the first frame is the color already
    showing and never the property's transparent initial value. Unchanged
    fills are not in the maps: `changed` drops a pair that is transparent in
    both tones. */
function fadeTogether(el: HTMLElement, tone: Tone, showing: Tone, sample?: Live) {
  const pair = colors.get(el);
  const fill = fills.get(el);
  const line = lines.get(el);
  const from: Record<string, string> = {};
  const to: Record<string, string> = {};
  if (pair) {
    const startColor = sample?.text ?? pair[showing];
    const endColor = pair[tone];
    if (startColor !== endColor) {
      from.color = startColor;
      to.color = endColor;
    }
  }
  if (fill) {
    const startColor = sample?.fill ?? fill[showing];
    const endColor = fill[tone];
    if (startColor !== endColor) {
      el.style.setProperty('--flood-bg', startColor);
      el.setAttribute('data-flood-fill', '');
      from['--flood-bg'] = startColor;
      to['--flood-bg'] = endColor;
    }
  }
  if (line) {
    const startColor = sample?.line ?? line[showing];
    const endColor = line[tone];
    if (startColor !== endColor) {
      el.style.setProperty('--flood-border', startColor);
      el.setAttribute('data-flood-line', '');
      from['--flood-border'] = startColor;
      to['--flood-border'] = endColor;
    }
  }
  if (!Object.keys(from).length) return;
  const anim = el.animate([from, to], { duration: fadeMs, easing: 'ease', fill: 'forwards' });
  const paints = '--flood-bg' in from || '--flood-border' in from;
  trackFade({ anim, el, kind: paints ? 'paint' : 'text' });
}

/** Move this element to the tone now under it. Hosts snap; the clipped copy already shows the destination. */
function paint(el: Element, tone: Tone, snap = false, sample?: Live) {
  const pair = colors.get(el);
  const edge = edges.get(el);
  const showing: Tone = el.getAttribute('data-tone') === 'dark' ? 'dark' : 'light';
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
    fadeTogether(node, tone, showing, sample);
    if (edge) fadeColor(el, sample?.edge ?? edge[showing], edge[tone], '::before');
  }
  if (el.getAttribute('data-tone') !== tone) el.setAttribute('data-tone', tone);
  arrived.add(el);
}

function stopFades() {
  for (const list of fades.values()) for (const fade of list) fade.anim.cancel();
  fades.clear();
}

/** Hand a finished fill back to the stylesheet. The tone is already the destination, so nothing jumps, and hover works again. */
function releaseFinished() {
  for (const [el, list] of fades) {
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const fade = list[i];
      if (fade.kind === 'paint' && fade.anim.playState === 'finished') {
        const pair = colors.get(fade.el);
        const tone = fade.el.getAttribute('data-tone') === 'dark' ? 'dark' : 'light';
        // The shared animation also holds the text color. Pin that before
        // canceling, or the pre-splash inline color flashes back.
        if (pair) fade.el.style.setProperty('color', pair[tone]);
        fade.el.removeAttribute('data-flood-fill');
        fade.el.removeAttribute('data-flood-line');
        fade.el.style.removeProperty('--flood-bg');
        fade.el.style.removeProperty('--flood-border');
        fade.anim.cancel();
        continue;
      }
      list[write++] = fade;
    }
    list.length = write;
    if (!write) fades.delete(el);
  }
}

function fillsOpen() {
  for (const list of fades.values()) {
    for (const fade of list) {
      if (fade.kind === 'paint' && fade.anim.playState !== 'finished') {
        return true;
      }
    }
  }
  return false;
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
  for (const el of followers) {
    if (!(el instanceof HTMLElement || el instanceof SVGElement) || !priorColor.has(el)) continue;
    const previous = priorColor.get(el);
    if (previous) el.style.setProperty('color', previous);
    else el.style.removeProperty('color');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
  els = [];
  rects = [];
  followers = [];
  shown = [];
  recorded = [];
  colors = new Map();
  edges = new Map();
  fills = new Map();
  lines = new Map();
  bgOf = { light: '', dark: '' };
  priorColor = new Map();
  arrived = new Set();
}

function removeClones() {
  document.querySelectorAll('[data-flood-clone]').forEach((node) => node.remove());
}

/** The color still showing beyond the wave. An inline longhand, not an
    inherited custom property, so the rest of the document is left alone. */
function setFloor(color: string | null) {
  if (color) document.body.style.backgroundColor = color;
  else document.body.style.removeProperty('background-color');
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
  setFloor(null);
  settle();
}

/** iOS keeps a sticky layer's texture after the colors under it change, so the
    bar stays on the theme the splash started from. */
function repaintHeader() {
  const sticky = document.querySelector('.header-sticky');
  if (!(sticky instanceof HTMLElement)) return;
  sticky.style.transform = 'translateZ(0)';
  void sticky.offsetWidth;
  sticky.style.removeProperty('transform');
  if (!sticky.getAttribute('style')) sticky.removeAttribute('style');
}

/** Leave splash mode. Drop the recorded colors only after the flood rules are
    gone, so a fade that is still running is not retargeted. */
function settle() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  tail = false;
  unwatchViewport();
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
  repaintHeader();
}

function readLive() {
  live.clear();
  for (let i = 0; i < jobCount; i++) {
    const el = jobs[i].el;
    if (!arrived.has(el)) continue;
    const style = getComputedStyle(el);
    const sample: Live = {};
    if (colors.has(el)) sample.text = style.color;
    if (fills.has(el)) sample.fill = style.backgroundColor;
    if (lines.has(el)) sample.line = style.borderTopColor;
    if (edges.has(el)) sample.edge = getComputedStyle(el, '::before').color;
    live.set(el, sample);
  }
}

function offscreen(rect: DOMRect, viewW: number, viewH: number) {
  return (
    rect.bottom < -INK ||
    rect.top > viewH + INK ||
    rect.right < -INK ||
    rect.left > viewW + INK
  );
}


function tick(now: number) {
  raf = 0;
  if (!ctx) return;
  if (rectsStale) refreshGeometry();

  jobCount = 0;
  for (let i = 0; i < els.length; i++) {
    let tone = floorTone;
    for (const flood of floods) if (now >= flood.arr[i]) tone = flood.tone;
    if (tone && shown[i] !== tone) {
      let job = jobs[jobCount];
      if (!job) {
        job = { el: els[i], tone, i, rect: null };
        jobs[jobCount] = job;
      } else {
        job.el = els[i];
        job.tone = tone;
        job.i = i;
        job.rect = null;
      }
      jobCount++;
    }
  }
  // Reads before writes. Rects come from the splash start unless the page moved.
  readLive();
  for (let i = 0; i < jobCount; i++) jobs[i].rect = rects[jobs[i].i] ?? null;

  const view = viewport();

  for (const flood of floods) {
    const t = Math.min(1, Math.max(0, (now - flood.start) / duration));
    blobPoints(flood, t);
    measure(flood);
  }

  fit();
  let base = -1;
  for (let i = floods.length - 1; i >= 0; i--) {
    if (coversViewport(floods[i])) {
      base = i;
      break;
    }
  }
  if (base >= 0) {
    ctx.fillStyle = floods[base].color;
    ctx.fillRect(0, 0, cw, ch);
    for (let i = base + 1; i < floods.length; i++) drawFlood(floods[i].color, floods[i].pts);
  } else {
    ctx.clearRect(0, 0, cw, ch);
    for (const flood of floods) drawFlood(flood.color, flood.pts);
  }
  for (const flood of floods) {
    for (const layer of flood.layers) updateClip(flood, layer);
  }

  for (let i = 0; i < jobCount; i++) {
    const job = jobs[i];
    const hidden = job.rect ? offscreen(job.rect, view.width, view.height) : false;
    paint(job.el, job.tone, hidden, hidden ? undefined : live.get(job.el));
    shown[job.i] = job.tone;
  }
  let covered = false;
  while (floods.length && now - floods[0].start >= duration) {
    const done = floods.shift();
    if (!done) break;
    covered = true;
    floorTone = done.tone;
    setFloor(done.color);
    for (const host of done.hosts) paint(host, done.tone, true);
    for (const layer of done.layers) layer.remove();
  }
  if (covered) repaintHeader();
  releaseFinished();
  if (floods.length) {
    raf = requestAnimationFrame(tick);
    return;
  }
  if (!tail) {
    tail = true;
    ctx.clearRect(0, 0, cw, ch);
    setFloor(null);
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
    duration = ms('--dur-flood', 1200);
    fadeMs = ms('--dur-flood-fade', 250);
  }

  const box = origin.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const view = viewport();
  const far = Math.hypot(Math.max(cx, view.width - cx), Math.max(cy, view.height - cy));
  const Rmax = far * cover;
  const oldBg = fresh ? getComputedStyle(document.body).backgroundColor : null;

  fit();
  if (fresh) {
    floorTone = root.dataset.theme === 'dark' ? 'dark' : 'light';
    if (oldBg) setFloor(oldBg);
    recordColors(floorTone, cx, cy, Rmax);
    shown = new Array<Tone>(els.length).fill(floorTone);
    // Changing the root color-scheme mid-fade makes Chromium restart every
    // inherited color transition on each frame, so text crawls and icons flicker.
    root.style.setProperty('color-scheme', floorTone);
    // Pin the color already showing before the theme flips. The fade is armed
    // after that flip: if it is already on, Chromium eases from the new theme
    // back to this pinned color.
    lockColors(floorTone);
    pinFollowers();
  } else {
    for (let i = 0; i < els.length; i++) {
      const box = paintedBox(els[i]);
      if (box) rects[i] = box;
    }
  }
  const lead = ms('--dur-flood-lead', 120);
  const start = performance.now();
  const arr = rects.map((rect) => {
    const dist = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
    return start + Math.max(0, easeInv(Math.min(1, dist / Rmax)) * duration - lead);
  });
  commit(next);
  if (fresh) {
    void root.offsetWidth;
    root.classList.add('flooding');
    void root.offsetWidth;
  }

  const built = buildLayers(next);
  const color =
    bgOf[next] || getComputedStyle(root).getPropertyValue('--bg').trim();
  floods.push({
    tone: next,
    color,
    cx,
    cy,
    Rmax,
    start,
    shape: makeShape(),
    arr,
    hosts: built.hosts,
    layers: built.layers,
    pts: new Float64Array(COUNT * 2),
    rIn: 0,
    rOut: 0,
  });
  measureHosts();
  watchViewport();
  repaintHeader();
  if (!raf) raf = requestAnimationFrame(tick);
}
