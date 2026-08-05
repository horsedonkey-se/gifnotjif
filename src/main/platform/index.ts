// Everything platform-specific lives behind this one interface:
//
//   isSupported()          -> { ok, reason? }
//   captureArgs(options)   -> string[]  ffmpeg arguments
//   copyGifToClipboard(p)  -> Promise<void>
//
// Adapters that are not implemented still return usable captureArgs and a
// truthful isSupported(), so the caller can fall back to saving the file.

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
    isSupported: () => ({ ok: false, reason: unsupported }),
    captureArgs: () => {
      throw new Error(unsupported);
    },
    copyGifToClipboard: () => Promise.reject(new Error(unsupported)),
  };
}
