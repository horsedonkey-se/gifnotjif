// A classic script, not a module: Chromium refuses to load module scripts over
// file://. Names here land in the global scope, so they are prefixed enough to
// stay clear of the DOM's own globals.

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  width: number;
  height: number;
}

const selectionBox = document.getElementById('selection')!;
const sizeLabel = document.getElementById('size')!;
const tipLabel = document.getElementById('tip')!;
const regionButton = document.getElementById('region') as HTMLButtonElement;
const windowButton = document.getElementById('window') as HTMLButtonElement;

let dragOrigin: Point | null = null;

/** Smallest region worth recording; below this it was probably a stray click. */
const MIN_SIDE = 8;

/**
 * The windows on this display, frontmost first, in this window's CSS pixels.
 * Empty until the main process has finished listing them, which is why the
 * window button starts disabled.
 */
let pickable: PickableWindow[] = [];

/** Which window the cursor is over, and so what a click would take. */
let hovered: PickableWindow | null = null;

type Mode = 'region' | 'window';
let mode: Mode = 'region';

function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
}

function drawSelection(rect: Rect, label?: string): void {
  selectionBox.hidden = false;
  selectionBox.style.left = `${rect.x}px`;
  selectionBox.style.top = `${rect.y}px`;
  selectionBox.style.width = `${rect.width}px`;
  selectionBox.style.height = `${rect.height}px`;
  selectionBox.classList.toggle(
    'near-bottom',
    rect.y + rect.height > window.innerHeight - 40,
  );
  sizeLabel.textContent = label
    ? `${label}  ${rect.width} × ${rect.height}`
    : `${rect.width} × ${rect.height}`;
}

/**
 * The window under the cursor, or null over bare desktop.
 *
 * The list is already frontmost-first, so the first rectangle containing the
 * point is the one actually visible there. That is the whole reason z-order is
 * carried across from the platform adapters rather than guessed at here by
 * comparing sizes.
 */
function windowAt(point: Point): PickableWindow | null {
  for (const w of pickable) {
    if (
      point.x >= w.x &&
      point.x < w.x + w.width &&
      point.y >= w.y &&
      point.y < w.y + w.height
    ) {
      return w;
    }
  }
  return null;
}

function setMode(next: Mode): void {
  if (next === 'window' && windowButton.disabled) return;
  mode = next;

  regionButton.setAttribute('aria-pressed', String(next === 'region'));
  windowButton.setAttribute('aria-pressed', String(next === 'window'));
  document.body.classList.toggle('picking', next === 'window');
  tipLabel.textContent = next === 'window' ? 'Click a window' : 'Drag to select';

  // Whatever was on screen belonged to the other mode.
  dragOrigin = null;
  hovered = null;
  selectionBox.hidden = true;
  document.body.classList.remove('dragging', 'over');
}

regionButton.addEventListener('click', () => setMode('region'));
windowButton.addEventListener('click', () => setMode('window'));

window.overlay.onWindows((found) => {
  pickable = found;
  // Nothing to pick is not the same as a picker that failed, but from here they
  // look identical, and either way there is no window to click.
  windowButton.disabled = found.length === 0;
});

/**
 * The mode buttons live inside the overlay, so a click on one also reaches the
 * window-level handlers below. Without this, switching mode would start a drag
 * or take whatever window happens to sit behind the hint bar.
 */
function onChrome(e: Event): boolean {
  return e.target instanceof Element && e.target.closest('#hint') !== null;
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || onChrome(e)) return;
  if (mode === 'window') return; // the pick lands on mouseup, with the click

  dragOrigin = { x: e.clientX, y: e.clientY };
  document.body.classList.add('dragging');
  drawSelection(rectFrom(dragOrigin, dragOrigin));
});

window.addEventListener('mousemove', (e) => {
  if (mode === 'window') {
    const under = windowAt({ x: e.clientX, y: e.clientY });
    // Redrawing an unchanged rectangle on every mouse move would fight the
    // transition and flicker the label.
    if (under === hovered) return;
    hovered = under;
    // Drives the dim: see the note beside body.picking.over in overlay.css.
    document.body.classList.toggle('over', under !== null);
    if (!under) {
      selectionBox.hidden = true;
      return;
    }
    drawSelection(under, under.title);
    return;
  }

  if (!dragOrigin) return;
  drawSelection(rectFrom(dragOrigin, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
  if (onChrome(e)) return;

  if (mode === 'window') {
    const under = windowAt({ x: e.clientX, y: e.clientY });
    // Sent as a plain rectangle, so a picked window travels the same path a
    // dragged one does: the main process converts it to physical pixels and
    // rounds it to even, and nothing downstream knows the difference.
    if (under) {
      window.overlay.confirm({
        x: under.x,
        y: under.y,
        width: under.width,
        height: under.height,
      });
    }
    return;
  }

  if (!dragOrigin) return;
  const rect = rectFrom(dragOrigin, { x: e.clientX, y: e.clientY });
  dragOrigin = null;
  document.body.classList.remove('dragging');

  if (rect.width < MIN_SIDE || rect.height < MIN_SIDE) {
    selectionBox.hidden = true;
    return;
  }
  // Sent in CSS pixels relative to this window. The main process converts to
  // physical screen pixels, which is where DPI scaling gets handled.
  window.overlay.confirm(rect);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.cancel();
  if (e.key === 'Tab') {
    // Otherwise Tab moves focus between the two buttons and the mode the user
    // asked for arrives one press late.
    e.preventDefault();
    setMode(mode === 'region' ? 'window' : 'region');
  }
});

// A drag that leaves this display should not strand a half-drawn box behind.
window.addEventListener('blur', () => {
  dragOrigin = null;
  hovered = null;
  selectionBox.hidden = true;
  document.body.classList.remove('dragging', 'over');
});
