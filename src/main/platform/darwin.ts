// macOS. Run end to end on macOS 26.2, Apple Silicon, one display.
//
// Three things the paper version had wrong, all found on that first real run:
// the DIP conversions were Windows-only APIs and simply absent here (see
// dpi.ts); -probesize/-analyzeduration copied from win32.ts wedged avfoundation
// past stopping (see captureArgs); and CGWindowListCopyWindowInfo measures in
// points, not pixels (see listWindows).
//
// Still unverified: anything with a second display, which covers deviceFor and
// the fallbacks in dpi.ts, and canHideFromCapture, which claims nothing.
//
// Capture is avfoundation, which differs from gdigrab in two ways that matter.
// It records one display at a time, addressed by a device number that is not
// the display number, so the device list has to be read out of ffmpeg. And it
// cannot crop at the source, so the region comes out of a crop filter, in that
// display's own coordinates rather than the virtual desktop's.
//
// Clipboard is NSPasteboard, driven through JXA. See scripts/copy-gif.jxa.js.
// Known dead end: `osascript -e 'set the clipboard to (read (POSIX file "x.gif")
// as «class GIFf»)'` silently copies only the first frame. Do not use it.

import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';

import { dipToPhysicalRect } from '../dpi';
import { ffmpegPath } from '../ffmpeg';
import { unpacked } from '../paths';
import type { CaptureOptions, Support, WindowInfo } from '../types';

// osascript cannot read a script out of app.asar, exactly as powershell.exe
// cannot. See asarUnpack in the build config.
const COPY_SCRIPT = unpacked(path.join(__dirname, '..', 'scripts', 'copy-gif.jxa.js'));
const LIST_WINDOWS_SCRIPT = unpacked(
  path.join(__dirname, '..', 'scripts', 'list-windows.jxa.js'),
);

const NO_PERMISSION =
  'macOS has not granted Screen Recording permission. Open System Settings > ' +
  'Privacy & Security > Screen Recording, switch gifnotjif on, then restart it.';

/**
 * The Screen Recording permission, or null when there is no Electron to ask.
 *
 * The import is deliberately lazy. platform/index.ts imports all three adapters
 * so the compiler can check them, and scripts/spike.ts runs the same modules
 * under plain node, where a top-level `electron` import would fail on every
 * platform including Windows.
 */
function screenAccess(): string | null {
  try {
    const electron = require('electron') as typeof import('electron');
    return electron.systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return null;
  }
}

/**
 * Raises the Screen Recording prompt on the first run, and waits for an answer.
 *
 * The old plan was to let 'not-determined' through and let the recording itself
 * raise the prompt. The risk is that the thing which captures is a spawned
 * ffmpeg rather than the app, so there is no guarantee the attempt raises
 * anything; whether TCC attributes it back to the app was never established
 * here, and a maybe is a poor thing to hang a first run on.
 *
 * What is measured is the cost of guessing wrong. With the permission refused,
 * ffmpeg opens the device, receives no frames at all, and blocks inside
 * avfoundation waiting for a first one -- deaf to 'q', to SIGINT and to its own
 * `-t` limit, so even a self-limiting capture never returns. recorder.ts can
 * kill that now, but the take is gone with it, so it is much better not to
 * start one.
 *
 * desktopCapturer.getSources is the app itself asking, which is the call TCC
 * does have a prompt for. The sources are thrown away; raising the prompt and
 * settling the status is the whole point, and the thumbnail is shrunk to
 * nothing so no screen is actually read to build one.
 */
export async function requestCaptureAccess(): Promise<void> {
  if (screenAccess() !== 'not-determined') return;
  try {
    const electron = require('electron') as typeof import('electron');
    await electron.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
  } catch {
    // No Electron, or the call failed. captureSupport reads the status next
    // and a still-undetermined one is handled there.
  }
}

export function captureSupport(): Support {
  const status = screenAccess();
  if (status === 'denied' || status === 'restricted') {
    return { ok: false, reason: NO_PERMISSION };
  }
  // Still undetermined after requestCaptureAccess means the prompt never got
  // an answer, and going ahead would hang ffmpeg on a capture it will never be
  // allowed to make. Refusing says the same sentence a denial does, which is
  // the one that leads to the switch that fixes it.
  if (status === 'not-determined') {
    return { ok: false, reason: NO_PERMISSION };
  }
  return { ok: true };
}

