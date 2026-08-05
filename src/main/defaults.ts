// Kept free of any electron import so plain-node tools (scripts/spike.ts) can
// share exactly the settings the app runs with.

export interface Settings {
  hotkey: string;
  fps: number;
  maxWidth: number;
  colors: number;
  dither: string;
  drawMouse: boolean;
  keepForDays: number;
}

export const DEFAULTS: Settings = {
  hotkey: 'CommandOrControl+Shift+G',
  fps: 12,
  // GIFs get expensive fast, and GitHub and Discord both reject images over
  // 10MB. On a busy 800x600 capture these three settings together took a
  // 3-second clip from 10.0MB to 6.0MB, which is the difference between
  // pasteable and not.
  maxWidth: 800,
  colors: 128,
  // 'none' suits UI and text. Use 'bayer:bayer_scale=5' for gradients or video.
  dither: 'none',
  drawMouse: true,
  // Recordings older than this are pruned at startup. They cannot be deleted
  // right after copying: the clipboard holds a path, not the bytes.
  keepForDays: 7,
};
