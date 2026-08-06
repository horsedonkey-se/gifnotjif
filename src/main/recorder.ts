import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { ffmpegPath, tail } from './ffmpeg';
import { getPlatform } from './platform';
import type { CaptureOptions, Recording } from './types';

/**
 * How long a 'q' is given before the harder asks start, and how long the signal
 * after it gets before the process is killed outright.
 *
 * Both are grace periods for a healthy ffmpeg, not guesses at how long stopping
 * takes: on a normal stop the file is closed in well under a second and neither
 * timer ever fires. They only run out when ffmpeg is wedged, and then the wait
 * is the whole cost of the bug, so it is kept short enough to sit through.
 */
const QUIT_GRACE_MS = 2000;
const SIGNAL_GRACE_MS = 3000;

/**
 * Starts a screen recording and returns a handle.
 *
 *   const rec = startRecording({ x, y, width, height, fps, outPath })
 *   await rec.stop()      // resolves once the file is closed and playable
 *   await rec.cancel()    // throws the take away; resolves once the file is free
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

  let stopping = false;
  let cancelled = false;
  let forced = false;
  const timers: NodeJS.Timeout[] = [];

  /**
   * Keeps the ffmpeg run beside the recording when it goes wrong.
   *
   * The intermediate video is deleted on the way out, successful or not, so
   * without this a failure leaves nothing at all to look at -- and the failure
   * that matters most is the silent one, where ffmpeg says only that it opened
   * a device and then never mentions a frame. Written synchronously from the
   * close handler because the process is already gone and there is nothing
   * left to wait for.
   */
  function writeLog(why: string): void {
    try {
      appendFileSync(
        `${options.outPath}.log`,
        [
          `--- ${new Date().toISOString()} ${why}`,
          `ffmpeg: ${ffmpegPath}`,
          `args: ${args.join(' ')}`,
          `ran for: ${Date.now() - startedAt}ms`,
          '',
          stderr || '(ffmpeg wrote nothing to stderr)',
          '',
        ].join('\n'),
      );
    } catch {
      // Diagnostics must never be the reason a recording fails.
    }
  }

  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer);
    timers.length = 0;
  };

  const finished = new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      clearTimers();
      // A cancelled recording is expected to die badly: it was killed, so it
      // exits non-zero with a truncated file. Neither is a failure here.
      if (cancelled) return resolve();
      if (spawnError) return reject(spawnError);
      // A take that had to be killed left a file with no moov atom, so it is
      // not a video and must not be encoded. Said plainly, because the user
      // watched the bar sit there and is owed the reason.
      if (forced) {
        writeLog('had to be killed: capture delivered no frames');
        return reject(
          new Error(
            'The recording would not stop and had to be ended, so the take was lost. ' +
              'The capture produced no frames. What ffmpeg said:\n\n' +
              `${tail(stderr) || '(nothing)'}\n\n` +
              `Full log: ${options.outPath}.log`,
          ),
        );
      }
      // ffmpeg reports 255 when it quits on a 'q', which is the normal path here.
      if (code === 0 || code === 255) return resolve();
      writeLog(`ffmpeg exited ${code}`);
      if (/received no packets/.test(stderr)) {
        return reject(
          new Error('Nothing was captured. The recording was too short to produce a frame.'),
        );
      }
      reject(new Error(`recording failed (ffmpeg exited ${code})\n${tail(stderr)}`));
    });
  });

  /**
   * Ends the take, escalating until ffmpeg actually goes.
   *
   * The first ask is a 'q' on stdin, which is the only one that finishes the
   * file: ffmpeg writes the moov atom and exits 255. Windows has no POSIX
   * signals, so there it is also the only clean ask there is.
   *
   * The rest of the ladder exists because ffmpeg does not always answer. Both
   * the 'q' and the SIGINT are read at the top of its transcode loop, and an
   * input that never returns a packet never lets it reach that loop: with
   * avfoundation and no Screen Recording permission it blocks inside the
   * capture callback and ignores every one of them, `-t` included. Before this
   * ladder existed, `stop()` awaited a process that was never going to exit,
   * and the bar sat on 'Encoding...' until the app was quit -- which is exactly
   * the shape of "stopping does not stop".
   *
   * So SIGKILL is the last rung, and it is unconditional. It costs the take,
   * which is why it is last and why the grace periods are generous, but an app
   * that cannot be stopped is worse than a recording that was lost.
   */
  function escalate(): void {
    // Long enough that a healthy ffmpeg finishing a large file is never cut
    // short: it only has the trailer left to write by the time 'q' lands.
    timers.push(
      setTimeout(() => {
        // No POSIX signals on Windows, where kill() is TerminateProcess and so
        // already the last rung. Going there early would throw away takes that
        // were merely slow, so it waits for the second grace period instead.
        if (process.platform !== 'win32') child.kill('SIGINT');
      }, QUIT_GRACE_MS),
    );
    timers.push(
      setTimeout(() => {
        forced = true;
        child.kill('SIGKILL');
      }, QUIT_GRACE_MS + SIGNAL_GRACE_MS),
    );
  }

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
      escalate();
    }
    await finished;
  }

  /**
   * Kills ffmpeg instead of asking it to quit. A 'q' would make it write the
   * moov atom and close the file properly, which is the wait the user is trying
   * to skip; the file is about to be deleted anyway. Awaiting `finished` here is
   * what makes that deletion safe: Windows holds the file open until the process
   * is gone, so unlinking any earlier fails.
   *
   * The SIGKILL behind it is not belt and braces. `kill()` sends SIGTERM, and
   * ffmpeg handles that one in software -- the handler only sets a flag that
   * the transcode loop reads -- so an ffmpeg wedged in a capture that never
   * returns a frame ignores it exactly as it ignores 'q'. SIGKILL is not
   * deliverable to a handler, so it is the rung that always works, and discard
   * needs it more than stop does: there is no take here to protect.
   */
  async function cancel(): Promise<void> {
    if (!cancelled) {
      cancelled = true;
      child.kill();
      timers.push(setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS));
    }
    await finished;
  }

  return {
    stop,
    cancel,
    get elapsedMs() {
      return Date.now() - startedAt;
    },
    get args() {
      return args;
    },
  };
}
