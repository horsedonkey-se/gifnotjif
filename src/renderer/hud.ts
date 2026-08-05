// A classic script, not a module. See the note at the top of overlay.ts.

const clockLabel = document.getElementById('clock')!;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const discardButton = document.getElementById('discard') as HTMLButtonElement;
const statusLabel = document.getElementById('status')!;

const startedAt = Date.now();

/** Seconds this take stops itself at, or 0 when nothing bounds it. */
const limitSecs = Number(new URLSearchParams(location.search).get('limit')) || 0;

/**
 * How long before the limit the bar starts saying so. Long enough to finish a
 * sentence and press stop deliberately, short enough that it is not nagging for
 * most of the recording.
 */
const WARN_SECS = 30;

const asClock = (s: number): string =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const tick = window.setInterval(() => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const left = limitSecs - s;

  // Counting up is what the user wants to read for all but the last few
  // seconds. Past that, what matters is how long is left, so the clock says so
  // rather than making them do the subtraction against a limit they set weeks
  // ago and cannot see.
  const warn = limitSecs > 0 && left <= WARN_SECS;
  document.body.classList.toggle('warn', warn);
  clockLabel.textContent = warn
    ? `${asClock(Math.max(0, left))} left`
    : asClock(s);
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
