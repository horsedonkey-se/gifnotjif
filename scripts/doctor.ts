// Runs under Electron: `npm run doctor`
//
// Reports what the app sees on this machine and proves the risky part, the
// DIP -> physical pixel conversion, against the real displays. A wrong
// conversion is the difference between capturing the window you selected and
// capturing an offset crop of something else.

import { app, screen } from 'electron';

import { ffmpegPath } from '../src/main/ffmpeg';
import { getPlatform } from '../src/main/platform';

app.disableHardwareAcceleration();

void app.whenReady().then(() => {
  const platform = getPlatform();
  const support = platform.isSupported();

  console.log(`platform  ${process.platform}`);
  console.log(`support   ${support.ok ? 'yes' : `no - ${support.reason}`}`);
  console.log(`ffmpeg    ${ffmpegPath}`);
  console.log(`electron  ${process.versions.electron}\n`);

  for (const d of screen.getAllDisplays()) {
    const b = d.bounds;
    console.log(
      `display ${d.id}${d.internal ? ' (internal)' : ''}\n` +
        `  dip bounds     ${b.width}x${b.height} at (${b.x},${b.y})\n` +
        `  scale factor   ${d.scaleFactor}\n` +
        `  rotation       ${d.rotation}deg`,
    );

    // A 100x100 DIP box, 50 DIP in from the display's top-left corner.
    const dip = { x: b.x + 50, y: b.y + 50, width: 100, height: 100 };
    const phys = screen.dipToScreenRect(null, dip);
    console.log(
      `  dip  (${dip.x},${dip.y}) ${dip.width}x${dip.height}\n` +
        `  ->   (${phys.x},${phys.y}) ${phys.width}x${phys.height} physical`,
    );

    // Electron rounds each edge independently, so a fractional scale can widen
    // the result by a pixel. That over-covers rather than crops, which is the
    // harmless direction. Anything further off means the conversion is wrong.
    const expected = 100 * d.scaleFactor;
    const drift = Math.max(
      Math.abs(phys.width - expected),
      Math.abs(phys.height - expected),
    );
    console.log(
      `  conversion     ${drift <= 1 ? 'ok' : `WRONG (expected ~${expected}px)`}` +
        `${drift > 0 && drift <= 1 ? ' (rounded outward by 1px)' : ''}\n`,
    );
  }

  const total = screen.getAllDisplays().reduce(
    (acc, d) => {
      const r = screen.dipToScreenRect(null, d.bounds);
      return {
        minX: Math.min(acc.minX, r.x),
        minY: Math.min(acc.minY, r.y),
        maxX: Math.max(acc.maxX, r.x + r.width),
        maxY: Math.max(acc.maxY, r.y + r.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  console.log(
    `virtual desktop, physical pixels: ` +
      `(${total.minX},${total.minY}) to (${total.maxX},${total.maxY})`,
  );
  if (total.minX < 0 || total.minY < 0) {
    console.log('negative origin present: capture offsets will be negative, which is fine');
  }

  app.quit();
});
