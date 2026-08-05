// Runs under Electron: `npm run doctor`
//
// Reports what the app sees on this machine and proves the risky part, the
// DIP -> physical pixel conversion, against the real displays. A wrong
// conversion is the difference between capturing the window you selected and
// capturing an offset crop of something else.
//
//   npm run doctor -- --protection
//
// records the primary display for a few seconds with a bright content-protected
// window sitting in the middle of it, which is how the recording bar is kept
// out of a full-screen GIF. See protectionTest() at the bottom.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, screen } from 'electron';

import { DEFAULTS } from '../src/main/defaults';
import { ffmpegPath } from '../src/main/ffmpeg';
import { even } from '../src/main/overlay';
import { getPlatform } from '../src/main/platform';
import { startRecording } from '../src/main/recorder';
import type { Region as Rect } from '../src/main/types';

app.disableHardwareAcceleration();

// The protection test closes its windows before it has printed anything.
// Without this, Electron quits on the last one and takes the answer with it.
app.on('window-all-closed', () => {});

void app.whenReady().then(async () => {
  const platform = getPlatform();
  const support = platform.isSupported();

  console.log(`platform  ${process.platform} (${os.release()})`);
  console.log(`support   ${support.ok ? 'yes' : `no - ${support.reason}`}`);
  console.log(
    `hide bar  ${
      platform.canHideFromCapture()
        ? 'yes - a content-protected window stays out of the capture'
        : 'no - the bar has to sit outside the recorded region'
    }`,
  );
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

  if (process.argv.includes('--protection')) {
    try {
      await protectionTest();
    } catch (err) {
      console.error(`\nprotection test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  app.quit();
});

/**
 * A window filling `rect`, painted one flat colour, on top of everything.
 *
 * Carries the same options as the recording bar in src/main/hud.ts, so what
 * this proves about capture also holds for the bar. Transparency in particular
 * changes how Windows composites a window, and the bar is transparent.
 */
async function colourWindow(rect: Rect, css: string, protect: boolean): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    ...rect,
    show: false,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    backgroundColor: '#00000000',
  });
  win.setAlwaysOnTop(true, 'screen-saver');

  // Show, protect, then load: the same sequence, in the same order, as hud.ts.
  win.showInactive();
  if (protect) win.setContentProtection(true);

  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      `<body style="margin:0;height:100vh;background:${css}"></body>`,
    )}`,
  );
  return win;
}

/** Average colour of one frame of `file`, as [r, g, b]. */
async function averageColour(file: string): Promise<[number, number, number]> {
  const px = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', () => resolve(Buffer.concat(chunks)));
  });
  if (px.length < 3) throw new Error('ffmpeg produced no pixels to sample');
  return [px[0]!, px[1]!, px[2]!];
}

/**
 * The recording bar sits inside the recorded rectangle whenever the selection
 * fills the display, and only stays out of the GIF because Windows excludes a
 * content-protected window from the desktop composite gdigrab reads.
 *
 * That claim is gated on a build number in platform/win32.ts, not measured, so
 * measure it. Two stacked windows fill a small patch of screen: a plain green
 * one, and a magenta content-protected one exactly on top of it. Record the
 * patch and look at what came out. Nothing else is on screen inside the
 * rectangle, so the answer needs no interpretation and the recording contains
 * nothing of the user's desktop.
 */
async function protectionTest(): Promise<void> {
  const { workArea } = screen.getPrimaryDisplay();
  const rect: Rect = {
    x: Math.round(workArea.x + workArea.width / 2 - 180),
    y: Math.round(workArea.y + workArea.height / 2 - 60),
    width: 360,
    height: 120,
  };

  const behind = await colourWindow(rect, '#00ff00', false);
  const front = await colourWindow(rect, '#ff00ff', true);

  // Let both paint, so a capture that does include the front window includes
  // it from the first frame rather than halfway through.
  await new Promise((r) => setTimeout(r, 600));

  const region = screen.dipToScreenRect(null, rect);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gifnotjif-protection-'));
  const videoPath = path.join(dir, 'capture.mp4');

  console.log('\nrecording a protected window for 2s...');
  const rec = startRecording({
    x: region.x,
    y: region.y,
    width: even(region.width),
    height: even(region.height),
    fps: DEFAULTS.fps,
    outPath: videoPath,
  });

  let rgb: [number, number, number];
  try {
    await new Promise((r) => setTimeout(r, 2000));
    await rec.stop();
    rgb = await averageColour(videoPath);
  } finally {
    front.destroy();
    behind.destroy();
  }
  await fs.rm(dir, { recursive: true, force: true });

  const [r, g, b] = rgb;
  const verdict =
    g > 150 && r < 100 && b < 100
      ? 'excluded - the green window behind it came through. Content protection works here.'
      : r > 150 && b > 150 && g < 100
        ? 'CAPTURED - gdigrab ignores content protection on this machine. ' +
          'canHideFromCapture() in platform/win32.ts must return false.'
        : r < 60 && g < 60 && b < 60
          ? 'BLACKED OUT - the WDA_MONITOR fallback. Raise the build gate in ' +
            'platform/win32.ts; a black box in the GIF is no better than the bar.'
          : 'unclear. Something else was on top of the test windows; close it and rerun.';

  console.log(`captured rgb(${r},${g},${b})\nprotected window: ${verdict}`);
}
