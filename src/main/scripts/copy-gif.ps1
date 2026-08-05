<#
Puts an animated GIF on the Windows clipboard in several formats at once, so
whichever format the receiving app understands, it finds one.

  FileDrop  (CF_HDROP)  - chat apps treat this as a file upload and animate it.
                          This is the one that actually matters.
  GIF                   - registered format holding the raw bytes, for apps
                          that read GIF data directly.
  Text                  - the path, as a last resort.

Deliberately does NOT set a bitmap. An app offered a bitmap will often prefer
it and paste a single still frame, which is exactly the failure we are avoiding.

Must run on an STA thread: System.Windows.Forms.Clipboard throws otherwise.
Launch with  powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File ...
#>
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    throw "must run on an STA thread; relaunch powershell.exe with -STA"
}

$Path = (Resolve-Path -LiteralPath $Path).ProviderPath
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "no such file: $Path"
}

Add-Type -AssemblyName System.Windows.Forms

$data = New-Object System.Windows.Forms.DataObject

$files = New-Object System.Collections.Specialized.StringCollection
[void]$files.Add($Path)
$data.SetFileDropList($files)

# A MemoryStream is written to the clipboard verbatim. A raw byte[] would go
# through BinaryFormatter and arrive wrapped in serialisation headers.
$bytes = [System.IO.File]::ReadAllBytes($Path)
$stream = New-Object System.IO.MemoryStream(, $bytes)
$data.SetData('GIF', $false, $stream)

$data.SetText($Path)

# $true = leave the data on the clipboard after this process exits.
[System.Windows.Forms.Clipboard]::SetDataObject($data, $true)

Write-Output "copied $Path ($($bytes.Length) bytes)"
