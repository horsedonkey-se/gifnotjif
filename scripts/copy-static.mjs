// Copies everything tsc will not: the renderer's html and css, and the
// PowerShell clipboard helper. Paths under dist mirror the source tree, so
// __dirname-relative lookups in the compiled code resolve unchanged.
//
// Plain JavaScript on purpose: this runs before the TypeScript compiler does.

import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const copies = [
  ['src/renderer', 'dist/src/renderer'],
  ['src/main/scripts', 'dist/src/main/scripts'],
];

for (const [from, to] of copies) {
  await mkdir(path.join(root, to), { recursive: true });
  await cp(path.join(root, from), path.join(root, to), {
    recursive: true,
    // The .ts sources compile into the same folder; copying them would only
    // shadow the output with something Electron cannot run.
    filter: (src) => !src.endsWith('.ts'),
  });
}
