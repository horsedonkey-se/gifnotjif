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

/**
 * A window the user could pick, frontmost first.
 *
 * Picking one only reads its rectangle: the capture that follows is the same
 * desktop grab a dragged region gets. ffmpeg can capture a window as such on
 * Windows alone, through gdigrab's `title=` input, and it does so with BitBlt
 * against the window's device context, which hands back black or stale frames
 * for anything drawn on the GPU. That is most of a modern desktop, and a
 * recording that fails convincingly is the one failure this app refuses.
 */
export interface WindowInfo {
  title: string;
  /** Physical pixels, virtual-desktop origin: the same units as Region. */
  bounds: Region;
  /** Owning process, so the picker can drop its own overlays. -1 when unknown. */
  pid: number;
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
  /**
   * Whether the windows on screen can be listed here. A no costs only the
   * window picker, so it never blocks a recording: dragging a rectangle is the
   * mode that works everywhere.
   */
  windowListSupport(): Support;
  /** On-screen windows, frontmost first. Empty rather than throwing. */
  listWindows(): Promise<WindowInfo[]>;
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
  /**
   * Throws the take away. Resolves once ffmpeg has exited and released the
   * file, which is when the caller may delete it. The file it leaves behind is
   * truncated and not playable.
   */
  cancel(): Promise<void>;
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
  /**
   * The pickable windows, already converted to this overlay's CSS pixels, and
   * arriving after the overlay is on screen rather than with it. Listing them
   * costs a process launch, and the overlay must not wait on one.
   */
  onWindows(fn: (windows: PickableWindow[]) => void): void;
}

/** A window as the overlay renderer sees it: CSS pixels, this window's origin. */
export interface PickableWindow {
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HudBridge {
  stop(): void;
  discard(): void;
  onStatus(fn: (text: string) => void): void;
}
