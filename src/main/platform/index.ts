// Everything platform-specific lives behind this one interface:
//
//   captureSupport()       -> { ok, reason? }  can this machine record at all
//   clipboardSupport()     -> { ok, reason? }  can a GIF go on the clipboard
//   captureArgs(options)   -> string[]         ffmpeg arguments
//   copyGifToClipboard(p)  -> Promise<unknown>
//   canHideFromCapture()   -> boolean          can a window be kept out of the capture
//
// The two support questions are separate because they fail separately. A
// missing clipboard tool still leaves the user a GIF on disk, so recording goes
// ahead and the file becomes the deliverable. A platform that cannot capture
// has nothing to offer, so it is refused before the overlay ever opens.

import * as darwin from './darwin';
import * as linux from './linux';
import * as win32 from './win32';
import type { PlatformAdapter } from '../types';

// Static, so the compiler checks every adapter against the interface. They
// only define functions, so importing the three of them costs nothing.
const adapters: Record<string, PlatformAdapter> = { win32, darwin, linux };

export function getPlatform(name: string = process.platform): PlatformAdapter {
  const adapter = adapters[name];
  if (adapter) return adapter;

  const unsupported = `${name} is not a supported platform`;
  return {
    captureSupport: () => ({ ok: false, reason: unsupported }),
    clipboardSupport: () => ({ ok: false, reason: unsupported }),
    captureArgs: () => {
      throw new Error(unsupported);
    },
    copyGifToClipboard: () => Promise.reject(new Error(unsupported)),
    canHideFromCapture: () => false,
  };
}
