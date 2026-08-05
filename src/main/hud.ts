import path from 'node:path';
import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from 'electron';

import { getPlatform } from './platform';
import type { Hud, Region } from './types';

// The visible bar, and the transparent margin the window carries around it so
// the bar's drop shadow has somewhere to land instead of being clipped at the
// window edge. Must match the body padding in hud.css.
//
// The margin is hit-testable like the rest of the window, so it leaves a dead
// border around the bar while recording. It sits outside the captured region,
// and 14px is the least that fits the shadow without visible clipping.
const BAR_W = 244;
const BAR_H = 44;
const MARGIN = 14;

const WIDTH = BAR_W + MARGIN * 2;
const HEIGHT = BAR_H + MARGIN * 2;

/** Distance from the captured region to the visible bar, not to the window. */
const GAP = 10;

/** A rectangle in DIP: displays and window positions both come in these. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** Centres the bar horizontally over `on`, letting only the margin overhang. */
const centreOver = (on: Rect): number =>
  Math.round(
    clamp(on.x + on.width / 2 - WIDTH / 2, on.x - MARGIN, on.x + on.width - WIDTH + MARGIN),
  );

/**
 * Where to put the window, or null if there is nowhere it would stay out of
 * the recording.
 *
 * Every clamp and gap below measures the bar. The window extends MARGIN
 * further in each direction, and that overhang is allowed off the work area.
 *
 * `hideable` says the compositor will keep a content-protected window out of
 * the capture, which is the only circumstance under which the bar may sit
 * inside the recorded rectangle.
 */
function place(dip: Rect, hideable: boolean): { x: number; y: number } | null {
  const work = screen.getDisplayMatching(dip).workArea;
  const left = centreOver(dip);

  // Prefer below the selection, then above it.
  const below = dip.y + dip.height + GAP - MARGIN;
  const above = dip.y - GAP - BAR_H - MARGIN;
  if (below + MARGIN + BAR_H <= work.y + work.height) return { x: left, y: Math.round(below) };
  if (above + MARGIN >= work.y) return { x: left, y: Math.round(above) };

  // The region fills the display. Overlapping it is only safe when the bar is
  // excluded from the capture.
  if (hideable) {
    return { x: left, y: Math.round(work.y + work.height - GAP - BAR_H - MARGIN) };
  }

  // Otherwise fall back to a display the recording does not cover at all.
  for (const other of screen.getAllDisplays()) {
    const area = other.workArea;
    if (intersects(area, dip)) continue;
    return {
      x: centreOver(area),
      y: Math.round(area.y + area.height - GAP - BAR_H - MARGIN),
    };
  }

  // One display, filled, and no way to hide the bar. The hotkey and the tray
  // still stop the recording; a bar baked into the GIF cannot be undone.
  return null;
}

/** Stands in for the bar when there was nowhere to put it. */
const NO_HUD: Hud = {
  setStatus() {},
  close() {},
  visible: false,
};

/**
 * Small always-on-top bar showing elapsed time and a stop button.
 *
 * Kept out of the GIF, either by sitting outside the captured region or, when
 * the region leaves no room, by the platform excluding it from the capture.
 * `region` is in physical pixels; window positions are in DIP, hence the
 * conversion back.
 */
export function showHud(region: Region, onStop: () => void, onDiscard: () => void): Hud {
  const dip = screen.screenToDipRect(null, region);
  const hideable = getPlatform().canHideFromCapture();
  const spot = place(dip, hideable);
  if (!spot) return NO_HUD;

  const win = new BrowserWindow({
    x: spot.x,
    y: spot.y,
    width: WIDTH,
    height: HEIGHT,
    // Shown by hand below, empty, so content protection is on before anything
    // has been painted into it.
    show: false,
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
  // Otherwise a macOS full-screen space hides the bar, and the only way left to
  // stop the recording is the hotkey.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Windows removes a content-protected window from the desktop composite that
  // gdigrab reads, so the bar stays on screen and out of the recording.
  //
  // The order matters and is not documented: the affinity does not stick to a
  // window that has not been shown, and such a bar records like any other
  // window. So show it first, while it is still empty and invisible, and only
  // then load the page into it. `npm run doctor -- --protection` measures this
  // sequence against a real capture.
  win.showInactive();
  if (hideable) win.setContentProtection(true);

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'hud.html'));

  const onIpcStop = (event: IpcMainEvent): void => {
    if (BrowserWindow.fromWebContents(event.sender) === win) onStop();
  };
  const onIpcDiscard = (event: IpcMainEvent): void => {
    if (BrowserWindow.fromWebContents(event.sender) === win) onDiscard();
  };
  ipcMain.on('hud:stop', onIpcStop);
  ipcMain.on('hud:discard', onIpcDiscard);
  win.on('closed', () => {
    ipcMain.removeListener('hud:stop', onIpcStop);
    ipcMain.removeListener('hud:discard', onIpcDiscard);
  });

  return {
    visible: true,
    setStatus(text: string) {
      if (!win.isDestroyed()) win.webContents.send('hud:status', text);
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
