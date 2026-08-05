import fs from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';

import * as settings from './settings';
import { selectRegion } from './overlay';
import { showHud } from './hud';
import { startRecording } from './recorder';
import { encodeGif } from './encoder';
import { getPlatform } from './platform';
import { startUpdates, type UpdateState, type Updater } from './updater';
import type { Settings } from './defaults';
import type { Hud, Recording } from './types';

type State = 'idle' | 'selecting' | 'recording' | 'processing';

interface Current {
  rec: Recording;
  hud: Hud;
  videoPath: string;
  gifPath: string;
}

let tray: Tray | null = null;
let config: Settings = settings.DEFAULTS;
let state: State = 'idle';
let current: Current | null = null;
let updater: Updater | null = null;

// Only one instance may hold the global hotkey.
if (!app.requestSingleInstanceLock()) app.quit();

/**
 * Windows reads the toast's app name from the AppUserModelID, and defaults it
 * to "electron.app.Electron". A packaged build must use the same ID the
 * installer stamps on the Start Menu shortcut, which is where Windows finds the
 * display name. Unpackaged there is no shortcut, so Windows prints the ID
 * itself: use the bare app name so the toast still reads properly in dev.
 * Must run before any window or notification exists.
 */
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'dev.gifnotjif.app' : 'gifnotjif');
}

function recordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

/**
 * The clipboard holds a *path*, not the bytes, so a GIF cannot be deleted once
 * it has been copied without breaking the paste. Old ones are swept later
 * instead, at startup.
 */
async function pruneOldRecordings(): Promise<void> {
  const dir = recordingsDir();
  const cutoff = Date.now() - config.keepForDays * 24 * 60 * 60 * 1000;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      try {
        const { mtimeMs } = await fs.stat(file);
        if (mtimeMs < cutoff) await fs.rm(file, { force: true });
      } catch {
        // Racing with another instance, or a file we do not own. Skip it.
      }
    }),
  );
}

let toast: Notification | null = null;

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;

  const next = new Notification({ title, body });
  if (onClick) next.on('click', onClick);
  next.on('close', () => {
    if (toast === next) toast = null;
  });
  toast = next;
  next.show();
}

/** An accelerator as the user would read it off their own keyboard. */
function hotkeyLabel(accelerator: string): string {
  return accelerator.replace(
    /CommandOrControl|CmdOrCtrl|Command|Cmd|Control/g,
    process.platform === 'darwin' ? 'Cmd' : 'Ctrl',
  );
}

function setTrayState(next: State): void {
  state = next;
  if (!tray) return;
  const tooltips: Record<State, string> = {
    idle: 'gifnotjif - press the hotkey to record',
    selecting: 'gifnotjif - selecting a region',
    recording: 'gifnotjif - recording',
    processing: 'gifnotjif - encoding',
  };
  tray.setToolTip(tooltips[next]);
  buildTrayMenu(tray);
}

/**
 * One item, reading whatever the updater is currently doing. It is the only
 * place an update can be installed by hand, and it goes quiet while a recording
 * is in flight: restarting mid-take would throw the take away.
 */
function updateMenuItem(): Electron.MenuItemConstructorOptions[] {
  if (!updater) return [];
  const status = updater.state();

  switch (status.kind) {
    case 'checking':
      return [{ label: 'Checking for updates...', enabled: false }];
    case 'downloading':
      return [{ label: `Downloading update... ${status.percent}%`, enabled: false }];
    case 'ready':
      return [
        {
          label: `Restart to update to ${status.version}`,
          enabled: state === 'idle',
          click: () => updater?.install(),
        },
      ];
    case 'manual':
      return [
        {
          label: `Get ${status.version}...`,
          click: () => void shell.openExternal(status.url),
        },
      ];
    default:
      return [{ label: 'Check for updates', click: () => updater?.check() }];
  }
}

/**
 * Says an update arrived, once. The tray item is the durable copy of this, and
 * anyone who ignores both still gets the update when they next quit.
 */
