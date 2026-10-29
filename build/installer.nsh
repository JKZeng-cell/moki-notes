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
      StrCpy $R6 ""
    ${ElseIf} $R7 == 10
      MessageBox MB_OKCANCEL|MB_ICONQUESTION "MOKI便签正在运行。点击确定，将自动保存主窗口和桌面便签的编辑内容，关闭便签及其 MCP 后台，然后继续安装。保存失败时会保留窗口，不会强制关闭。$\r$\n$\r$\n旧版本还会在便签窗口中显示“保存并关闭”，请一并确认。是否继续？" /SD IDCANCEL IDOK +3
      SetErrorLevel 2
      Quit
      StrCpy $R6 "-SaveConfirmed"
    ${EndIf}
    ${If} $R7 == 10
      DetailPrint "正在保存并关闭 MOKI便签。旧版本若出现“保存并关闭”窗口，请确认后继续。"
      !insertmacro MokiInstallLog "Save and close confirmed; requesting graceful exit."
      nsExec::ExecToStack /TIMEOUT=400000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode quit $R6'
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
      ${If} $R7 == 40
        StrCpy $R8 "程序未响应或上一次退出仍未完成，不能确认自动保存成功。请返回便签检查窗口；不要反复点击重试。未确认保存成功前，安装器不会强制结束编辑进程。$\r$\n$\r$\n$R8"
      ${EndIf}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "MOKI便签尚未退出，安装文件仍被占用。$\r$\n$\r$\n请先检查便签窗口：若有“保存并关闭”提示，请确认；若提示保存错误或版本冲突，请处理后重试。若下方显示 MCP 正忙或重新连接，请在 Agent 中暂停便签连接后重试。旧版本也可保存后从托盘退出。$\r$\n$\r$\n目标：$INSTDIR\${APP_EXECUTABLE_FILENAME}$\r$\n$R8" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 2
      Quit
      nsExec::ExecToStack /TIMEOUT=15000 '"$PowerShellPath" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\moki-installer-process.ps1" -InstallDirectory "$INSTDIR" -Mode check'
      Pop $R7
      Pop $R8
    ${EndIf}
  ${Loop}
!macroend
