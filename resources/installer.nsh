; Optional Windows integrations, offered at install time.
;
;  * "Open dir with flashgent" in the Explorer folder context menu
;  * the `fgen` launcher on PATH
;
; Both are registered per-user so the installer never needs elevation.

!macro customInstall
  ; --- Explorer context menu on directories --------------------------------
  WriteRegStr HKCU "Software\Classes\Directory\shell\flashgent" "" "Open dir with flashgent"
  WriteRegStr HKCU "Software\Classes\Directory\shell\flashgent" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\flashgent\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'

  ; Same entry when right-clicking the background of an open folder.
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\flashgent" "" "Open dir with flashgent"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\flashgent" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\flashgent\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'

  ; --- `fgen` on PATH -------------------------------------------------------
  CreateDirectory "$LOCALAPPDATA\flashgent\bin"
  FileOpen $0 "$LOCALAPPDATA\flashgent\bin\fgen.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 'start "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" %*$\r$\n'
  FileClose $0

  ; Append to the user PATH once. A registry flag records that we did it, so a
  ; reinstall cannot append the same entry twice.
  ReadRegStr $2 HKCU "Software\flashgent" "PathAdded"
  StrCmp $2 "1" pathAlreadySet 0
    ReadRegStr $1 HKCU "Environment" "Path"
    WriteRegExpandStr HKCU "Environment" "Path" "$1;$LOCALAPPDATA\flashgent\bin"
    WriteRegStr HKCU "Software\flashgent" "PathAdded" "1"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=3000
  pathAlreadySet:
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\flashgent"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\flashgent"
  Delete "$LOCALAPPDATA\flashgent\bin\fgen.cmd"
  RMDir "$LOCALAPPDATA\flashgent\bin"
  DeleteRegKey HKCU "Software\flashgent"
  ; Sessions and settings are intentionally left in place:
  ;   %APPDATA%\flashgent  and  %USERPROFILE%\.flashgent
!macroend
