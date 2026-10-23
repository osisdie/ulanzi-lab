# One-shot setup for a new Windows + WSL machine (idempotent; safe to re-run).
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 [-EnvProfile <name>] [-FixWslConfig] [-Distro <name>] [-SkipHooks]
#
#   0. -EnvProfile <name> copies .env.<name> to .env (machine settings; see .env.example)
#   1. checks prerequisites (Node, Ulanzi Studio, WSL distro, jq/curl in WSL, mirrored networking)
#   2. npm install (plugin deps: ws, koffi)
#   3. links the plugin into Ulanzi Studio (directory junction → this repo)
#   4. installs the Claude Code hooks + statusLine into WSL ~/.claude/settings.json (backup first)
#   5. generates the "ulanzi-lab" profile from an existing D200X profile and makes it current
param([string]$EnvProfile = '', [switch]$FixWslConfig, [string]$Distro = '', [switch]$SkipHooks)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ulanziExe = 'C:\Program Files (x86)\Ulanzi Studio\UlanziDeck.exe'
$ok = $true
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Good($m) { Write-Host "  ok  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  !!  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  XX  $m" -ForegroundColor Red; $script:ok = $false }

Step 'Machine settings (.env)'
$envFile = Join-Path $repo '.env'
if ($EnvProfile) {
    $src = Join-Path $repo ".env.$EnvProfile"
    if (-not (Test-Path $src)) { Write-Host "  XX  $src not found" -ForegroundColor Red; exit 1 }
    if (Test-Path $envFile) { Copy-Item $envFile "$envFile.bak" -Force }
    Copy-Item $src $envFile -Force
    Good ".env <- .env.$EnvProfile"
}
elseif (Test-Path $envFile) { Good '.env present' }
else { Warn 'no .env: using defaults (copy .env.example to .env, or pass -EnvProfile <name>)' }

Step 'Prerequisites'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Good "node $(node -v)" } else { Fail 'Node.js not found (winget install OpenJS.NodeJS.LTS)'; }
if (Test-Path $ulanziExe) { Good 'Ulanzi Studio installed' } else { Fail "Ulanzi Studio not found at $ulanziExe (install from ulanzi.com)" }

$wslList = (wsl.exe -l -v | Out-String) -replace "`0", ''
if (-not $Distro) { $m = [regex]::Match($wslList, '(?m)^\s*\*\s+(\S+)'); if ($m.Success) { $Distro = $m.Groups[1].Value } }
if ($Distro) { Good "WSL distro: $Distro (default; override with -Distro)" } else { Fail 'no WSL distro found (wsl --install -d Ubuntu)' }
$wsl = @('-d', $Distro, '-e', 'bash', '-lc')

if ($Distro) {
    $tools = (wsl.exe @wsl 'for t in jq curl tmux claude gh glab; do command -v $t >/dev/null && echo "$t:yes" || echo "$t:no"; done' | Out-String)
    foreach ($t in 'jq', 'curl') { if ($tools -match "${t}:yes") { Good "WSL has $t" } else { Fail "WSL is missing $t (wsl -d $Distro -- sudo apt install -y $t)" } }
    foreach ($t in 'tmux', 'claude', 'gh', 'glab') { if ($tools -match "${t}:yes") { Good "WSL has $t" } else { Warn "WSL has no $t (optional: $(@{tmux='Claude Pad / exact focus';claude='Claude Code';gh='GitHub keys';glab='GitLab keys'}[$t]))" } }
}

# Hooks in WSL reach the hub at 127.0.0.1:39300, which needs mirrored networking.
$wslconfig = Join-Path $env:USERPROFILE '.wslconfig'
$cfg = if (Test-Path $wslconfig) { Get-Content $wslconfig -Raw } else { '' }
if ($cfg -match '(?im)^\s*networkingMode\s*=\s*mirrored') { Good '.wslconfig networkingMode=mirrored' }
elseif ($FixWslConfig) {
    Copy-Item $wslconfig "$wslconfig.bak.ulanzi-lab" -ErrorAction SilentlyContinue
    if ($cfg -match '(?im)^\s*\[wsl2\]') { $cfg = $cfg -replace '(?im)^(\s*\[wsl2\]\s*)$', "`$1`r`nnetworkingMode=mirrored" } else { $cfg = "[wsl2]`r`nnetworkingMode=mirrored`r`n" + $cfg }
    Set-Content -Path $wslconfig -Value $cfg -Encoding ascii
    Warn ".wslconfig updated (backup: .wslconfig.bak.ulanzi-lab). Run 'wsl --shutdown' once, then re-run this script."
}
else { Warn 'WSL is not in mirrored networking mode: hooks cannot reach the hub. Re-run with -FixWslConfig (Windows 11 22H2+), then wsl --shutdown.' }

if (-not $ok) { Write-Host "`nFix the XX items above and re-run." -ForegroundColor Red; exit 1 }

Step 'npm install'
Push-Location $repo
npm install --no-audit --no-fund | Out-Host
Pop-Location
Good 'dependencies installed'

Step 'Link plugin(s) into Ulanzi Studio'
& (Join-Path $PSScriptRoot 'link-plugin.ps1') -NoRestart

if (-not $SkipHooks -and $Distro) {
    Step 'Claude Code hooks in WSL'
    $wslRepo = (wsl.exe -d $Distro -e wslpath -a ($repo -replace '\\', '/')).Trim()
    wsl.exe @wsl "cd '$wslRepo' && bash scripts/install-hooks.sh" | Out-Host
}

Step 'Ulanzi Studio profile'
$profiles = Join-Path $env:APPDATA 'Ulanzi\UlanziDeck\ProfilesV2'
$hasD200X = (Test-Path $profiles) -and (Get-ChildItem $profiles -Filter *.ulanziProfile -Directory | Where-Object {
        (Get-Content (Join-Path $_.FullName 'manifest.json') -Raw) -match '"Model"\s*:\s*"D200X"' })
if (-not $hasD200X) {
    Warn 'No D200X profile yet: connect the D200X, open Ulanzi Studio once (it creates "Default Profile"), then re-run.'
    if (-not (Get-Process UlanziDeck -ErrorAction SilentlyContinue) -and (Test-Path $ulanziExe)) { Start-Process $ulanziExe }
    exit 0
}
Push-Location $repo
if (-not (Get-Process UlanziDeck -ErrorAction SilentlyContinue)) { Start-Process $ulanziExe; Start-Sleep 5 }
node scripts/make-profile.mjs --activate --no-restart | Out-Host
Pop-Location
# make-profile stops Ulanzi Studio while it writes; start it once at the end.
if (-not (Get-Process UlanziDeck -ErrorAction SilentlyContinue)) { Start-Process $ulanziExe }

Step 'Done'
Good 'Ulanzi Studio restarted with the ulanzi-lab profile (8 pages).'
Good 'Browser preview: http://127.0.0.1:39300/'
Write-Host '  New Claude Code sessions in WSL report to the deck; running ones pick the hooks up on their next event.'
