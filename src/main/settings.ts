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

export function save(patch: Partial<Settings>): Settings {
  const next = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
