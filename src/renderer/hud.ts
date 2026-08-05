// A classic script, not a module. See the note at the top of overlay.ts.

const clockLabel = document.getElementById('clock')!;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const statusLabel = document.getElementById('status')!;

const startedAt = Date.now();

const tick = window.setInterval(() => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  clockLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}, 250);

stopButton.addEventListener('click', () => {
  stopButton.disabled = true;
  window.hud.stop();
});

// The main process drives this once recording ends: encoding, then copying.
window.hud.onStatus((text) => {
  window.clearInterval(tick);
  document.body.classList.add('busy');
  statusLabel.hidden = false;
  statusLabel.textContent = text;
});
