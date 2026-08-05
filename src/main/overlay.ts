import path from 'node:path';
import { BrowserWindow, ipcMain, screen, type Display, type IpcMainEvent } from 'electron';

import type { CaptureDisplay, Region } from './types';

/** gdigrab and libx264 both want even dimensions. */
export const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/** A region, plus the display it was drawn on, which avfoundation needs. */
export interface Selection extends Region {
  display: CaptureDisplay;
}

/**
 * Dims every display and lets the user drag out a rectangle.
 *
 * Resolves with a region in *physical* screen pixels, ready to hand to
 * ffmpeg, or null if the user cancelled.
 */
export function selectRegion(): Promise<Selection | null> {
  return new Promise((resolve) => {
    const windows = new Map<BrowserWindow, Display>();
    let settled = false;

    function finish(result: Selection | null): void {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('overlay:confirm', onConfirm);
      ipcMain.removeListener('overlay:cancel', onCancel);
      for (const win of windows.keys()) {
        if (!win.isDestroyed()) win.destroy();
      }
      resolve(result);
    }

    function onConfirm(event: IpcMainEvent, rect: Region): void {
      const win = BrowserWindow.fromWebContents(event.sender);
      const display = win && windows.get(win);
      if (!win || !display) return finish(null);

      // The renderer measures in CSS pixels inside its own window. Shift by the
      // window's position to get virtual-desktop DIP coordinates, then let
      // Electron do the DPI conversion. Doing this by hand with scaleFactor
      // breaks as soon as two displays are scaled differently.
      const dip = {
        x: display.bounds.x + rect.x,
        y: display.bounds.y + rect.y,
        width: rect.width,
        height: rect.height,
      };
      const physical = screen.dipToScreenRect(win, dip);

      // Carry the display through with the region. gdigrab and x11grab read the
      // whole desktop and never look at it; avfoundation records one display at
      // a time and cannot work without it. The same conversion is used for its
      // bounds, so both rectangles are in the same units.
      const bounds = screen.dipToScreenRect(win, display.bounds);

      finish({
        x: Math.round(physical.x),
        y: Math.round(physical.y),
        width: even(physical.width),
        height: even(physical.height),
        display: {
          id: display.id,
          // Unplugged mid-selection gives -1; the primary is a better guess
          // than a negative index.
          index: Math.max(0, screen.getAllDisplays().findIndex((d) => d.id === display.id)),
          bounds: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          },
        },
      });
    }

    function onCancel(): void {
      finish(null);
    }

    ipcMain.on('overlay:confirm', onConfirm);
    ipcMain.on('overlay:cancel', onCancel);

    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds,
        transparent: true,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: path.join(__dirname, 'preload-overlay.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      // The constructor sizes the window against whichever display Windows
      // first places it on, and clamps it to that one. A display taller than
      // the primary therefore opens short: a 1080x1920 portrait monitor next to
      // a 2048x1152 primary gets a 1080x1122 overlay, so the bottom of the
      // screen cannot be selected at all. Setting the bounds again once the
      // window exists, and so sits on the right display, applies them in full.
      win.setBounds(display.bounds);

      // 'screen-saver' puts it above the taskbar and other topmost windows.
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      void win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
      win.on('closed', () => finish(null));

      windows.set(win, display);
    }

    // Focus one window so Escape and the first click land somewhere.
    const first = windows.keys().next().value;
    if (first) first.focus();
    else finish(null);
  });
}
