import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

import type { CaptureOptions, Support } from '../types';

// Packaged builds must unpack this script: powershell.exe cannot read a file
// from inside app.asar. See asarUnpack in the build config.
const COPY_SCRIPT = path
  .join(__dirname, '..', 'scripts', 'copy-gif.ps1')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

export function isSupported(): Support {
  return { ok: true };
}

/**
 * Electron's setContentProtection calls SetWindowDisplayAffinity, and the
 * affinity that removes a window from a capture rather than blacking it out,
 * WDA_EXCLUDEFROMCAPTURE, arrived in Windows 10 2004 (build 19041). Older
 * builds fall back to WDA_MONITOR, which paints a black rectangle into the
 * recording: worse than simply showing the bar.
 *
 * os.release() reports the NT version, "10.0.19045", so the build is the third
 * field. Windows 11 reports 10.0.22000 and up, which passes the same test.
 */
export function canHideFromCapture(): boolean {
  const build = Number(os.release().split('.')[2]);
  return Number.isFinite(build) && build >= 19041;
}

/**
 * gdigrab offsets are relative to the virtual desktop origin, and so are the
 * physical-pixel bounds we get from Electron's screen module, so they can be
 * passed through unchanged. They may legitimately be negative when a display
 * sits above or to the left of the primary one.
 */
export function captureArgs({
  x,
  y,
  width,
  height,
  fps,
  outPath,
  drawMouse = true,
}: CaptureOptions): string[] {
  return [
    // Start encoding on the first frame instead of probing for one.
    // ffmpeg's default 5MB probesize is measured in bytes, not time, so a
    // small region at a low frame rate can spend seconds gathering it: a
    // 300x200 capture at 10fps produces 2.4MB/s and stalls for ~2s. Any
    // recording stopped before probing finished used to yield zero frames and
    // an empty file, and short clips of small regions would fail outright.
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'gdigrab',
    '-framerate', String(fps),
    '-draw_mouse', drawMouse ? '1' : '0',
    '-offset_x', String(x),
    '-offset_y', String(y),
    '-video_size', `${width}x${height}`,
    '-i', 'desktop',
    // Lossless 4:4:4 intermediate. Chroma subsampling would smear the edges of
    // coloured text before the GIF palette ever sees it, and this file is
    // thrown away seconds later, so size does not matter much.
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-qp', '0',
    '-pix_fmt', 'yuv444p',
    '-y', outPath,
  ];
}

export function copyGifToClipboard(gifPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-STA', // System.Windows.Forms.Clipboard requires a single-threaded apartment
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', COPY_SCRIPT,
        '-Path', gifPath,
      ],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          return reject(
            new Error(`clipboard copy failed: ${(stderr || err.message).trim()}`),
          );
        }
        resolve(stdout.trim());
      },
    );
  });
}
