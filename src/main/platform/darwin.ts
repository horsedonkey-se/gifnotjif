// STUB. Written from research, never run. Do not trust it until someone has
// executed it on a Mac and pasted the result into Slack.
//
// Capture: avfoundation lists screens as numbered devices, so the input is
// `-f avfoundation -i "<screenIndex>:none"`. It cannot crop at the source the
// way gdigrab can, so the region has to come out of a crop filter instead.
// First run triggers the Screen Recording permission prompt, and the app must
// be restarted after the user grants it.
//
// Clipboard: NSPasteboard, driven either from JXA via `osascript -l JavaScript`
// or a small compiled Swift helper. Write both the file URL (so chat apps
// upload and animate it) and the raw bytes under `com.compuserve.gif`.
//
// Known dead end: `osascript -e 'set the clipboard to (read (POSIX file "x.gif")
// as «class GIFf»)'` silently copies only the first frame. Do not use it.

import type { CaptureOptions, Support } from '../types';

interface DarwinCaptureOptions extends CaptureOptions {
  screenIndex?: number;
}

const NOT_IMPLEMENTED =
  'macOS support is not implemented yet. The GIF was saved to disk instead.';

export function isSupported(): Support {
  return { ok: false, reason: NOT_IMPLEMENTED };
}

/**
 * setContentProtection sets NSWindowSharingNone here, which should keep the
 * window out of an avfoundation screen capture. Nobody has run it, so claim
 * nothing and let the recording bar place itself outside the region instead.
 */
export function canHideFromCapture(): boolean {
  return false;
}

export function captureArgs({
  x,
  y,
  width,
  height,
  fps,
  outPath,
  screenIndex = 1,
}: DarwinCaptureOptions): string[] {
  return [
    // See the comment in win32.ts: without this, ffmpeg probes for megabytes
    // before it starts encoding and short recordings come back empty.
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'avfoundation',
    '-capture_cursor', '1',
    '-framerate', String(fps),
    '-i', `${screenIndex}:none`,
    '-vf', `crop=${width}:${height}:${x}:${y}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-qp', '0',
    '-pix_fmt', 'yuv444p',
    '-y', outPath,
  ];
}

export function copyGifToClipboard(): Promise<never> {
  return Promise.reject(new Error(NOT_IMPLEMENTED));
}
