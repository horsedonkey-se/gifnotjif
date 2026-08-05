// STUB. Written from research, never run. Do not trust it until someone has
// executed it on a Linux box.
//
// Capture: x11grab crops at the source, so it maps onto gdigrab almost exactly.
// Wayland is the real work. There is no direct grab; capture has to go through
// xdg-desktop-portal and PipeWire, which means a portal request and a user
// consent dialog on every recording. Sessions running XWayland will fall
// through to x11grab and appear to work until they hit a native Wayland window,
// which captures as black.
//
// Clipboard: MIME-typed, so both formats can be offered.
//   wl-copy -t image/gif < out.gif        (Wayland)
//   xclip -selection clipboard -t image/gif -i out.gif   (X11)
// Also offer `text/uri-list` holding a file:// URL, which is what file managers
// and most GTK apps read for a paste-as-file. wl-copy can only serve one type
// per invocation, so this needs two clipboard owners or a small helper that
// advertises both.

import type { CaptureOptions, Support } from '../types';

interface LinuxCaptureOptions extends CaptureOptions {
  display?: string;
}

const NOT_IMPLEMENTED =
  'Linux support is not implemented yet. The GIF was saved to disk instead.';

export function isSupported(): Support {
  return { ok: false, reason: NOT_IMPLEMENTED };
}

/** X11 has no display affinity, so x11grab records the bar whatever we ask. */
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
  display = ':0.0',
}: LinuxCaptureOptions): string[] {
  return [
    // See the comment in win32.ts: without this, ffmpeg probes for megabytes
    // before it starts encoding and short recordings come back empty.
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'x11grab',
    '-framerate', String(fps),
    '-draw_mouse', '1',
    '-video_size', `${width}x${height}`,
    '-i', `${display}+${x},${y}`,
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
