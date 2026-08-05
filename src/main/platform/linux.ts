// Linux. X11 only, on purpose.
//
// x11grab crops at the source and reads one root window whose coordinates are
// the virtual desktop, so it maps onto gdigrab almost exactly.
//
// Wayland is refused rather than half-supported. There is no direct grab; a
// capture has to go through xdg-desktop-portal and PipeWire, with a consent
// dialog on every recording. What makes silence dangerous here is XWayland: it
// sets DISPLAY, so x11grab starts and appears to work, and then records every
// native Wayland window as a black rectangle. A recording that fails honestly
// is worth more than one that fails convincingly.
//
// The clipboard is MIME-typed, which sounds like an advantage and is not: both
// xclip and wl-copy advertise exactly one type per invocation, and a second
// invocation takes ownership away from the first. So one type is chosen, and
// which one is a setting.

import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import type { CaptureOptions, ClipboardOptions, Support, WindowInfo } from '../types';

/** What most apps read for a paste-as-file, and the nearest thing to CF_HDROP. */
const DEFAULT_MIME = 'text/uri-list';

const WAYLAND_UNSUPPORTED =
  'Wayland capture needs the xdg-desktop-portal screencast API, which is not ' +
  'implemented yet. Log into an Xorg session to record.';

const NO_DISPLAY = 'No X11 display: DISPLAY is not set, so there is nothing to record.';

type Session = 'x11' | 'wayland' | 'none';

/**
 * Which display server this session is really on.
 *
 * XDG_SESSION_TYPE is set by the login manager and is the reliable answer.
 * WAYLAND_DISPLAY catches sessions started without one. DISPLAY is checked
 * last, because under XWayland it is set on a Wayland session too, which is the
 * whole trap.
 */
function session(): Session {
  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY) {
    return 'wayland';
  }
  if (process.env.DISPLAY) return 'x11';
  return 'none';
}

/** Looks for an executable on PATH, without depending on `which` being installed. */
function onPath(command: string): boolean {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => {
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The clipboard tool this session needs, and whether it is installed. */
function clipboardTool(): { command: 'xclip' | 'wl-copy'; install: string } {
  return session() === 'wayland'
    ? { command: 'wl-copy', install: 'wl-clipboard (apt install wl-clipboard)' }
    : { command: 'xclip', install: 'xclip (apt install xclip)' };
}

/** What doctor prints, so a Wayland refusal can be traced to the variable that caused it. */
export function describeSession(): string {
  const { command } = clipboardTool();
  const env = (name: string): string => process.env[name] || 'unset';
  return (
    `session ${session()} (XDG_SESSION_TYPE=${env('XDG_SESSION_TYPE')}, ` +
    `DISPLAY=${env('DISPLAY')}, WAYLAND_DISPLAY=${env('WAYLAND_DISPLAY')})\n` +
    `  clipboard tool ${command} ${onPath(command) ? 'found' : 'NOT FOUND on PATH'}`
  );
}

export function captureSupport(): Support {
  switch (session()) {
    case 'wayland':
      return { ok: false, reason: WAYLAND_UNSUPPORTED };
    case 'none':
      return { ok: false, reason: NO_DISPLAY };
    default:
      return { ok: true };
  }
}

export function clipboardSupport(): Support {
  const { command, install } = clipboardTool();
  if (!onPath(command)) {
    return { ok: false, reason: `${command} is not installed. Install ${install} to copy the GIF.` };
  }
  return { ok: true };
}

/**
 * Listing windows needs xwininfo, from x11-utils. It is refused by name when
 * absent, exactly as the clipboard is when xclip is missing, and for the same
 * reason: an install line is worth more to the reader than a silent absence.
 */
export function windowListSupport(): Support {
  if (session() === 'wayland') return { ok: false, reason: WAYLAND_UNSUPPORTED };
  if (session() === 'none') return { ok: false, reason: NO_DISPLAY };
  if (!onPath('xwininfo')) {
    return {
      ok: false,
      reason:
        'xwininfo is not installed. Install x11-utils (apt install x11-utils) ' +
        'to pick a window.',
    };
  }
  return { ok: true };
}

/**
 * Every mapped, titled child of the root window, with its geometry.
 *
 * `xwininfo -root -children` prints one line per child, and the shape is fixed
 * enough to read with a regular expression:
 *
 *   0x3a00007 "Firefox": ("Navigator" "firefox")  1080x1201+2560+-201  +2560+-201
 *
 * The first geometry is relative to the parent and the second is absolute, and
 * for a direct child of the root they are the same thing. The absolute one is
 * taken because that is what it claims to be.
 *
 * X11 gives up a window's owning process only through a separate _NET_WM_PID
 * round trip per window, which is not worth a process launch each, so pid is
 * -1 here and the caller filters its own overlays by title instead.
 */
export function listWindows(): Promise<WindowInfo[]> {
  if (!windowListSupport().ok) return Promise.resolve([]);

  return new Promise((resolve) => {
    execFile(
      'xwininfo',
      ['-root', '-children'],
      { encoding: 'utf8', timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve([]);

        const found: WindowInfo[] = [];
        const line =
          /^\s*0x[0-9a-f]+\s+"(.+?)":\s+\([^)]*\)\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)\s+\+(-?\d+)\+(-?\d+)/;

        for (const text of stdout.split('\n')) {
          const m = line.exec(text);
          if (!m) continue;

          const width = Number(m[2]);
          const height = Number(m[3]);
          // As on Windows: below this it is a shell helper, not something
          // anyone means to record.
          if (width < 32 || height < 32) continue;

          found.push({
            title: m[1] ?? '',
            pid: -1,
            bounds: { x: Number(m[6]), y: Number(m[7]), width, height },
          });
        }

        // xwininfo prints children bottom to top; the picker wants the
        // frontmost first so an overlap resolves to the window on top.
        resolve(found.reverse());
      },
    );
  });
}

