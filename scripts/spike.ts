// Drives the real capture -> encode -> clipboard modules with no Electron in
// the way, so the risky parts can be verified before any UI exists.
//
//   npm run spike
//   npm run spike -- --x 100 --y 100 --w 640 --h 480 --secs 8 --fps 15
//
// Then paste into Slack, Discord, a GitHub comment box, and a file manager.
//
// There is no Electron here and so no screen module, which means no display is
// passed to the capture. On macOS that takes the primary-display fallback in
// platform/darwin.ts, so the coordinates are read against the primary display
// whatever the arguments say.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startRecording } from '../src/main/recorder';
import { encodeGif } from '../src/main/encoder';
import { getPlatform } from '../src/main/platform';
import { DEFAULTS } from '../src/main/defaults';

type Args = Partial<Record<'x' | 'y' | 'w' | 'h' | 'fps' | 'secs', number>>;

function parseArgs(argv: string[]): Args {
  const out: Record<string, number> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key && value !== undefined) out[key] = Number(value);
  }
  return out as Args;
}

/** gdigrab and libx264 both want even dimensions. */
const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const region = {
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: even(opts.w ?? 800),
    height: even(opts.h ?? 600),
  };
  const fps = opts.fps ?? DEFAULTS.fps;
  const secs = opts.secs ?? 5;

  const platform = getPlatform();
  const canCapture = platform.captureSupport();
  if (!canCapture.ok) {
    throw new Error(canCapture.reason);
  }
  const support = platform.clipboardSupport();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gifnotjif-'));
  const videoPath = path.join(dir, 'capture.mp4');
  const gifPath = path.join(dir, 'capture.gif');

  console.log(
    `recording ${region.width}x${region.height} at (${region.x},${region.y}) ` +
      `for ${secs}s at ${fps}fps`,
  );

  const rec = startRecording({ ...region, fps, outPath: videoPath });
  await new Promise((r) => setTimeout(r, secs * 1000));
  await rec.stop();
  console.log(`captured  ${await sizeOf(videoPath)}`);

  console.log('encoding gif...');
  await encodeGif(videoPath, gifPath, {
    fps,
    maxWidth: DEFAULTS.maxWidth,
    colors: DEFAULTS.colors,
    dither: DEFAULTS.dither,
  });
  console.log(`encoded   ${await sizeOf(gifPath)}`);

  if (!support.ok) {
    // Keep the file: on an unsupported platform it is the whole deliverable.
    console.log(`\n${support.reason}\nsaved to ${gifPath}`);
    return;
  }

  await platform.copyGifToClipboard(gifPath, { mimeType: DEFAULTS.clipboardMimeType });
  console.log(`\ncopied to clipboard\nfile kept at ${gifPath}`);
  console.log('\nnow paste into Slack, Discord, a GitHub comment, and a file manager.');
}

async function sizeOf(file: string): Promise<string> {
  const { size } = await fs.stat(file);
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
