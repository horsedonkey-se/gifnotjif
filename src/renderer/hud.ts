// A classic script, not a module. See the note at the top of overlay.ts.

const clockLabel = document.getElementById('clock')!;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const discardButton = document.getElementById('discard') as HTMLButtonElement;
const statusLabel = document.getElementById('status')!;

const startedAt = Date.now();

const tick = window.setInterval(() => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  clockLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}, 250);

stopButton.addEventListener('click', () => {
  stopButton.disabled = true;
  discardButton.disabled = true;
  window.hud.stop();
});

// No confirmation. A dialog here would take focus and change what is on screen,
// which is the one thing a screen recorder must not do, and a fluffed take costs
// only the time it took.
discardButton.addEventListener('click', () => {
  stopButton.disabled = true;
  discardButton.disabled = true;
  window.hud.discard();
});

// The main process drives this once recording ends: encoding, then copying.
window.hud.onStatus((text) => {
  window.clearInterval(tick);
  document.body.classList.add('busy');
  statusLabel.hidden = false;
  statusLabel.textContent = text;
});
