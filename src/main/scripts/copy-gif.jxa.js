/*
Puts an animated GIF on the macOS pasteboard in several types at once, so
whichever type the receiving app understands, it finds one. The counterpart of
copy-gif.ps1 on Windows, and the same idea: one item, several representations.

  public.file-url        - chat apps treat this as a file upload and animate it.
                           This is the one that actually matters.
  com.compuserve.gif     - the raw bytes, for apps that read GIF data directly.
  public.utf8-plain-text - the path, as a last resort.

Deliberately does NOT write public.tiff or public.png. An app offered a bitmap
will often prefer it and paste a single still frame, which is exactly the
failure we are avoiding.

All three go on ONE NSPasteboardItem. Writing three items instead would offer
the same GIF three times over, and an app reading the pasteboard as a list would
paste it three times.

Do not reach for `set the clipboard to (read (POSIX file "x.gif") as «class
GIFf»)`. It reports success and copies only the first frame.

Run with:  osascript -l JavaScript copy-gif.jxa.js /path/to/out.gif
*/

ObjC.import('AppKit');

function run(argv) {
  var gifPath = argv[0];
  if (!gifPath) throw new Error('usage: copy-gif.jxa.js <path to gif>');

  // dataWithContentsOfFile returns nil rather than raising, and reading .length
  // off nil is the confusing failure that follows. Check the file up front.
  if (!$.NSFileManager.defaultManager.fileExistsAtPath($(gifPath))) {
    throw new Error('no such file: ' + gifPath);
  }
  var data = $.NSData.dataWithContentsOfFile($(gifPath));

  var url = $.NSURL.fileURLWithPath($(gifPath));
  var item = $.NSPasteboardItem.alloc.init;

  // A file URL is carried as its UTF-8 text, not as an NSURL.
  item.setDataForType(
    url.absoluteString.dataUsingEncoding($.NSUTF8StringEncoding),
    'public.file-url',
  );
  item.setDataForType(data, 'com.compuserve.gif');
  item.setStringForType($(gifPath), 'public.utf8-plain-text');

  var pasteboard = $.NSPasteboard.generalPasteboard;
  // clearContents is what takes ownership; without it writeObjects is refused.
  pasteboard.clearContents;
  if (!pasteboard.writeObjects($([item]))) {
    throw new Error('NSPasteboard refused the item');
  }

  return 'copied ' + gifPath + ' (' + data.length + ' bytes)';
}
