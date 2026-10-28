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
