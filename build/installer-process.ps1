param(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [ValidateSet('check','quit','stop-legacy-mcp')][string]$Mode = 'check'
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'installer-process.psm1') -Force
$target = [IO.Path]::GetFullPath((Join-Path $InstallDirectory 'MOKI-Notes.exe'))
function Get-TargetProcesses {
    # CIM can briefly return an exiting process with an empty ExecutablePath.
    # Re-snapshot before treating that as an inaccessible live application.
    for ($attempt = 0; $attempt -lt 6; $attempt++) {
        $snapshot = @(Get-CimInstance Win32_Process -Filter "Name='MOKI-Notes.exe'")
        $live = @($snapshot | Where-Object {
            if ($_.ExecutablePath) { return $true }
            $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            return $null -ne $process -and -not $process.HasExited
        })
        if (@($live | Where-Object { -not $_.ExecutablePath }).Count -eq 0 -or $attempt -eq 5) {
            @(Select-MokiInstallProcess -Executable $target -Processes $live)
            return
        }
        Start-Sleep -Milliseconds 150
    }
}
try {
    $running = @(Get-TargetProcesses)
    if ($running.Count -eq 0) { exit 0 }
    Write-Output "MOKI-Notes is running: $target (PID: $($running.ProcessId -join ', '))"
    $desktop = @($running | Where-Object { -not (Test-MokiMcpProcess -Executable $target -Process $_) })
    if ($Mode -eq 'check') { if ($desktop.Count -eq 0) { exit 11 }; exit 10 }
    # The app owns confirmation and saving. Its helper returns 2 on cancel and
    # 3 on save failure. Legacy versions return 0 immediately, so still inspect
    # the exact executable until every process has exited.
    if ($desktop.Count -gt 0) {
        if ($Mode -eq 'stop-legacy-mcp') { Write-Output 'A desktop window was opened. Retry and save it first.'; exit 10 }
        $helper = Start-Process -FilePath $target -ArgumentList '--quit-for-install' -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(180)
        do {
            Start-Sleep -Milliseconds 250
            $desktop = @(Get-TargetProcesses | Where-Object { -not (Test-MokiMcpProcess -Executable $target -Process $_) })
            if ($desktop.Count -eq 0) { break }
            $helper.Refresh()
            if ($helper.HasExited -and $helper.ExitCode -eq 2) { Write-Output 'Update cancelled in MOKI Notes. All windows remain open.'; exit 2 }
            if ($helper.HasExited -and $helper.ExitCode -eq 3) { Write-Output 'Notes could not be saved. Resolve the issue in MOKI Notes, then retry.'; exit 10 }
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($desktop.Count -gt 0) { Write-Output 'The desktop app did not exit. Confirm Save and Close; older versions must be saved and exited manually.'; exit 10 }
    }
    # Agent-owned Node processes use the same EXE but have no desktop or tray.
    # Ask their own control pipe to drain requests and close SQLite first.
    foreach ($entry in @(Get-TargetProcesses)) {
        if (-not (Test-MokiMcpProcess -Executable $target -Process $entry)) { Write-Output 'A desktop process appeared. Retry and save it first.'; exit 10 }
        $result = Request-MokiMcpShutdown -Executable $target -ProcessId $entry.ProcessId
        if ($result -eq 'legacy') {
            if ($Mode -ne 'stop-legacy-mcp') { Write-Output 'Legacy Agent MCP connection is holding the installation files. Close its MCP connection, or confirm stopping only these legacy MCP processes.'; exit 30 }
            # This mode is reached only after a separate explicit installer consent.
            $fresh = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.ProcessId)"
            if ($fresh) {
                if ($fresh.CreationDate -ne $entry.CreationDate -or -not (Test-MokiMcpProcess -Executable $target -Process $fresh)) { throw 'Process identity changed; refusing to stop it.' }
                Stop-Process -Id $fresh.ProcessId -ErrorAction Stop
                Write-Output "Stopped explicitly approved legacy MCP PID $($fresh.ProcessId)"
            }
        } elseif ($result -ne 'closed') { Write-Output 'MCP is still processing a request. Wait for the Agent operation to finish, then retry.'; exit 10 }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do { if (@(Get-TargetProcesses).Count -eq 0) { exit 0 }; Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $deadline)
    Write-Output 'An Agent reconnected or a process is still exiting. Pause the MOKI Notes MCP connection and retry.'
    exit 10
} catch {
    Write-Output "Unable to verify the target application: $($_.Exception.Message)"
    exit 20
}
