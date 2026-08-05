import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import { DEFAULTS, type Settings } from './defaults';

export { DEFAULTS, type Settings };

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function load(): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULTS, ...saved };
  } catch {
    // Missing or corrupt file: defaults are always a valid answer.
    return { ...DEFAULTS };
  }
}

/**
 * Calls back whenever settings.json changes on disk.
 *
 * The directory is watched rather than the file, for two reasons: the file need
 * not exist yet, and a careful editor saves by writing a temporary file and
 * renaming it over the target, which destroys the identity of anything watching
 * the file itself. A directory outlives both.
 *
 * A single save produces several events on every platform, so the callback is
 * debounced. It also fires while the editor has written half a file, which is
 * why nothing here parses: `load` already treats an unreadable file as the
 * defaults, and the settled state a moment later is the one that counts.
 */
export function watch(onChange: () => void): () => void {
  const dir = path.dirname(file());
  fs.mkdirSync(dir, { recursive: true });

  let timer: NodeJS.Timeout | null = null;
  const watcher = fs.watch(dir, (_event, name) => {
    if (name !== null && path.basename(name) !== 'settings.json') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, SETTLE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}

/**
 * How long the file must sit still before it is read. Long enough to cover the
 * write-then-rename an editor does, short enough that saving the file and
 * looking at the tray feel like one action.
 */
const SETTLE_MS = 300;

export function save(patch: Partial<Settings>): Settings {
  const next = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
