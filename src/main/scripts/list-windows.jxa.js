/*
Lists the windows a user could point at, as JSON, frontmost first. The
counterpart of list-windows.ps1 on Windows.

CGWindowListCopyWindowInfo is the right call here rather than System Events.
System Events reads windows through the accessibility API, which needs a second
permission the app does not otherwise ask for, and it is slow enough to be felt
because it talks to each application in turn.

kCGWindowListOptionOnScreenOnly already excludes minimised and hidden windows,
so there is no separate check for them, and the list it returns is in front-to-
back order, which is the order the picker needs to resolve an overlap.

Two things are filtered out here:

  layer != 0    The desktop picture, the menu bar, the Dock and every floating
                panel live on non-zero layers. Ordinary windows are layer 0, and
                they are the only ones anyone means to record.

  no name       A window with no title is a shadow, a drag image or a helper.
                Note that kCGWindowName is only populated when the app holds
                Screen Recording permission, which gifnotjif needs to record at
                all: without it this list comes back empty, which is correct,
                because capture would not work either.

Bounds come back in points with the origin at the top left of the main display,
which is the same coordinate space Electron's screen module reports, so no
flipping is needed.

Run with:  osascript -l JavaScript list-windows.jxa.js
*/

ObjC.import('CoreGraphics');
ObjC.import('Foundation');

function run() {
  var windows = $.CFBridgingRelease(
    $.CGWindowListCopyWindowInfo(
      $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
      $.kCGNullWindowID,
    ),
  );

  var out = [];

  for (var i = 0; i < windows.count; i++) {
    var info = windows.objectAtIndex(i);

    var layer = info.objectForKey($.kCGWindowLayer);
    if (!layer || Number(layer.intValue) !== 0) continue;

    var name = info.objectForKey($.kCGWindowName);
    if (!name) continue;
    var title = ObjC.unwrap(name);
    if (!title) continue;

    // The bounds arrive as a CFDictionary, not a CGRect.
    var boundsDict = info.objectForKey($.kCGWindowBounds);
    if (!boundsDict) continue;

    var read = function (key) {
      var value = boundsDict.objectForKey($(key));
      return value ? Math.round(Number(value.doubleValue)) : 0;
    };

    var width = read('Width');
    var height = read('Height');
    // As on Windows: below this it is a helper, not a window worth recording.
    if (width < 32 || height < 32) continue;

    var pid = info.objectForKey($.kCGWindowOwnerPID);

    out.push({
      title: title,
      pid: pid ? Number(pid.intValue) : -1,
      x: read('X'),
      y: read('Y'),
      width: width,
      height: height,
    });
  }

  return JSON.stringify(out);
}
