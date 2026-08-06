import { screen, type BrowserWindow, type Display } from 'electron';

import type { Region } from './types';

/**
 * Conversions between DIP and physical pixels, on every platform.
 *
 * Electron has `screen.dipToScreenRect` and `screen.screenToDipRect`, and they
 * are the right calls, but they are `@platform win32`: on macOS and Linux the
 * properties are simply absent, and calling one throws "is not a function"
 * rather than returning something wrong. So they are used where they exist and
 * reimplemented where they do not.
 *
 * The fallback scales a rectangle about the origin of the display it is on,
 * rather than about the desktop origin:
 *
 *     physical.x = d.x + (rect.x - d.x) * scaleFactor
 *
 * The alternative, multiplying through by the scale factor, sounds simpler and
 * is wrong as soon as a second display exists: a display at DIP x=1440 with two
 * neighbours scaled differently lands on top of one of them, and there is then
 * no way to tell from a physical rectangle which display it came from. Keeping
 * each display's origin fixed leaves the layout in the same order at the same
 * offsets, and only sizes change, which is the part that has to change.
 *
 * That makes a display's own converted bounds start at its DIP origin and run
 * `width * scaleFactor` across. Every consumer of a physical rect either
 * measures it against those same converted bounds -- avfoundation's crop does
 * exactly this, see `captureArgs` in platform/darwin.ts -- or only reads its
 * size, so the origin's units cancel and never reach ffmpeg.
 *
 * Windows is the platform where a true physical desktop exists and where mixed
 * DPI is common, and there this delegates, so none of the above applies to it.
 */

const isWin32 = process.platform === 'win32';

/** Scale about the display's own origin. `sign` is 1 out to physical, -1 back. */
function scaleAbout(rect: Region, display: Display, toPhysical: boolean): Region {
  const { scaleFactor, bounds } = display;
  const f = toPhysical ? scaleFactor : 1 / scaleFactor;
  return {
    x: bounds.x + (rect.x - bounds.x) * f,
    y: bounds.y + (rect.y - bounds.y) * f,
    width: rect.width * f,
    height: rect.height * f,
  };
}

/** How much of `rect` falls inside `other`. 0 when they do not touch. */
function overlap(rect: Region, other: Region): number {
  const w = Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x);
  const h = Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The display a physical rect is on.
 *
 * `screen.getDisplayMatching` takes DIP, which is what we are trying to work
 * out, so it cannot be used here. Each display's bounds are converted forward
 * instead -- the same mapping, so the comparison is in one set of units -- and
 * the one covering the most of the rectangle wins.
 */
function displayForPhysical(rect: Region): Display {
  const displays = screen.getAllDisplays();
  let best = screen.getPrimaryDisplay();
  let bestArea = 0;

  for (const display of displays) {
    const area = overlap(rect, scaleAbout(display.bounds, display, true));
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }

  return best;
}

/**
 * A DIP rect in physical pixels, scaled for the display nearest `win`, or
 * nearest the rectangle itself when `win` is null.
 */
export function dipToPhysicalRect(win: BrowserWindow | null, rect: Region): Region {
  if (isWin32) return screen.dipToScreenRect(win, rect);
  const display = screen.getDisplayMatching(win ? win.getBounds() : rect);
  return scaleAbout(rect, display, true);
}

/** A physical rect back in DIP, scaled for the display it sits on. */
export function physicalToDipRect(rect: Region): Region {
  if (isWin32) return screen.screenToDipRect(null, rect);
  return scaleAbout(rect, displayForPhysical(rect), false);
}
