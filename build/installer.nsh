!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro MokiInstallLog TEXT
  Push $R9
  FileOpen $R9 "$TEMP\MOKI-Notes-installer.log" a
  FileSeek $R9 0 END
  FileWrite $R9 "${TEXT}$\r$\n"
  FileClose $R9
  Pop $R9
!macroend

; Both install and uninstall use this hook. Do not use the builder default
; StartsWith($INSTDIR) process scan or its directory-wide Stop-Process.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; The UI normalizes directories, but /S /D bypasses that page. Keep shared
    ; software roots and drive roots out of install/uninstall ownership.
    ${GetFileName} "$INSTDIR" $R6
    ${If} $R6 == "Program Files"
    ${OrIf} $R6 == "Program Files (x86)"
    ${OrIf} $R6 == ""
      StrCpy $INSTDIR "$INSTDIR\MOKI-Notes"
    ${EndIf}
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !endif
  InitPluginsDir
  File /oname=$PLUGINSDIR\moki-installer-process.ps1 "${PROJECT_DIR}\build\installer-process.ps1"
  File /oname=$PLUGINSDIR\installer-process.psm1 "${PROJECT_DIR}\build\installer-process.psm1"
  DetailPrint "Checking MOKI Notes executable: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
  !insertmacro MokiInstallLog "Check target: $INSTDIR\${APP_EXECUTABLE_FILENAME}"
  nsExec::ExecToStack /TIMEOUT=15000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode check'
  Pop $R7
  Pop $R8
  DetailPrint "$R8"
  !insertmacro MokiInstallLog "Check result: $R7; $R8"
  ${DoWhile} $R7 != 0
    ${If} $R7 == 11
      MessageBox MB_OKCANCEL|MB_ICONQUESTION "Agent 正在连接 MOKI便签。继续安装将断开便签 MCP 连接，已开始的请求会先完成；安装后请在 Agent 中重新连接。$\r$\n$\r$\n是否继续？" /SD IDCANCEL IDOK +3
      SetErrorLevel 2
      Quit
      StrCpy $R7 10
    ${EndIf}
    ${If} $R7 == 10
      DetailPrint "请在 MOKI便签中确认保存并关闭，安装将在退出后继续。"
      nsExec::ExecToStack /TIMEOUT=400000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode quit'
      Pop $R7
      Pop $R8
      DetailPrint "$R8"
      !insertmacro MokiInstallLog "Quit result: $R7; $R8"
    ${EndIf}
    ${If} $R7 == 30
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "旧版便签 MCP 后台仍占用安装文件，且不支持平滑退出。这不是便签窗口。$\r$\n$\r$\n请先确认 Agent 没有正在执行便签操作。点击确定，仅结束本安装目录中的旧版便签 MCP 连接并继续；不会关闭 Codex 或删除便签。也可取消安装，在 Agent 中断开连接后重试。" /SD IDCANCEL IDOK +3
      SetErrorLevel 2
      Quit
      nsExec::ExecToStack /TIMEOUT=220000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode stop-legacy-mcp'
      Pop $R7
      Pop $R8
      !insertmacro MokiInstallLog "MCP exit result: $R7; $R8"
    ${EndIf}
    ${If} $R7 == 2
      SetErrorLevel 2
      Quit
    ${EndIf}
    ${If} $R7 != 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "MOKI便签尚未完成保存并关闭。请处理空标题、版本冲突或保存错误后重试。旧版本请先手动保存，再从托盘退出。$\r$\n$\r$\n目标：$INSTDIR\${APP_EXECUTABLE_FILENAME}$\r$\n$R8" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 2
      Quit
      nsExec::ExecToStack /TIMEOUT=15000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode check'
      Pop $R7
      Pop $R8
    ${EndIf}
  ${Loop}
!macroend
