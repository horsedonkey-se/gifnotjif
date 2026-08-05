# Lists the windows a user could point at, as JSON, frontmost first.
#
# Run by src/main/platform/win32.ts. Packaged builds unpack this: powershell.exe
# cannot read a file from inside app.asar. See asarUnpack in the build config.
#
# Two things here are not the obvious call:
#
# GetWindowRect is wrong for this. Since Windows 10 it returns the rectangle
# including the invisible resize border the compositor draws outside the visible
# frame, roughly 7px per side, so capturing it would put a band of whatever is
# behind the window around every recording. DwmGetWindowAttribute with
# DWMWA_EXTENDED_FRAME_BOUNDS is the visible rectangle.
#
# DWMWA_CLOAKED is what separates a window that is on screen from one that
# merely exists. Store apps keep hidden windows that are visible to EnumWindows,
# report themselves as visible, and are not on any screen. Without this the list
# is full of things the user cannot see and cannot point at.

$ErrorActionPreference = 'Stop'

# Window titles are full of characters the console's default code page cannot
# spell. Without this, a title carrying an emoji or an accent reaches Node as
# mojibake, and the picker labels the wrong thing.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public struct WinRect { public int Left, Top, Right, Bottom; }

public class WindowList {
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  private static extern int GetWindowTextLengthW(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassNameW(IntPtr hWnd, StringBuilder name, int count);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  [DllImport("dwmapi.dll")]
  private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out WinRect val, int size);

  [DllImport("dwmapi.dll")]
  private static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int val, int size);

  private const int EXTENDED_FRAME_BOUNDS = 9;
  private const int CLOAKED = 14;

  // The desktop itself and the taskbar. Progman is a real, visible, titled
  // window ("Program Manager") the size of the whole virtual desktop, so it
  // passes every other test here and would sit under the cursor everywhere,
  // swallowing every pick that missed a real window.
  private static readonly string[] ShellClasses =
    { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };

  private static bool IsShell(IntPtr hWnd) {
    StringBuilder cls = new StringBuilder(256);
    GetClassNameW(hWnd, cls, cls.Capacity);
    return Array.IndexOf(ShellClasses, cls.ToString()) >= 0;
  }

  public class Item {
    public string title;
    public int pid;
    public int x, y, width, height;
  }

  public static List<Item> Get() {
    List<Item> found = new List<Item>();

    // EnumWindows walks top-level windows in z-order, front to back, which is
    // exactly the order the picker needs for hit-testing overlaps.
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      if (IsIconic(hWnd)) return true;
      if (IsShell(hWnd)) return true;

      int length = GetWindowTextLengthW(hWnd);
      if (length <= 0) return true;

      int cloaked;
      if (DwmGetWindowAttribute(hWnd, CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0) {
        return true;
      }

      WinRect r;
      if (DwmGetWindowAttribute(hWnd, EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(WinRect))) != 0) {
        return true;
      }

      int w = r.Right - r.Left;
      int h = r.Bottom - r.Top;
      // Below this it is a tooltip, a tray helper, or a zero-sized shell window,
      // none of which anyone means to record.
      if (w < 32 || h < 32) return true;

      StringBuilder text = new StringBuilder(length + 1);
      GetWindowTextW(hWnd, text, text.Capacity);

      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);

      Item item = new Item();
      item.title = text.ToString();
      item.pid = (int)pid;
      item.x = r.Left;
      item.y = r.Top;
      item.width = w;
      item.height = h;
      found.Add(item);
      return true;
    }, IntPtr.Zero);

    return found;
  }
}
'@

# An empty list must still be an array, which ConvertTo-Json only does when told.
ConvertTo-Json -InputObject @([WindowList]::Get()) -Depth 3 -Compress
