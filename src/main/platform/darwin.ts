// macOS. Written against the docs and the ffmpeg source, then left for the
// verification steps in the README to confirm.
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

export function captureSupport(): Support {
  const status = screenAccess();
  // 'not-determined' is the first run. Recording is what raises the system
  // prompt, so refusing here would mean the user never got asked.
  if (status === 'denied' || status === 'restricted') {
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

/** The on-screen windows, frontmost first. Never rejects; see win32.ts. */
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
            raw.map((w) => ({
              title: w.title,
              pid: w.pid,
              bounds: { x: w.x, y: w.y, width: w.width, height: w.height },
            })),
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
    // See the comment in win32.ts: without this, ffmpeg probes for megabytes
    // before it starts encoding and short recordings come back empty.
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'avfoundation',
    '-capture_cursor', drawMouse ? '1' : '0',
    // The click halo is an artefact of the recording, not of the desktop.
    '-capture_mouse_clicks', '0',
    '-framerate', String(fps),
    // ":none" is the audio device. There is no sound in a GIF.
    '-i', `${deviceFor(display ? display.index : 0)}:none`,
    '-vf', `crop=${width}:${height}:${x - originX}:${y - originY}`,
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
