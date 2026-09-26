// Cursor-driven tilt for every IsoButton. The geometry lives in CSS
// (IsoButton.astro); this only writes each button's --theta.

const MAX_ANGLE = Math.PI / 4;

interface Entry {
  hole: HTMLElement;
  range: number;
}

const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isTracking = () => finePointer.matches && !reducedMotion.matches;

let entries: Entry[] = [];
let lastX: number | null = null;
let frame = 0;

function collect() {
  entries = Array.from(document.querySelectorAll<HTMLElement>('.iso-hole'), (hole) => ({
    hole,
    range: parseFloat(getComputedStyle(hole).getPropertyValue('--tilt-range')) || 260,
  }));
}

function update() {
  frame = 0;
  const tracking = isTracking() && lastX !== null;
  for (const { hole, range } of entries) {
    let theta = 0;
    if (tracking) {
      const rect = hole.getBoundingClientRect();
      theta = MAX_ANGLE * Math.tanh((lastX! - (rect.left + rect.width / 2)) / range);
    }
    hole.style.setProperty('--theta', `${theta.toFixed(4)}rad`);
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
