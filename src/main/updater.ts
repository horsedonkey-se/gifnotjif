// The only file that touches electron-updater. Everything it knows about the
// outside world it reports through onChange; the toasts and the tray menu are
// built in index.ts from that state.
//
// Two different mechanisms live here, because macOS cannot use the first one.
// Squirrel.Mac validates the code signature of anything it is asked to install,
// and these builds are unsigned, so an installed update would be rejected after
// the download rather than before it. Mac therefore reads the releases list
// itself and offers a link. See RELEASING.md.

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

const OWNER = 'horsedonkey-se';
const REPO = 'gifnotjif';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;

/** First check well after launch, so it never competes with the first hotkey. */
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; percent: number }
  /** Downloaded and waiting. Installing it is a restart. */
  | { kind: 'ready'; version: string }
  /** macOS: a newer version exists, but the user has to fetch it. */
  | { kind: 'manual'; version: string; url: string };

export interface Updater {
  state(): UpdateState;
  check(): void;
  /** No-op unless the state is 'ready'. Quits the app. */
  install(): void;
}

/**
 * Semver comparison, covering the tags this project ships: 0.1.0 and
 * 0.1.0-beta.2. Kept pure and exported so it can be tested without a display.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.trim().replace(/^v/, '').split('-');
    return { nums: core.split('.').map(Number), pre };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.nums[i] || 0) - (b.nums[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  // Same numbers. A release beats its own prereleases, and prereleases sort
  // against each other numerically, so beta.10 lands after beta.9.
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
}

/** A prerelease install accepts prereleases; a stable one never does. */
function wantsPrereleases(): boolean {
  return app.getVersion().includes('-');
}

/**
 * Reads the releases list and reports the newest one worth having. Used on
 * macOS only. Failure is silence: a machine that is offline, or behind a proxy
 * that eats the API, has nothing to gain from a dialog about it.
 */
async function findNewerRelease(): Promise<{ version: string; url: string } | null> {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const releases = (await res.json()) as {
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
  }[];

  const current = app.getVersion();
  const allowPre = wantsPrereleases();
  let best: { version: string; url: string } | null = null;
  for (const release of releases) {
    // A draft is not visible to anyone but the maintainer's token anyway, and
    // a prerelease is only for machines already running one.
    if (release.draft) continue;
    if (release.prerelease && !allowPre) continue;
    const version = release.tag_name.replace(/^v/, '');
    if (!isNewer(version, current)) continue;
    if (!best || isNewer(version, best.version)) {
      best = { version, url: release.html_url || RELEASES_URL };
    }
  }
  return best;
}

/**
 * Starts checking for updates. Returns null when there is nothing to check:
 * unpackaged, there is no app-update.yml and electron-updater throws on the
 * first call, and a dev run should not be reaching for the network anyway.
 */
export function startUpdates(onChange: (state: UpdateState) => void): Updater | null {
  if (!app.isPackaged) return null;

  let state: UpdateState = { kind: 'idle' };
  let timer: NodeJS.Timeout | null = null;

  const set = (next: UpdateState): void => {
    state = next;
    onChange(next);
  };

  /** Nothing left to look for once an update is in hand. */
  const stopChecking = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const check: () => void =
    process.platform === 'darwin'
      ? () => {
          if (state.kind !== 'idle') return;
          set({ kind: 'checking' });
          void findNewerRelease()
            .then((found) => {
              if (!found) return set({ kind: 'idle' });
              stopChecking();
              set({ kind: 'manual', version: found.version, url: found.url });
            })
            .catch((err) => {
              console.error('Update check failed:', err);
              set({ kind: 'idle' });
            });
        }
      : () => {
          if (state.kind !== 'idle') return;
          // checkForUpdates resolves before the download does, so the events
          // below are what actually move the state along.
          void autoUpdater.checkForUpdates()?.catch((err) => {
            console.error('Update check failed:', err);
            set({ kind: 'idle' });
          });
        };

  if (process.platform !== 'darwin') {
    autoUpdater.autoDownload = true;
    // The safety net for everyone who never clicks the tray item: the update
    // goes in when they next quit, and they are running it the next morning.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = wantsPrereleases();

    autoUpdater.on('checking-for-update', () => set({ kind: 'checking' }));
    autoUpdater.on('update-not-available', () => set({ kind: 'idle' }));
    autoUpdater.on('update-available', () => set({ kind: 'downloading', percent: 0 }));
    autoUpdater.on('download-progress', (p: { percent: number }) =>
      set({ kind: 'downloading', percent: Math.round(p.percent) }),
    );
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      stopChecking();
      set({ kind: 'ready', version: info.version });
    });
    autoUpdater.on('error', (err: Error) => {
      // Offline, rate limited, or a release without metadata. None of it is
      // the user's problem, and none of it should stop them recording.
      console.error('Update failed:', err);
      set({ kind: 'idle' });
    });
  }

  setTimeout(check, FIRST_CHECK_MS);
  timer = setInterval(check, EVERY_MS);

  return {
    state: () => state,
    check,
    install: () => {
      if (state.kind !== 'ready') return;
      // Off the menu-click stack: quitAndInstall tears down windows, and
      // Electron would rather not have that happen inside its own event.
      setImmediate(() => autoUpdater.quitAndInstall());
    },
  };
}
