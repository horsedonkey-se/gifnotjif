// Starting with the session.
//
// A tray app driven by a global hotkey has no window to be missing, so after a
// reboot the only evidence it is not running is that the hotkey does nothing.
// That reads as broken rather than as not started, which is why this exists.
//
// The operating system owns this setting, not settings.json. Windows exposes it
// in Task Manager, macOS in System Settings, and either can switch it off
// behind the app's back. A copy in settings.json would only be a second answer
// that goes stale, so the tray checkbox reads the real one every time the menu
// is built.
//
// It is off until asked for. An app that adds itself to a login list on first
// run is a nuisance, however useful it thinks it is being.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

import type { Support } from './types';

/**
 * Where a Linux desktop looks for things to start with the session. Electron's
 * login-item API is darwin and win32 only, so this is written by hand.
 */
function xdgAutostartFile(): string {
  const config =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(config, 'autostart', 'gifnotjif.desktop');
}

/**
 * The binary a desktop file should launch. An AppImage is a single file that
 * the user can move wherever they like, and inside it process.execPath points
 * at the mounted, temporary copy, which will not exist next boot. APPIMAGE is
 * the real path, and the runtime sets it for exactly this reason.
 */
function linuxExecPath(): string {
  return process.env.APPIMAGE || process.execPath;
}

/** Desktop-entry quoting: the reserved characters are escaped, then quoted. */
function desktopExec(target: string): string {
  return `"${target.replace(/(["`$\\])/g, '\\$1')}"`;
}

/**
 * Whether this build can put itself in the login list at all.
 *
 * An unpackaged run cannot: process.execPath is the electron binary from
 * node_modules, and launching it at login without the project path just starts
 * a default Electron window. Registering that would leave a login item behind
 * that outlives the checkout it came from.
 */
export function autostartSupport(): Support {
  if (!app.isPackaged) {
    return {
      ok: false,
      reason:
        'Only an installed build can start at login. A development run would ' +
        'register the electron binary, not gifnotjif.',
    };
  }
  const supported = ['win32', 'darwin', 'linux'];
  if (!supported.includes(process.platform)) {
    return { ok: false, reason: `${process.platform} has no login list to join.` };
  }
  return { ok: true };
}

/** Whether the app will actually start with the next session. */
export function isEnabled(): boolean {
  if (!autostartSupport().ok) return false;

  if (process.platform === 'linux') {
    return fs.existsSync(xdgAutostartFile());
  }

  const settings = app.getLoginItemSettings();

  // Windows keeps two facts: the run key, and whether Task Manager has since
  // switched it off. openAtLogin only reports the first, so a checkbox built on
  // it would stay ticked for an app that no longer starts.
  if (process.platform === 'win32') return settings.executableWillLaunchAtLogin;

  return settings.openAtLogin;
}

/**
 * Turns starting-at-login on or off, and reports what the system actually did.
 *
 * Failure here is worth surfacing rather than swallowing: the whole point of
 * the setting is what happens after a reboot, which is the one moment nobody is
 * watching.
 */
export function setEnabled(on: boolean): Support {
  const support = autostartSupport();
  if (!support.ok) return support;

  try {
    if (process.platform === 'linux') {
      setLinuxAutostart(on);
    } else {
      app.setLoginItemSettings({ openAtLogin: on });
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  // Read it back rather than trusting the write. On macOS 13 and up the item is
  // registered through SMAppService and can land in 'requires-approval', where
  // the app is listed but switched off until the user says yes in System
  // Settings. Nothing has gone wrong, but nothing will start either.
  if (isEnabled() !== on) {
    return {
      ok: false,
      reason:
        process.platform === 'darwin' && on
          ? 'macOS needs this approved by hand. Open System Settings > ' +
            'General > Login Items and switch gifnotjif on.'
          : 'The system did not accept the change.',
    };
  }

  return { ok: true };
}

/**
 * Points an existing Linux entry back at the binary that is running now.
 *
 * Only Linux needs this. An AppImage is one file the user is free to move, and
 * a desktop entry naming where it used to be fails silently at the next login,
 * which is the failure this whole module exists to prevent. The Windows and
 * macOS installers put the app somewhere and leave it there.
 */
export function refresh(): void {
  if (process.platform !== 'linux') return;
  if (!autostartSupport().ok || !isEnabled()) return;

  try {
    const current = fs.readFileSync(xdgAutostartFile(), 'utf8');
    if (!current.includes(`Exec=${desktopExec(linuxExecPath())}`)) {
      setLinuxAutostart(true);
    }
  } catch {
    // Unreadable, so there is nothing to compare against. Leaving a file the
    // user may have written by hand alone is the safer of the two mistakes.
  }
}

function setLinuxAutostart(on: boolean): void {
  const file = xdgAutostartFile();

  if (!on) {
    fs.rmSync(file, { force: true });
    return;
  }

  // Terminal=false keeps a console window from being spawned for it, and the
  // GNOME key is what stops the entry being listed but ignored.
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=gifnotjif',
    'Comment=Record a screen region and land an animated GIF on your clipboard.',
    `Exec=${desktopExec(linuxExecPath())}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entry);
}
