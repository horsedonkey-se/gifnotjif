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

let dragOrigin: Point | null = null;

/** Smallest region worth recording; below this it was probably a stray click. */
const MIN_SIDE = 8;

function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
}

function drawSelection(rect: Rect): void {
  selectionBox.hidden = false;
  selectionBox.style.left = `${rect.x}px`;
  selectionBox.style.top = `${rect.y}px`;
  selectionBox.style.width = `${rect.width}px`;
  selectionBox.style.height = `${rect.height}px`;
  selectionBox.classList.toggle(
    'near-bottom',
    rect.y + rect.height > window.innerHeight - 40,
  );
  sizeLabel.textContent = `${rect.width} × ${rect.height}`;
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  dragOrigin = { x: e.clientX, y: e.clientY };
  document.body.classList.add('dragging');
  drawSelection(rectFrom(dragOrigin, dragOrigin));
});

window.addEventListener('mousemove', (e) => {
  if (!dragOrigin) return;
  drawSelection(rectFrom(dragOrigin, { x: e.clientX, y: e.clientY }));
});

window.addEventListener('mouseup', (e) => {
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
});

// A drag that leaves this display should not strand a half-drawn box behind.
window.addEventListener('blur', () => {
  dragOrigin = null;
  selectionBox.hidden = true;
  document.body.classList.remove('dragging');
});
