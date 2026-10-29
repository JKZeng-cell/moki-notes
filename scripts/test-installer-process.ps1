$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../build/installer-process.psm1') -Force
$target = 'D:\Program Files\MOKI-Notes\MOKI-Notes.exe'
$snapshot = @(
    [pscustomobject]@{ Name='MOKI-Notes.exe'; ProcessId=11; ExecutablePath=$target },
    [pscustomobject]@{ Name='MOKI-Notes.exe'; ProcessId=12; ExecutablePath='d:\program files\moki-notes\MOKI-Notes.exe' },
    [pscustomobject]@{ Name='MOKI-Notes.exe'; ProcessId=13; ExecutablePath='D:\Program Files\MOKI-Notes-other\MOKI-Notes.exe' },
    [pscustomobject]@{ Name='MOKI-Notes.exe'; ProcessId=14; ExecutablePath='D:\Program Files (x86)\MOKI-Notes\MOKI-Notes.exe' },
    [pscustomobject]@{ Name='Other.exe'; ProcessId=15; ExecutablePath='D:\Program Files\MOKI-Notes\Other.exe' }
)
$selected = @(Select-MokiInstallProcess -Executable $target -Processes $snapshot)
if (($selected.ProcessId -join ',') -ne '11,12') { throw 'Exact executable selection failed' }
$none = @(Select-MokiInstallProcess -Executable 'D:\Program Files\MOKI-Notes.exe' -Processes $snapshot)
if ($none.Count -ne 0) { throw 'Shared parent must not match child applications' }
$blocked = $false
try { Select-MokiInstallProcess -Executable $target -Processes @([pscustomobject]@{ Name='MOKI-Notes.exe'; ProcessId=16; ExecutablePath=$null }) }
catch { $blocked = $true }
if (-not $blocked) { throw 'Unreadable executable must block verification' }
Write-Output 'PASS: exact path, case-insensitive match, sibling/prefix isolation, shared parent isolation, unreadable-process rejection'
$mcpEntry = 'D:\Program Files\MOKI-Notes\resources\app.asar\dist\mcp\server.js'
$mcp = [pscustomobject]@{Name='MOKI-Notes.exe';ExecutablePath=$target;CommandLine=('"{0}" "{1}"' -f $target,$mcpEntry)}
if (-not (Test-MokiMcpProcess -Executable $target -Process $mcp)) {throw 'Quoted MCP entry not recognized'}
foreach($cmd in @(('"{0}"' -f $target),('"{0}" --type=renderer' -f $target),('"{0}" "{1}" --arbitrary' -f $target,$mcpEntry),('"{0}" "{1}.other"' -f $target,$mcpEntry),('"{0}" "D:\Other\server.js"' -f $target))){
    $mcp.CommandLine=$cmd
    if(Test-MokiMcpProcess -Executable $target -Process $mcp){throw "Must not classify other runtime as MCP: $cmd"}
}
$simple='D:\MOKI-Notes\MOKI-Notes.exe'
$mcp.ExecutablePath=$simple; $mcp.CommandLine='"D:\MOKI-Notes\MOKI-Notes.exe" D:\MOKI-Notes\resources\app.asar\dist\mcp\server.js'
if(-not(Test-MokiMcpProcess -Executable $simple -Process $mcp)){throw 'Actual Codex command not recognized'}
if(Test-MokiMcpProcess -Executable $target -Process $mcp){throw 'Sibling MCP must not match'}
Write-Output 'PASS: MCP exact entry, quoted and unquoted paths, desktop/renderer/extra-args/sibling rejection'
$helper = [pscustomobject]@{Name='MOKI-Notes.exe';ExecutablePath=$target;ProcessId=101;ParentProcessId=1;CreationDate=[datetime]'2026-10-29';CommandLine=('"{0}" --quit-for-install --install-save-confirmed' -f $target)}
if (-not (Test-MokiInstallHelper -Executable $target -Process $helper)) { throw 'Quit-only helper not recognized' }
foreach ($cmd in @(('"{0}"' -f $target),('"{0}" --quit-for-install --unexpected' -f $target),('"{0}" --type=renderer --quit-for-install' -f $target),('"D:\Other\MOKI-Notes.exe" --quit-for-install'))) {
    $fake = $helper.PSObject.Copy(); $fake.CommandLine = $cmd
    if (Test-MokiInstallHelper -Executable $target -Process $fake) { throw 'Ordinary application must not be treated as helper' }
}
$gpu = [pscustomobject]@{Name='MOKI-Notes.exe';ExecutablePath=$target;ProcessId=102;ParentProcessId=101;CreationDate=[datetime]'2026-10-29T00:00:01';CommandLine=('"{0}" --type=gpu-process' -f $target)}
$desktop = $gpu.PSObject.Copy(); $desktop.ProcessId=103; $desktop.ParentProcessId=1; $desktop.CommandLine=('"{0}"' -f $target)
$actual = @(Select-MokiDesktopProcess -Executable $target -Processes @($helper,$gpu,$desktop))
if (($actual.ProcessId -join ',') -ne '103') { throw 'Only helper and its actual child should be excluded' }
$gpu.CreationDate=[datetime]'2026-10-28'
if (@(Select-MokiDesktopProcess -Executable $target -Processes @($helper,$gpu)).Count -ne 1) { throw 'Reused parent PID must not exclude a desktop process' }
Write-Output 'PASS: quit-only helper recognition, real desktop preservation, helper children and reused PID isolation'
