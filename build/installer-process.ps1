param(
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [ValidateSet('check','quit','stop-legacy-mcp')][string]$Mode = 'check',
    [switch]$SaveConfirmed
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
    $desktop = @(Select-MokiDesktopProcess -Executable $target -Processes $running)
    if ($Mode -eq 'check') { if ($desktop.Count -eq 0 -and @($running | Where-Object { Test-MokiMcpProcess -Executable $target -Process $_ }).Count -eq $running.Count) { exit 11 }; exit 10 }
    # The installer may own confirmation, but the app always owns saving.
    # Direct invocations still ask in the app. Its helper returns 2 on cancel and
    # 3 on save failure. Legacy versions return 0 immediately, so still inspect
    # the exact executable until every process has exited.
    if ($desktop.Count -gt 0) {
        if ($Mode -eq 'stop-legacy-mcp') { Write-Output 'A desktop window was opened. Retry and save it first.'; exit 10 }
        $helperArgs = @('--quit-for-install')
        if ($SaveConfirmed) { $helperArgs += '--install-save-confirmed' }
        Write-Output 'Waiting for the desktop to save and close. Older versions also require Save and Close in the app.'
        $helper = Start-Process -FilePath $target -ArgumentList $helperArgs -WindowStyle Hidden -PassThru
        $deadline = [DateTime]::UtcNow.AddSeconds(180)
        do {
            Start-Sleep -Milliseconds 250
            $desktop = @(Select-MokiDesktopProcess -Executable $target -Processes @(Get-TargetProcesses))
            if ($desktop.Count -eq 0) { break }
            $helper.Refresh()
            if ($helper.HasExited -and $helper.ExitCode -eq 2) { Write-Output 'Update cancelled in MOKI Notes. All windows remain open.'; exit 2 }
            if ($helper.HasExited -and $helper.ExitCode -eq 3) { Write-Output 'Notes could not be saved. Resolve the issue in MOKI Notes, then retry.'; exit 10 }
            if ($helper.HasExited -and $helper.ExitCode -eq 4) { Write-Output 'The application did not reply to the exit request. This is a response timeout, not a confirmed save failure. Restore its window and inspect install-exit.log in the app profile.'; exit 40 }
            if ($helper.HasExited -and $helper.ExitCode -eq 5) { Write-Output 'An earlier save-and-close request is still pending. Return to the app and finish or cancel that request before retrying.'; exit 40 }
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($desktop.Count -gt 0) { Write-Output 'The desktop did not respond or finish exiting in time. This does not prove a save failure. Check its window and install-exit.log; older versions must be saved and exited manually.'; exit 40 }
    }
    # A retry can leave a quit-only helper waiting for an obsolete reply. It
    # never owns a database or editor. Reclaim only these exact helpers after
    # every real desktop process has exited; never terminate an editing app.
    foreach ($entry in @(Get-TargetProcesses | Where-Object { Test-MokiInstallHelper -Executable $target -Process $_ })) {
        if (@(Select-MokiDesktopProcess -Executable $target -Processes @(Get-TargetProcesses)).Count) { Write-Output 'A desktop was opened. Retry and save it first.'; exit 10 }
        $fresh = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.ProcessId)"
        if ($fresh -and $fresh.CreationDate -eq $entry.CreationDate -and (Test-MokiInstallHelper -Executable $target -Process $fresh)) {
            Stop-Process -Id $fresh.ProcessId -ErrorAction SilentlyContinue
            Write-Output "Released quit-only helper PID $($fresh.ProcessId) after the desktop exited."
        }
    }
    # Allow Electron's helper children to follow their parent out.
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $remainingDesktop = @(Select-MokiDesktopProcess -Executable $target -Processes @(Get-TargetProcesses))
        if (-not $remainingDesktop.Count) { break }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    # Agent-owned Node processes use the same EXE but have no desktop or tray.
    # Ask their own control pipe to drain requests and close SQLite first.
    foreach ($entry in @(Get-TargetProcesses)) {
        if (-not (Test-MokiMcpProcess -Executable $target -Process $entry)) { Write-Output 'A desktop process appeared. Retry and save it first.'; exit 10 }
        Write-Output "Closing Agent MCP PID $($entry.ProcessId) after pending operations finish."
        $result = Request-MokiMcpShutdown -Executable $target -ProcessId $entry.ProcessId
        Write-Output "MCP PID $($entry.ProcessId): $result"
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
