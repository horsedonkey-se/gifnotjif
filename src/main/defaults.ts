// Kept free of any electron import so plain-node tools (scripts/spike.ts) can
// share exactly the settings the app runs with.

export interface Settings {
  hotkey: string;
  discardHotkey: string;
  maxDurationSecs: number;
  minFreeDiskMb: number;
  fps: number;
  maxWidth: number;
  colors: number;
  dither: string;
  drawMouse: boolean;
  keepForDays: number;
  clipboardMimeType: string;
  autoUpdate: boolean;
}

export const DEFAULTS: Settings = {
  hotkey: 'CommandOrControl+Shift+G',
  // Throws the take away. Held only while recording, but for that whole time it
  // is taken from whatever is being recorded: press Escape to close a dialog on
  // camera and the recording dies instead. Set it to "" to turn it off and use
  // the bar's discard button, which costs nothing to anyone.
  discardHotkey: 'Escape',
  // Capture is near-lossless on purpose, so it is expensive: about 0.65MB/s for
  // an 800x600 region, and several times that for a full screen. A recording
  // nobody stops therefore writes gigabytes an hour, and the bar that would have
  // shown it is sometimes hidden. So a take ends itself. It is stopped, not
  // thrown away: the GIF is encoded and copied as if the button had been
  // pressed. Set it to 0 to let a recording run until the disk stops it.
  maxDurationSecs: 300,
  // The floor the recordings folder's disk is kept above. Checked before a
  // recording starts, and every few seconds while one runs, because how fast a
  // capture grows depends on the region and on how much of it is moving. Set it
  // to 0 to turn the check off, on the understanding that a full disk is a
  // problem for the whole machine and not just for this app.
  minFreeDiskMb: 500,
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
  // Linux only, and ignored everywhere else. xclip and wl-copy each advertise
  // one type per invocation, so this picks which one. text/uri-list is the
  // paste-as-file type browsers, chat apps and file managers read, and it is
  // what makes the GIF animate rather than arrive as a still.
  clipboardMimeType: 'text/uri-list',
  // Checks GitHub for a newer release every few hours. Windows and Linux
  // download and install it; macOS only says one exists, because these builds
  // are unsigned and macOS will not install what it cannot verify. Turning it
  // off means finding the Releases page by hand for every fix.
  autoUpdate: true,
};
