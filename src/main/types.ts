/** A rectangle on the virtual desktop, in physical pixels unless said otherwise. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The display a capture is taken from.
 *
 * gdigrab and x11grab read the whole virtual desktop and crop at the source, so
 * they need none of this. avfoundation captures one display at a time, as a
 * numbered device, in that display's own coordinates, so it needs all of it.
 */
export interface CaptureDisplay {
  /** Electron's Display.id. On macOS this is the CGDirectDisplayID. */
  id: number;
  /** Position in screen.getAllDisplays() order. */
  index: number;
  /** The display's own bounds, physical pixels, virtual-desktop origin. */
  bounds: Region;
}

export interface CaptureOptions extends Region {
  fps: number;
  outPath: string;
  drawMouse?: boolean;
  /** Absent when the caller has no screen module: assume the primary display. */
  display?: CaptureDisplay;
}

export interface ClipboardOptions {
  /**
   * Linux only. X11 and Wayland both let one owner advertise a single type per
   * clipboard tool, so which one it is has to be a choice the user can make.
   */
  mimeType?: string;
}

/**
 * Whether this platform can do a job. When it cannot, `reason` is the sentence
 * the user reads, in a dialog or beside the saved file, so a no always comes
 * with one and it is written to be read rather than logged.
 */
export type Support = { ok: true } | { ok: false; reason: string };

export interface PlatformAdapter {
  /**
   * Whether this machine can record at all. Checked before the overlay opens,
   * because a platform that cannot capture must not be allowed to produce a
   * file full of black frames and call it a recording.
   */
  captureSupport(): Support;
  /**
   * Whether a GIF can go on the clipboard here. Checked after encoding, and a
   * no only costs the user the paste: the file is still on disk.
   */
  clipboardSupport(): Support;
  captureArgs(options: CaptureOptions): string[];
  copyGifToClipboard(gifPath: string, options?: ClipboardOptions): Promise<unknown>;
  /**
   * Whether a window marked content-protected is absent from what this
   * platform's capture backend records. False means the recording bar has to
   * stay outside the captured rectangle to keep out of the GIF.
   */
  canHideFromCapture(): boolean;
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
  /** False when there was nowhere to put the bar outside the recording. */
  readonly visible: boolean;
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
