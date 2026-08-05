import path from 'node:path';
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';

import type { Hud, Region } from './types';

const WIDTH = 200;
const HEIGHT = 44;
const GAP = 10;

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * Small always-on-top bar showing elapsed time and a stop button.
 *
 * Placed just outside the captured region so it does not end up in the GIF.
 * `region` is in physical pixels; window positions are in DIP, hence the
 * conversion back.
 */
export function showHud(region: Region, onStop: () => void): Hud {
  const dip = screen.screenToDipRect(null, region);
  const display = screen.getDisplayMatching(dip);
  const work = display.workArea;

  const left = Math.round(
    clamp(dip.x + dip.width / 2 - WIDTH / 2, work.x, work.x + work.width - WIDTH),
  );

  // Prefer below the selection, fall back to above it, and if the region fills
  // the display, sit at the bottom of the work area and accept the overlap.
  const below = dip.y + dip.height + GAP;
  const above = dip.y - HEIGHT - GAP;
  let top: number;
  if (below + HEIGHT <= work.y + work.height) top = below;
  else if (above >= work.y) top = above;
  else top = work.y + work.height - HEIGHT - GAP;

  const win = new BrowserWindow({
    x: left,
    y: Math.round(top),
    width: WIDTH,
    height: HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // taking focus mid-recording would change what is captured
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-hud.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'hud.html'));

  const onIpcStop = (event: IpcMainEvent): void => {
    if (BrowserWindow.fromWebContents(event.sender) === win) onStop();
  };
  ipcMain.on('hud:stop', onIpcStop);
  win.on('closed', () => ipcMain.removeListener('hud:stop', onIpcStop));

  return {
    setStatus(text: string) {
      if (!win.isDestroyed()) win.webContents.send('hud:status', text);
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
