import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

import { unpacked } from './paths';

if (!ffmpegStatic) {
  throw new Error('ffmpeg-static did not resolve a binary for this platform');
}

// ffmpeg-static exports the path to the bundled binary. Inside a packaged
// Electron app that path lands in app.asar, which cannot be executed.
export const ffmpegPath: string = unpacked(ffmpegStatic);

/**
 * Runs ffmpeg to completion and resolves with its stderr, which is where
 * ffmpeg writes everything interesting including progress and errors.
 */
export function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(stderr);
      reject(new Error(`ffmpeg exited ${code}\n${tail(stderr)}`));
    });
  });
}

/** Last few lines of ffmpeg output: the error is always at the bottom. */
export function tail(text: string, lines = 12): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}
