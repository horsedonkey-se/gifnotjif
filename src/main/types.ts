/** A rectangle on the virtual desktop, in physical pixels unless said otherwise. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureOptions extends Region {
  fps: number;
  outPath: string;
  drawMouse?: boolean;
}

/**
 * Whether this platform can do the whole job. When it cannot, `reason` is the
 * sentence the user sees next to the saved file, so it always comes with one.
 */
export type Support = { ok: true } | { ok: false; reason: string };

export interface PlatformAdapter {
  isSupported(): Support;
  captureArgs(options: CaptureOptions): string[];
  copyGifToClipboard(gifPath: string): Promise<unknown>;
}

/** Handle over a recording in flight. */
export interface Recording {
  /** Resolves once the file is closed and playable. */
  stop(): Promise<void>;
  readonly elapsedMs: number;
  readonly args: readonly string[];
}

/** Handle over the on-screen recording bar. */
export interface Hud {
  setStatus(text: string): void;
  close(): void;
}

// What the preloads put on `window`. The renderer sees these through
// src/renderer/global.d.ts, so both ends of each channel are typed once.

export interface OverlayBridge {
  /** Rectangle in CSS pixels, relative to the overlay window. */
  confirm(rect: Region): void;
  cancel(): void;
}

export interface HudBridge {
  stop(): void;
  onStatus(fn: (text: string) => void): void;
}