function announceUpdate(status: UpdateState): void {
  if (status.kind === 'ready') {
    notify(
      'Update ready',
      `Version ${status.version} installs when you quit. ` +
        'Use the tray menu to restart now.',
    );
  } else if (status.kind === 'manual') {
    // macOS cannot install it for them, so the toast has to lead somewhere.
    notify(
      'Update available',
      `Version ${status.version} is out. Click to download.`,
      () => void shell.openExternal(status.url),
    );
  }
}

function buildTrayMenu(target: Tray): void {
  target.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: state === 'recording' ? 'Stop recording' : 'Record a region',
        accelerator: config.hotkey,
        enabled: state === 'idle' || state === 'recording',
        click: () => void toggle(),
      },
      // The only way out of a take when the bar had nowhere to go and the
      // discard key is off or already owned by something else.
      {
        label: 'Discard recording',
        ...(config.discardHotkey ? { accelerator: config.discardHotkey } : {}),
        enabled: state === 'recording',
        click: () => void discardRecording(),
      },
      { type: 'separator' },
      {
        label: 'Open recordings folder',
        click: () => void shell.openPath(recordingsDir()),
      },
      {
        label: 'Edit settings...',
        click: async () => {
          const file = path.join(app.getPath('userData'), 'settings.json');
          await fs.mkdir(path.dirname(file), { recursive: true });
          try {
            await fs.access(file);
          } catch {
            settings.save({}); // materialise the defaults so there is something to edit
          }
          await shell.openPath(file);
        },
      },
      { type: 'separator' },
      ...updateMenuItem(),
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

async function toggle(): Promise<void> {
  if (state === 'recording') return stopRecording();
  if (state !== 'idle') return;
  return beginRecording();
}

/**
 * Holds the discard key for as long as a recording is in flight, and no longer.
 * For that whole time the key is taken from whatever is being recorded, which is
 * why it is only held while it can do something and why it can be turned off in
 * settings. A key another application already owns is not worth a dialog
 * mid-recording: the bar's discard button and the tray both still work.
 */
function holdDiscardHotkey(): void {
  const key = config.discardHotkey;
  if (!key || key === config.hotkey) return;
  try {
    globalShortcut.register(key, () => void discardRecording());
  } catch {
    // Not a valid accelerator. Same answer as one that is already taken.
  }
}

function releaseDiscardHotkey(): void {
  const key = config.discardHotkey;
  if (!key || key === config.hotkey) return;
  globalShortcut.unregister(key);
}

/**
 * Explains why this machine cannot record, and on macOS offers the way to fix
 * it. Wayland and a missing DISPLAY have no button worth showing: the answer is
 * to log into a different session.
 */
async function refuseCapture(reason: string): Promise<void> {
  const canOpenSettings = process.platform === 'darwin';
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Cannot record',
    message: 'gifnotjif cannot record on this machine.',
    detail: reason,
    buttons: canOpenSettings ? ['Open Settings', 'Close'] : ['Close'],
    defaultId: 0,
    cancelId: canOpenSettings ? 1 : 0,
  });
  if (canOpenSettings && response === 0) {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }
}

async function beginRecording(): Promise<void> {
  // Asked before the overlay opens. A platform that cannot capture would
  // otherwise take the user through a selection to hand back black frames.
  const canCapture = getPlatform().captureSupport();
  if (!canCapture.ok) {
    await refuseCapture(canCapture.reason);
    return setTrayState('idle');
  }

  setTrayState('selecting');

  const region = await selectRegion();
  if (!region) return setTrayState('idle');

  // Let the overlay actually leave the screen before ffmpeg opens its first
  // frame, or the dim layer ends up baked into the recording.
  await new Promise((r) => setTimeout(r, 200));

  const dir = recordingsDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const videoPath = path.join(dir, `${stamp}.mp4`);
  const gifPath = path.join(dir, `${stamp}.gif`);

  // The bar goes up before ffmpeg does. It is only kept out of the recording
  // once the compositor knows to exclude it, and that has to be true of the
  // very first captured frame, not the one after it faded in.
  const hud = showHud(
    region,
    () => void stopRecording(),
    () => void discardRecording(),
  );
  if (!hud.visible) {
    notify(
      'Recording',
      `Press ${hotkeyLabel(config.hotkey)} or click the tray icon to stop` +
        (config.discardHotkey
          ? `, ${hotkeyLabel(config.discardHotkey)} to throw the take away. `
          : '. ') +
        'The bar is hidden so it stays out of the GIF.',
    );
  }

  try {
    const rec = startRecording({
      ...region,
      fps: config.fps,
      drawMouse: config.drawMouse,
      outPath: videoPath,
    });
    current = { rec, hud, videoPath, gifPath };
    holdDiscardHotkey();
    setTrayState('recording');
  } catch (err) {
    hud.close();
    setTrayState('idle');
    fail('Could not start recording', err);
  }
}

