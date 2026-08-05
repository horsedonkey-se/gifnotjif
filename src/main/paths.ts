import path from 'node:path';

/**
 * Rewrites a path inside app.asar to point at the unpacked copy beside it.
 *
 * A packaged Electron app serves most files out of the asar archive, and two
 * kinds of file cannot be read that way: a binary cannot be executed, and an
 * external interpreter (powershell.exe, osascript) cannot open the script it is
 * handed. Both are listed under asarUnpack in package.json, which puts a real
 * copy in app.asar.unpacked; this points at it.
 *
 * Harmless when running from source, where no such segment appears.
 */
export const unpacked = (p: string): string =>
  p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
