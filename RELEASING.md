# Releasing

A tag push builds four installers and leaves them on a **draft** release. Nobody
gets them, and no installed copy updates itself, until you press Publish.

## Steps

1. Set the version in `package.json`. Use `0.1.0-beta.2` for a beta and `0.1.0`
   for a release; the hyphen is what marks it as a prerelease, here and on
   GitHub.
2. Rewrite `release-notes.md` for this version. electron-builder reads that file
   from the repository root and it becomes the release description. Whatever it
   says when the tag is pushed is what people read.
3. Commit both, then tag to match. `.github/workflows/release.yml` fails the
   build if the tag and `package.json` disagree, so a mismatch costs a build
   rather than a bad installer.

   ```
   git tag v0.1.0-beta.2
   git push origin main --tags
   ```

4. Wait for the four jobs: windows-x64, macos-arm64, macos-x64, linux-x64. Each
   packages for one architecture, because `ffmpeg-static` downloads exactly one
   binary per install.
5. Open the draft release. Check that all four installers are attached and that
   `latest.yml` and `latest-linux.yml` are there too. Those two files are what
   the updater reads; a release without them updates nobody.
6. Tick **Set as a pre-release** if the version has a hyphen. Leave it clear for
   a stable release.
7. Press Publish.

## What reaches whom

The updater in `src/main/updater.ts` accepts prereleases only when the copy
doing the asking is itself a prerelease. So:

- Someone on `0.1.0-beta.1` is offered later betas, and is offered `0.1.0` when
  it lands. They roll onto stable without reinstalling.
- Someone on `0.1.0` is never offered a beta.

That depends on the pre-release checkbox in step 5 being right. A beta published
as a stable release goes to everybody.

It also depends on `channel: latest` in `electron-builder.yml`. Without it a
prerelease version writes `beta.yml`, and clients built from a stable version go
looking for a `latest.yml` that is not in the release.

## The unsigned part

`CSC_IDENTITY_AUTO_DISCOVERY: false` in the workflow skips signing, because
there is no certificate to sign with.

macOS gets an ad-hoc signature anyway, from `build/afterSign.js`. That needs no
certificate and no secrets, and it is not about Gatekeeper: unsigned, the bundle
keeps the Electron download's own identity and asks for Screen Recording
permission as `Electron` rather than as itself. Ad-hoc signing with the real
bundle id gives it its own entry. A self-signed certificate would be better
still, because its identity would survive a rebuild and permissions would
survive an update, but codesign refuses an untrusted certificate and
electron-builder never adds trust to one it imports.

The costs that remain:

- Windows shows SmartScreen on the first install. Later updates go in through
  electron-updater and skip it.
- macOS refuses to install any update it cannot verify, so mac users get a
  notification and a link instead. Every mac update is a manual download and
  another right-click-Open.

A Developer ID certificate and an EV code signing certificate would remove both.
That is money and paperwork, not code.