/** osascript ships with the OS, so there is nothing here that can be missing. */
export function clipboardSupport(): Support {
  return { ok: true };
}

/**
 * Same permission as capture, and for a sharper reason than it looks:
 * CGWindowListCopyWindowInfo returns geometry to anyone, but leaves out window
 * *titles* unless Screen Recording is granted. A picker that could show only
 * untitled rectangles is worse than one that says why it cannot.
 */
export function windowListSupport(): Support {
  const status = screenAccess();
  if (status === 'denied' || status === 'restricted') {
    return { ok: false, reason: NO_PERMISSION };
  }
  return { ok: true };
}

/** One row of list-windows.jxa.js's JSON. */
interface RawWindow {
  title: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The on-screen windows, frontmost first. Never rejects; see win32.ts.
 *
 * CGWindowListCopyWindowInfo measures in points, and `WindowInfo.bounds` is in
 * physical pixels, so every rectangle is converted on the way out. Windows
 * needs no such step because its window rectangles are already physical. Skip
 * it and every window comes back at half size and half position on a Retina
 * display, which is exactly the offset that makes a picker look plausible and
 * land on the wrong window.
 */
export function listWindows(): Promise<WindowInfo[]> {
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', LIST_WINDOWS_SCRIPT],
      { encoding: 'utf8', timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          const raw = JSON.parse(stdout) as RawWindow[];
          resolve(
            raw.map((w) => {
              const b = dipToPhysicalRect(null, {
                x: w.x,
                y: w.y,
                width: w.width,
                height: w.height,
              });
              return {
                title: w.title,
                pid: w.pid,
                bounds: {
                  x: Math.round(b.x),
                  y: Math.round(b.y),
                  width: Math.round(b.width),
                  height: Math.round(b.height),
                },
              };
            }),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
}

/**
 * setContentProtection sets NSWindowSharingNone, which is documented for window
 * sharing and says nothing about a whole-display grab. So claim nothing, and
 * let the recording bar place itself outside the region instead.
 *
 * `npm run doctor -- --protection` measures the real answer. If it reports that
 * the window behind came through, this may return true.
 */
export function canHideFromCapture(): boolean {
  return false;
}

/**
 * avfoundation device numbers for the screens, in the order ffmpeg lists them.
 *
 * Cached for the life of the process: the list costs an ffmpeg run of roughly
 * 200ms, and displays do not come and go often enough to pay that on every
 * recording.
 */
let screenDevices: number[] | null = null;

/**
 * Reads the device list out of ffmpeg.
 *
 *   ffmpeg -f avfoundation -list_devices true -i ""
 *
 * always exits non-zero, because listing devices is not a job it can finish,
 * and writes the list to stderr:
 *
 *   [AVFoundation indev @ 0x...] [0] FaceTime HD Camera
 *   [AVFoundation indev @ 0x...] [1] Capture screen 0
 *
 * Cameras are numbered first, so the screens rarely start at 0. Synchronous
 * because captureArgs is, and it only ever runs once.
 */
function listScreenDevices(): number[] {
  if (screenDevices) return screenDevices;

  let output = '';
  try {
    output = execFileSync(ffmpegPath, ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
      // This runs on the main process while the user is holding a hotkey, so
      // it must not be able to hang the app. An empty list is survivable.
      timeout: 5000,
    });
  } catch (err) {
    // The expected path: a non-zero exit with the list on stderr.
    const { stderr } = err as { stderr?: string | Buffer };
    output = stderr ? String(stderr) : '';
  }

  const found: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /\[(\d+)\]\s+Capture screen \d+/.exec(line);
    if (match?.[1]) found.push(Number(match[1]));
  }

  // Only cache a real answer. An empty list means ffmpeg failed to run or the
  // output changed shape, and caching that would make one bad moment permanent.
  if (found.length) screenDevices = found;
  return found;
}

/** The mapping as doctor prints it, so a wrong device can be seen rather than guessed at. */
export function describeDevices(): string {
  const devices = listScreenDevices();
  return devices.length
    ? devices.map((device, i) => `display ${i} -> device ${device}`).join(', ')
    : 'none: ffmpeg listed no capture screens';
}

/**
 * The avfoundation device for a display, by its position in the screen list.
 *
 * This is the weak joint of the port. ffmpeg lists screens in CGDirectDisplayID
 * order and Electron enumerates them the same way, but nothing promises the two
 * agree, so `npm run doctor` prints the mapping for checking. Falls back to the
 * first screen device rather than failing: recording the wrong screen is at
 * least visibly wrong, where an exception mid-hotkey is just baffling.
 */
function deviceFor(index: number): number {
  const devices = listScreenDevices();
  return devices[index] ?? devices[0] ?? 0;
}

export function captureArgs({
  x,
  y,
  width,
  height,
  fps,
  outPath,
  drawMouse = true,
  display,
}: CaptureOptions): string[] {
  // avfoundation hands back one display in its own coordinates, so the crop is
  // measured from that display's corner rather than the virtual desktop's.
  // Without a display, assume the primary one sitting at the origin.
  const originX = display ? display.bounds.x : 0;
  const originY = display ? display.bounds.y : 0;

  return [
    // No -probesize/-analyzeduration here, unlike win32.ts, and the difference
    // is load-bearing rather than an oversight.
    //
    // gdigrab announces its frame rate, so cutting the probe short costs
    // nothing and saves a slow start. avfoundation announces nothing, and one
    // uyvy422 frame of a 2940x1912 screen is about 11MB, so a 32-byte probe
    // cannot hold even a fraction of one. ffmpeg then gives up on estimating
    // ("not enough frames to estimate rate; consider increasing probesize")
    // and falls back to 1000k tbr -- a million frames a second.
    //
    // That number is not cosmetic. The output stream inherits it, and ffmpeg
    // sets about duplicating frames to fill a million-fps timeline, so it never
    // emits frame 1 and never gets back to the loop that reads 'q' or handles
    // SIGINT. The recording then cannot be stopped at all.
    '-f', 'avfoundation',
    '-capture_cursor', drawMouse ? '1' : '0',
    // The click halo is an artefact of the recording, not of the desktop.
    '-capture_mouse_clicks', '0',
    // Asked for, and not granted: avfoundation logs "Configuration of video
    // device failed, falling back to default" for screen devices and runs at
    // the display's own rate. The output rate is pinned by the fps filter
    // below, which is what actually decides the recording.
    '-framerate', String(fps),
    // ":none" is the audio device. There is no sound in a GIF.
    '-i', `${deviceFor(display ? display.index : 0)}:none`,
    // setpts, then fps, and both are required.
    //
    // avfoundation timestamps frames against the mach clock, so the first one
    // arrives at however long this Mac has been awake -- 188459s in the run
    // this was diagnosed from. Subtracting STARTPTS puts the take at zero,
    // where mp4 expects it; without it ffmpeg reports a time of -577014:32:22
    // and writes a file no player will seek.
    //
    // fps then pins the output rate rather than leaving it to whatever the
    // input claimed, which is the guard against the million-fps fallback ever
    // reaching the encoder again.
    '-vf',
    `crop=${width}:${height}:${x - originX}:${y - originY},setpts=PTS-STARTPTS,fps=${fps}`,
    // The rate above is a real one, so the muxer gets constant frames and the
    // duplicate-until-death path is closed off explicitly as well as by value.
    '-fps_mode', 'cfr',
    // Lossless 4:4:4 intermediate, as on Windows: chroma subsampling would
    // smear the edges of coloured text before the GIF palette ever saw them.
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-qp', '0',
    '-pix_fmt', 'yuv444p',
    '-y', outPath,
  ];
}

/**
 * The macOS pasteboard is held by the window server, so unlike xclip on Linux
 * nothing has to stay resident here: osascript writes and exits.
 */
export function copyGifToClipboard(gifPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', COPY_SCRIPT, gifPath], (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(`clipboard copy failed: ${(stderr || err.message).trim()}`));
      }
      resolve(stdout.trim());
    });
  });
}
