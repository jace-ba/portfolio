// Cursor-driven tilt for every IsoButton. The geometry lives in CSS
// (IsoButton.astro); this only writes each button's --theta.

const MAX_ANGLE = Math.PI / 4;

interface Entry {
  hole: HTMLElement;
  range: number;
  theta: string;
}

const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isTracking = () => finePointer.matches && !reducedMotion.matches;

let entries: Entry[] = [];
let lastX: number | null = null;
let frame = 0;
let mids: number[] = [];
let nextTheta: string[] = [];

function collect() {
  entries = Array.from(document.querySelectorAll<HTMLElement>('.iso-hole'), (hole) => ({
    hole,
    range: parseFloat(getComputedStyle(hole).getPropertyValue('--tilt-range')) || 260,
    theta: '',
  })).filter(({ hole }) => !hole.closest('[data-flood-clone]'));
}

function update() {
  frame = 0;
  const count = entries.length;
  if (mids.length < count) {
    mids = new Array(count);
    nextTheta = new Array(count);
  }
  const tracking = isTracking() && lastX !== null;
  if (tracking) {
    for (let i = 0; i < count; i++) {
      const rect = entries[i].hole.getBoundingClientRect();
      mids[i] = rect.left + rect.width / 2;
    }
    const x = lastX as number;
    for (let i = 0; i < count; i++) {
      const theta = MAX_ANGLE * Math.tanh((x - mids[i]) / entries[i].range);
      nextTheta[i] = `${theta.toFixed(4)}rad`;
    }
  } else {
    for (let i = 0; i < count; i++) nextTheta[i] = '0.0000rad';
  }
  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    if (entry.theta === nextTheta[i]) continue;
    entry.theta = nextTheta[i];
    entry.hole.style.setProperty('--theta', nextTheta[i]);
  }
}

const schedule = () => {
  if (!frame) frame = requestAnimationFrame(update);
};

window.addEventListener(
  'mousemove',
  (e) => {
    if (!isTracking()) return;
    lastX = e.clientX;
    schedule();
  },
  { passive: true },
);

window.addEventListener('resize', () => {
  collect();
  schedule();
});

finePointer.addEventListener('change', schedule);
reducedMotion.addEventListener('change', schedule);

// ClientRouter swaps page content without re-running this module, so pick up
// the new page's buttons and give them the current tilt immediately.
document.addEventListener('astro:page-load', () => {
  collect();
  update();
});

collect();
update();
