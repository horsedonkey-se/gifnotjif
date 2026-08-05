import { spawn } from 'node:child_process';
import { ffmpegPath, tail } from './ffmpeg';
import { getPlatform } from './platform';
import type { CaptureOptions, Recording } from './types';

/**
 * Starts a screen recording and returns a handle.
 *
 *   const rec = startRecording({ x, y, width, height, fps, outPath })
 *   await rec.stop()      // resolves once the file is closed and playable
 *
 * Coordinates are physical pixels on the virtual desktop, already scaled for
 * DPI by the caller. Width and height must be even.
 */
export function startRecording(options: CaptureOptions): Recording {
  const platform = getPlatform();
  const args = platform.captureArgs(options);

  const child = spawn(ffmpegPath, args, {
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk;
  });

  const startedAt = Date.now();
  let spawnError: Error | null = null;
  child.on('error', (err) => {
    spawnError = err;
  });

  const finished = new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      if (spawnError) return reject(spawnError);
      // ffmpeg reports 255 when it quits on a 'q', which is the normal path here.
      if (code === 0 || code === 255) return resolve();
      if (/received no packets/.test(stderr)) {
        return reject(
          new Error('Nothing was captured. The recording was too short to produce a frame.'),
        );
      }
      reject(new Error(`recording failed (ffmpeg exited ${code})\n${tail(stderr)}`));
    });
  });

  let stopping = false;

  async function stop(): Promise<void> {
    if (!stopping) {
      stopping = true;
      // Ask ffmpeg to quit rather than killing it. Windows has no POSIX
      // signals, so a SIGINT here would tear the process down before it
      // writes the moov atom and leave an unplayable file behind.
      try {
        child.stdin?.write('q');
        child.stdin?.end();
      } catch {
        // stdin already closed; the close handler will settle `finished`.
      }
    }
    await finished;
  }

  return {
    stop,
    get elapsedMs() {
      return Date.now() - startedAt;
    },
    get args() {
      return args;
    },
  };
}