/**
 * Throws the take away without encoding it. Silent: the user asked for this, so
 * a notification saying it happened would only be in the way.
 *
 * Goes through 'processing' like a real stop so the hotkey, the tray item and a
 * second press of the discard key cannot land on a recording that is already
 * being torn down.
 */
async function discardRecording(): Promise<void> {
  if (state !== 'recording' || !current) return;
  const { rec, hud, videoPath } = current;
  setTrayState('processing');
  releaseDiscardHotkey();

  try {
    // ffmpeg holds the file open on Windows until it is gone, so the delete has
    // to wait for it. No GIF was ever written, so the video is all there is.
    await rec.cancel();
    await fs.rm(videoPath, { force: true });
  } catch (err) {
    fail('Could not discard the recording', err);
  } finally {
    hud.close();
    current = null;
    setTrayState('idle');
  }
}

async function stopRecording(): Promise<void> {
  if (state !== 'recording' || !current) return;
  const { rec, hud, videoPath, gifPath } = current;
  setTrayState('processing');
  releaseDiscardHotkey();

  try {
    await rec.stop();

    hud.setStatus('Encoding...');
    await encodeGif(videoPath, gifPath, {
      fps: config.fps,
      maxWidth: config.maxWidth,
      colors: config.colors,
      dither: config.dither,
    });

    const platform = getPlatform();
    const support = platform.clipboardSupport();
    if (support.ok) {
      hud.setStatus('Copying...');
      await platform.copyGifToClipboard(gifPath, { mimeType: config.clipboardMimeType });
      // The click target is not visible on a toast, so it has to be said.
      notify(
        'Copied to clipboard',
        `${await sizeOf(gifPath)} - ready to paste. Click to open.`,
        () => void shell.openPath(gifPath),
      );
    } else {
      // The recording is not wasted: the file on disk is the deliverable.
      notify('Saved to disk', `${support.reason} ${gifPath} Click to open.`, () =>
        void shell.openPath(gifPath),
      );
    }

    // The GIF stays; only the intermediate video goes.
    await fs.rm(videoPath, { force: true });
  } catch (err) {
    fail('Recording failed', err);
  } finally {
    hud.close();
    current = null;
    setTrayState('idle');
  }
}

async function sizeOf(file: string): Promise<string> {
  const { size } = await fs.stat(file);
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fail(title: string, err: unknown): void {
  console.error(err);
  dialog.showErrorBox(title, err instanceof Error ? err.message : String(err));
}

void app.whenReady().then(async () => {
  config = settings.load();

  // A tray app has no business in the dock or the taskbar.
  if (process.platform === 'darwin') app.dock?.hide();

  tray = new Tray(
    nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png')),
  );
  setTrayState('idle');

  // Left click starts and stops a recording; the menu stays on right click.
  // On macOS a context menu swallows the left click, so the menu item is the
  // only way in there.
  tray.on('click', () => void toggle());

  if (!globalShortcut.register(config.hotkey, () => void toggle())) {
    dialog.showErrorBox(
      'Hotkey unavailable',
      `Another application already owns ${config.hotkey}. ` +
        'Change "hotkey" in settings.json and restart.',
    );
  }

  if (config.autoUpdate) {
    // Returns null unpackaged, which also keeps the tray item out of dev runs
    // where nothing behind it would work.
    updater = startUpdates((status) => {
      announceUpdate(status);
      if (tray) buildTrayMenu(tray);
    });
  }

  await pruneOldRecordings();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Closing the overlay or HUD must not quit a tray-resident app.
app.on('window-all-closed', () => {});
