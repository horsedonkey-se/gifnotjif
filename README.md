<img src="assets/logo.png" alt="gifnotjif" width="96">

# gifnotjif

Press a hotkey, drag a box over part of your screen, press stop. The GIF lands
on your clipboard, ready to paste into Slack, Discord, or a GitHub comment.

Windows works today. macOS and Linux fall back to saving the file to disk until
their adapters are finished.

## Running it

```
npm install
npm start
```

It lives in the tray. `Ctrl+Shift+G` starts a recording, and again stops it.

```
npm run doctor    # what the app sees: displays, scaling, ffmpeg, platform support
npm run spike     # record a fixed region with no UI, for testing the pipeline
```

The source is TypeScript. Every script above compiles first, into `dist/`, which
mirrors the source tree so `__dirname`-relative paths hold. `npm run build`
compiles on its own and `npm run typecheck` only checks. The renderer scripts are
classic scripts rather than modules, because Chromium will not load a module over
`file://`.

## How it works

```
hotkey
  -> transparent overlay on every display, drag to select
  -> ffmpeg captures the region to a temporary near-lossless mp4
  -> ffmpeg encodes that to a GIF with a palette tuned for screen content
  -> the GIF goes on the clipboard
```

Capture and encode are separate on purpose. Capture stays cheap so it does not
drop frames, and the expensive palette work happens once, after you stop.

## The clipboard, which is the hard part

There is no cross-platform clipboard format for an animated GIF. Hand an app
raw image bytes and it pastes a single still frame. So the file itself goes on
the clipboard and the receiving app treats it as an upload.

On Windows that means `CF_HDROP`, written through
`System.Windows.Forms.Clipboard`, which only works on an **STA** thread. Hence
`powershell.exe -STA` in `src/main/scripts/copy-gif.ps1`. Note that
`Set-Clipboard -Path` does not exist and PowerShell 7 dropped the `-STA` switch,
so this specifically needs Windows PowerShell 5.1.

Three formats go on at once, so whichever one the target app reads, it finds
something: the file drop, the raw GIF bytes, and the path as text. A bitmap is
deliberately **not** offered, because apps that see one tend to prefer it and
paste a still.

Because `CF_HDROP` is a path and not the bytes, **the GIF cannot be deleted
after copying** or the paste breaks. Recordings are kept in the app's user data
folder and swept after `keepForDays`. Only the intermediate mp4 is deleted
straight away.

## Settings

`settings.json` in the app's user data folder. Open it from the tray menu.

| key | default | notes |
|---|---|---|
| `hotkey` | `CommandOrControl+Shift+G` | restart to apply |
| `fps` | `12` | |
| `maxWidth` | `800` | GIFs above ~10MB are rejected by GitHub and Discord |
| `colors` | `128` | |
| `dither` | `none` | use `bayer:bayer_scale=5` for gradients or video |
| `drawMouse` | `true` | |
| `keepForDays` | `7` | how long old recordings survive |

The size defaults were measured, not guessed. On a busy 800x600 three-second
capture, `fps` 15 to 12, 256 to 128 colours, and dithering off together took the
output from 10.0MB to 6.0MB. Turning dithering off is the interesting one: screen
content is mostly flat UI colour that quantises cleanly, so a dither pattern just
adds noise the compressor has to store. Compared side by side at 2x on real UI,
text was no sharper with it and the flat areas were visibly grainier.

## Two traps worth knowing about

**ffmpeg probes before it encodes.** The default `probesize` is 5MB, measured in
bytes rather than time, so a small region at a low frame rate can spend seconds
filling it. A 300x200 capture at 10fps produces 2.4MB/s and stalls for about two
seconds, and any recording stopped before probing finished produced an empty
file. `-probesize 32 -analyzeduration 0` makes encoding start on the first frame.

**Stop ffmpeg by writing `q` to its stdin**, never a signal. Windows has no POSIX
signals, and killing the process skips the mp4 trailer and leaves a file nothing
can open.

## Adding macOS or Linux

Everything platform-specific sits behind one interface, `PlatformAdapter` in
`src/main/types.ts`:

```ts
interface PlatformAdapter {
  isSupported(): Support;                       // { ok: true } | { ok: false, reason }
  captureArgs(options: CaptureOptions): string[];   // ffmpeg arguments
  copyGifToClipboard(gifPath: string): Promise<unknown>;
}
```

`src/main/platform/index.ts` holds the three adapters in one typed map, so the
compiler checks each of them against that interface.

`darwin.ts` and `linux.ts` already hold capture arguments written from the docs
and notes on what their clipboard work needs. Neither has ever been run. Treat
them as a starting point, not as working code.

The known dead end on macOS: `osascript -e 'set the clipboard to (read (POSIX
file "x.gif") as «class GIFf»)'` silently copies only the first frame. Drive
`NSPasteboard` directly instead.

On Linux, X11 maps onto the Windows path almost exactly. Wayland is the real
work: there is no direct grab, so capture has to go through
`xdg-desktop-portal` and PipeWire, with a consent prompt each time.
