# Contributing

Thanks for looking. This is a small app and the bar for a change is simple: it
should work on real hardware, and it should not make the other two platforms
worse.

## Getting set up

```
npm install
npm run doctor    # confirm the app can see your displays and ffmpeg
npm start
```

Node 20 or newer. `npm install` downloads an ffmpeg binary, so the first install
needs a network connection.

## Before you open a pull request

```
npm run typecheck
```

That checks all three platform adapters from whatever machine you are on, which
is the point of keeping them in one typed map. It is the only automated check
there is; the rest is manual.

Record something. A real recording on a second display finds more problems than
anything else, because display scaling and origin offsets are where this app
breaks. If you touched capture or encoding, `npm run spike` records a fixed
region with no UI and is faster to iterate against.

Say in the pull request which platform you actually ran it on. "Typechecks,
untested on macOS" is a fine thing to write and more useful than silence.

## What is most wanted

macOS and Linux X11 have adapters that have never been run on real hardware.
Confirming one works, or reporting exactly how it fails, is worth more right now
than a new feature. Run `npm run doctor` first and paste its output into the
issue.

Wayland support is open and unclaimed. It needs `xdg-desktop-portal` and
PipeWire rather than an ffmpeg grabber, so it is a real piece of work, not an
adapter tweak.

## House style

Platform-specific code goes behind `PlatformAdapter` in `src/main/types.ts` and
nowhere else. If you find yourself writing `process.platform` outside
`src/main/platform/`, that is the signal to add a method to the adapter instead.

Comment the traps, not the syntax. The README explains why ffmpeg needs
`-probesize 32` and why the process is stopped by writing `q` to stdin; that
kind of thing belongs next to the code it explains, because the next person will
otherwise "clean it up" and break the app.

Commit messages use `type: summary` in the imperative, matching the existing
log: `feat:`, `fix:`, `style:`.

## Licensing

Contributions are accepted under GPL-3.0-or-later, the same license as the
project.
