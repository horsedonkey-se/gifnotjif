First stable release. Windows and macOS (Intel and Apple silicon) are tested and
working. A Linux X11 build is published but has never been run, so treat it as
experimental.

## New

- macOS works. Recording, GIF encoding and clipboard have been run end to end on
  macOS 26 on Apple silicon.

## Fixed

- macOS: selecting a region crashed on confirm. The DIP conversions used
  Windows-only APIs that do not exist elsewhere.
- macOS: recordings could not be stopped. ffmpeg could not work out its own frame
  rate, assumed a million fps, and duplicated frames instead of finishing.
- macOS: the window picker was off by the display scale factor on Retina screens.
- macOS: builds are now ad-hoc signed, so the app asks for Screen Recording
  permission under its own name rather than Electron's.
- Stopping a recording can no longer hang the app. If ffmpeg will not quit it is
  killed, and the failure says why.

## Known

Nothing is Developer ID signed. Windows shows SmartScreen on first install. macOS
needs right-click then Open on first launch, cannot install its own updates, and
asks for Screen Recording permission again after each update.

macOS has only been run on a single display.

The Linux X11 build has never been run on real hardware. It compiles and the
code path is there, but nothing about it has been confirmed working. If you try
it, please open an issue with what happened. Wayland is refused on purpose.
