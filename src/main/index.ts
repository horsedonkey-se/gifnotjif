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

// Only one instance may hold the global hotkey.
if (!app.requestSingleInstanceLock()) app.quit();

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

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
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

function buildTrayMenu(target: Tray): void {
  target.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: state === 'recording' ? 'Stop recording' : 'Record a region',
        accelerator: config.hotkey,
        enabled: state === 'idle' || state === 'recording',
        click: () => void toggle(),
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
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

async function toggle(): Promise<void> {
  if (state === 'recording') return stopRecording();
  if (state !== 'idle') return;
  return beginRecording();
}

async function beginRecording(): Promise<void> {
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

  try {
    const rec = startRecording({
      ...region,
      fps: config.fps,
      drawMouse: config.drawMouse,
      outPath: videoPath,
    });
    const hud = showHud(region, () => void stopRecording());
    current = { rec, hud, videoPath, gifPath };
    setTrayState('recording');
  } catch (err) {
    setTrayState('idle');
    fail('Could not start recording', err);
  }
}

async function stopRecording(): Promise<void> {
  if (state !== 'recording' || !current) return;
  const { rec, hud, videoPath, gifPath } = current;
  setTrayState('processing');

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
    const support = platform.isSupported();
    if (support.ok) {
      hud.setStatus('Copying...');
      await platform.copyGifToClipboard(gifPath);
      notify('Copied to clipboard', `${await sizeOf(gifPath)} - ready to paste`);
    } else {
      notify('Saved to disk', `${support.reason} ${gifPath}`);
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

  if (!globalShortcut.register(config.hotkey, () => void toggle())) {
    dialog.showErrorBox(
      'Hotkey unavailable',
      `Another application already owns ${config.hotkey}. ` +
        'Change "hotkey" in settings.json and restart.',
    );
  }

  await pruneOldRecordings();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Closing the overlay or HUD must not quit a tray-resident app.
app.on('window-all-closed', () => {});
