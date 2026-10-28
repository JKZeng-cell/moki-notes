function Select-MokiInstallProcess {
    param([string]$Executable, [object[]]$Processes)
    $target = [IO.Path]::GetFullPath($Executable)
    foreach ($entry in $Processes) {
        if ($entry.Name -ine 'MOKI-Notes.exe') { continue }
        if (-not $entry.ExecutablePath) { throw 'Cannot inspect a MOKI-Notes process. Exit it from its tray first.' }
        if ([string]::Equals([IO.Path]::GetFullPath($entry.ExecutablePath), $target, [StringComparison]::OrdinalIgnoreCase)) {
            $entry
        }
    }
}
function Test-MokiMcpProcess {
    param([string]$Executable, [object]$Process)
    if (-not $Process.ExecutablePath -or -not $Process.CommandLine) { return $false }
    $target = [IO.Path]::GetFullPath($Executable)
    if (-not [string]::Equals([IO.Path]::GetFullPath($Process.ExecutablePath),$target,[StringComparison]::OrdinalIgnoreCase)) { return $false }
    $match = [regex]::Match($Process.CommandLine,'^\s*(?:"(?<exe>[^"]+)"|(?<exe>[^"\s]+))\s+(?:"(?<entry>[^"]+)"|(?<entry>[^"\s]+))\s*$')
    if (-not $match.Success) { return $false }
    $entry = Join-Path ([IO.Path]::GetDirectoryName($target)) 'resources\app.asar\dist\mcp\server.js'
    try { return [string]::Equals([IO.Path]::GetFullPath($match.Groups['exe'].Value),$target,[StringComparison]::OrdinalIgnoreCase) -and [string]::Equals([IO.Path]::GetFullPath($match.Groups['entry'].Value),$entry,[StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}

function Request-MokiMcpShutdown {
    param([string]$Executable, [int]$ProcessId)
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.',"moki-notes-mcp-install-$ProcessId",[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous)
    try {
        try { $pipe.Connect(800) } catch [TimeoutException] { return 'legacy' }
        $writer = New-Object IO.StreamWriter($pipe,(New-Object Text.UTF8Encoding($false)),1024,$true)
        $reader = New-Object IO.StreamReader($pipe,[Text.Encoding]::UTF8,$false,1024,$true)
        try {
            $writer.WriteLine((@{action='prepare-install';executable=$Executable} | ConvertTo-Json -Compress)); $writer.Flush()
            $reply = $reader.ReadLineAsync()
            if (-not $reply.Wait(35000)) { return 'busy' }
            $result = $reply.Result | ConvertFrom-Json
            if ($result.status -eq 'closed') { return 'closed' }
            return 'busy'
        } finally { $writer.Dispose(); $reader.Dispose() }
    } finally { $pipe.Dispose() }
}
Export-ModuleMember -Function Select-MokiInstallProcess,Test-MokiMcpProcess,Request-MokiMcpShutdown
