# Link the repo plugin into Ulanzi Studio's user plugin folder (directory junction) and restart Ulanzi Studio.
#   powershell -ExecutionPolicy Bypass -File scripts\link-plugin.ps1 [-Plugin <folder>] [-NoRestart] [-Unlink]
#   -Plugin defaults to plugin\com.ulanzi.nwpie.ulanziPlugin (any folder whose name ends in .ulanziPlugin works)
param([string]$Plugin = 'plugin\com.ulanzi.nwpie.ulanziPlugin', [switch]$NoRestart, [switch]$Unlink)
$ErrorActionPreference = 'Stop'

$src    = Join-Path $PSScriptRoot "..\$Plugin" | Resolve-Path
$name   = Split-Path $src -Leaf
$dstDir = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\Plugins'
$dst    = Join-Path $dstDir $name
$exe    = 'C:\Program Files (x86)\Ulanzi Studio\UlanziDeck.exe'

New-Item -ItemType Directory -Force $dstDir | Out-Null
if (Test-Path $dst) {
    $item = Get-Item $dst -Force
    if ($item.LinkType -eq 'Junction') { $item.Delete() }  # removes the link only, never the repo files
    else { throw "$dst exists and is not a junction; move it away first." }
}
if (-not $Unlink) {
    New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
    Write-Host "linked $dst -> $src"
} else {
    Write-Host "unlinked $dst"
}

if (-not $NoRestart) {
    Get-Process UlanziDeck -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Start-Process $exe
    Write-Host 'Ulanzi Studio restarted'
}
