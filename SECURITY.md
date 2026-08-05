# Security

## Reporting

Report a vulnerability privately through GitHub's
[security advisory form](../../security/advisories/new), or by email to
hargaaya10@gmail.com. Please do not open a public issue for one.

This is a spare-time project, so expect a first reply within a week rather than
a day.

## What this app touches

Worth knowing if you are auditing it:

- It spawns `ffmpeg` and, on Windows, `powershell.exe`. Anything that reaches
  the arguments of those commands is worth a close look.
- `settings.json` in the user data folder is read at startup and some of its
  values reach ffmpeg's command line. It is a local file the user owns, so this
  is not a privilege boundary, but a bad value should fail rather than run.
- Recordings are written to the app's user data folder and kept for
  `keepForDays` days. They are not encrypted and not cleaned on exit, because
  the clipboard holds a path to them.
- There is no network code and no telemetry. The only download is the ffmpeg
  binary that `npm install` fetches.