/**
 * X11 has no display affinity, and Electron's setContentProtection is a no-op
 * here, so x11grab records the bar whatever we ask. hud.ts already handles
 * that: the bar goes outside the region, or onto another display, or nowhere.
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
  drawMouse = true,
}: CaptureOptions): string[] {
  // DISPLAY already carries the screen suffix where there is one, so pass it
  // through rather than assuming ':0.0'.
  const display = process.env.DISPLAY ?? ':0';

  return [
    // See the comment in win32.ts: without this, ffmpeg probes for megabytes
    // before it starts encoding and short recordings come back empty.
    '-probesize', '32',
    '-analyzeduration', '0',
    '-f', 'x11grab',
    '-framerate', String(fps),
    '-draw_mouse', drawMouse ? '1' : '0',
    '-video_size', `${width}x${height}`,
    // One root window spans every monitor, so these are the same
    // virtual-desktop coordinates gdigrab takes.
    '-i', `${display}+${x},${y}`,
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
 * Puts the GIF on the clipboard under one MIME type.
 *
 * text/uri-list holds a file:// URL, which is what browsers, chat apps and file
 * managers read for a paste-as-file, and it animates because the receiving app
 * uploads the file rather than decoding a still. Setting it means the GIF
 * cannot be deleted afterwards, exactly as on Windows, which index.ts already
 * accounts for.
 *
 * GTK file managers actually want x-special/gnome-copied-files, and some web
 * apps want image/gif. Offering all three at once would mean owning the
 * selection ourselves rather than handing it to xclip, so instead the type is a
 * setting and the default is the one that works in the most places.
 */
export function copyGifToClipboard(
  gifPath: string,
  { mimeType = DEFAULT_MIME }: ClipboardOptions = {},
): Promise<string> {
  // A uri-list is CRLF-terminated per RFC 2483, and the URL must be
  // percent-encoded, which pathToFileURL does.
  const payload =
    mimeType === 'text/uri-list' ? `${pathToFileURL(gifPath).href}\r\n` : fs.readFileSync(gifPath);

  const { command } = clipboardTool();
  const args =
    command === 'wl-copy'
      ? ['--type', mimeType]
      : ['-selection', 'clipboard', '-t', mimeType];

  return new Promise((resolve, reject) => {
    // Both tools fork and keep running: on X11 and Wayland alike the clipboard
    // is served by whoever owns the selection, so the process that wrote it has
    // to outlive the write. Detach it and let it go, or the paste breaks the
    // moment this app exits.
    const child = spawn(command, args, {
      detached: true,
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    // The daemon inherits this pipe and holds it until it loses the selection,
    // which may be hours. Letting go of our end keeps a plain-node caller like
    // spike.ts able to exit; the fork is quick enough that a real failure has
    // already arrived by the time either of these runs.
    const release = (): void => {
      child.stderr?.destroy();
      child.unref();
    };

    child.on('error', (err) => {
      release();
      reject(new Error(`clipboard copy failed: could not run ${command}: ${err.message}`));
    });

    child.stdin?.on('error', (err) => {
      release();
      reject(new Error(`clipboard copy failed: ${err.message}`));
    });

    // Exit 0 is the normal path and says nothing about success: both tools fork
    // a daemon and the parent leaves immediately. Only a failing code is news.
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`clipboard copy failed: ${command} exited ${code}\n${stderr.trim()}`));
      }
      release();
    });

    // Resolve once the payload is through rather than on exit. The process that
    // matters is the daemon, and waiting for it would wait forever.
    child.stdin?.end(payload, () => {
      release();
      resolve(`copied ${gifPath} as ${mimeType}`);
    });
  });
}
