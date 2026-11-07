; NSIS installer hooks (tauri.conf.json bundle.windows.nsis.installerHooks).
;
; Windows cannot associate a folder by its extension, so the `.grainatlas`
; association in tauri.conf.json covers files only. This adds "Open in UPb Lab"
; to the Explorer menu of every folder instead: a TM4000 package, an
; area folder, a Qtegra export or a `.grainatlas` project folder. The path
; arrives as an argument (src-tauri/src/files.rs `paths_in_args`) and the
; shell routes it by content (ux-conventions rule 4).
;
; The installer is per user (installMode currentUser), so the verb goes to
; HKCU and needs no administrator rights. The MSI build does not add it.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\UPbStudio" "" "Open in UPb Lab"
  WriteRegStr HKCU "Software\Classes\Directory\shell\UPbStudio" "Icon" "$INSTDIR\upbstudio.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\UPbStudio\command" "" '"$INSTDIR\upbstudio.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\UPbStudio"
!macroend
