param([ValidateSet('install','uninstall')][string]$Action = 'install')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$parent = Join-Path $root '.smoke/install-background/Program Files'
$target = Join-Path $parent 'MOKI-Notes'
if (-not ([IO.Path]::GetFullPath($target)).StartsWith((Join-Path $root '.smoke') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected target' }
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\73a748f6-ff15-51da-8707-22599a730227'
$existing = Get-ItemProperty -LiteralPath $registry -ErrorAction SilentlyContinue
if ($existing -and $existing.UninstallString -notlike ('"' + $target + '\Uninstall MOKI-Notes.exe"*')) { throw 'A different MOKI Notes installation exists; isolated verification cannot replace it' }
$env:MOKI_NOTES_PROFILE = Join-Path $root '.smoke/install-background-profile'
$env:MOKI_NOTES_DATA = Join-Path $root '.smoke/install-background.db'
$env:MOKI_NOTES_PORT = '4422'
if ($Action -eq 'install') {
    $exe = Join-Path $root 'release-installer-2026-10-27-feishu-bundled-r2/MOKI-Notes-Setup-0.1.0-x64.exe'
    $arguments = "/S /currentuser /D=$parent"
} else {
    $exe = Join-Path $target 'Uninstall MOKI-Notes.exe'
    $arguments = '/S /currentuser'
}
$child = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
if (-not $child.WaitForExit(180000)) { throw "Installer still running (PID $($child.Id)); not forcibly stopped" }
if ($Action -eq 'uninstall' -and $child.ExitCode -eq 0) {
    # NSIS hands off to a temporary uninstaller; the launcher can exit first.
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ((Test-Path -LiteralPath (Join-Path $target 'MOKI-Notes.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath (Join-Path $target 'MOKI-Notes.exe')) { throw 'Temporary uninstaller did not finish removing the target' }
}
$result = [pscustomobject]@{ Action=$Action; ExitCode=$child.ExitCode; Target=$target; ExecutableExists=(Test-Path -LiteralPath (Join-Path $target 'MOKI-Notes.exe')) }
$result | ConvertTo-Json
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root ".smoke/install-background-$Action-result.json") -Encoding utf8
if ($child.ExitCode -ne 0) { throw "Installer failed: $($child.ExitCode)" }
