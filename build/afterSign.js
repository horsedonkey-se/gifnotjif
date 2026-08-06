// Ad-hoc signs the macOS bundle, because not signing it at all is worse than
// people assume.
//
// With no Developer ID, electron-builder skips signing entirely and ships what
// the Electron download already carried: a linker signature with
// Identifier=Electron, no sealed resources, and a bundle that fails
// `codesign --verify`. macOS keys the Screen Recording permission on that
// identity, so gifnotjif asks for a grant under Electron's name rather than its
// own. Signing ad-hoc with the real bundle id gives it an entry of its own.
//
// This is not a replacement for a Developer ID. Gatekeeper still stops the
// first launch and the app still cannot be notarised; see RELEASING.md. It only
// fixes who the app says it is.
//
// A self-signed certificate would be the better fix, since its identity would
// survive a rebuild and permissions would survive an update. It is not usable
// here: codesign refuses an untrusted certificate outright
// (CSSMERR_TP_NOT_TRUSTED), and electron-builder imports a CSC_LINK without
// ever adding trust, so it would have to be trusted on the runner first.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const appId = context.packager.appInfo.id;

  // --deep is deprecated for real signing, where each nested binary wants its
  // own treatment. For an ad-hoc pass with one identity and nothing to
  // notarise, it is the whole job in one call.
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', appId, appPath],
    { stdio: 'inherit' },
  );

  // Signing that silently produced nothing would be worse than not signing,
  // because the log would say it happened.
  execFileSync('codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed  identifier=${appId}`);
};
