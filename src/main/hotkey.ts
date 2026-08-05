// Taking a global hotkey, which is a request the operating system is free to
// refuse.
//
// A combination belongs to whichever application asked first, so the one in
// settings.json is a preference and not a promise. The failure is silent by
// nature: a hotkey nobody holds and a hotkey held by someone else both do
// nothing when pressed, and neither is distinguishable from an app that is not
// running. So this tries alternatives, and always reports which one it got.

import { globalShortcut } from 'electron';

/**
 * Tried in order when the wanted combination is unavailable. Deliberately
 * short: past a few attempts the answer is that this machine needs the setting
 * changed, and guessing further only makes the hotkey harder to predict.
 */
export const FALLBACKS = [
  'CommandOrControl+Shift+G',
  'CommandOrControl+Alt+G',
  'CommandOrControl+Shift+F9',
  'Alt+Shift+G',
];

/**
 * `register` returns false when another application holds the combination, and
 * throws when the string is not an accelerator at all. Both mean the same thing
 * to a caller working down a list.
 */
function tryBind(accelerator: string, handler: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, handler);
  } catch {
    return false;
  }
}

/**
 * Binds `wanted`, or the first fallback the system will give us.
 *
 * Returns what was actually bound, which the caller is expected to compare
 * against what it asked for, or null when every candidate was refused.
 */
export function bindFirstAvailable(wanted: string, handler: () => void): string | null {
  // The wanted one first, then the rest, and never the same one twice.
  const candidates = [wanted, ...FALLBACKS.filter((k) => k !== wanted)];

  for (const candidate of candidates) {
    if (tryBind(candidate, handler)) return candidate;
  }
  return null;
}

/** Hands a combination back, so the next application asking can have it. */
export function unbind(accelerator: string | null): void {
  if (!accelerator) return;
  try {
    globalShortcut.unregister(accelerator);
  } catch {
    // Never registered, or already gone. Either way there is nothing to undo.
  }
}
