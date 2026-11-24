; Windows setup program for the Universal Wisdom Library (Inno Setup 6).
;
; Built by the release workflow on a Windows runner, after build:app:
;   iscc /DAppVersion=0.2.1 installer\windows.iss
; Output: dist\UniversalWisdomLibrary-<version>-windows-setup.exe
;
; It installs for the current user only (no administrator rights), adds a
; Start menu entry and optionally a desktop shortcut, and offers to open the
; library when it finishes. The library itself (about 7 GB, downloaded on the
; first start) lives in %LOCALAPPDATA%\Universal Wisdom Library; uninstalling
; asks whether to delete it too.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Universal Wisdom Library"
#define AppExe "Universal Wisdom Library.exe"

[Setup]
AppId={{6F2B8C1E-4D3A-4E7B-9C51-2A8F0D7E3B64}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppName}
AppPublisherURL=https://github.com/Archaejon/universal-wisdom-library
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=UniversalWisdomLibrary-{#AppVersion}-windows-setup
SetupIconFile=..\assets\icon\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Close a running copy before replacing or removing it.
CloseApplications=force

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\UniversalWisdomLibrary-{#AppVersion}-windows-x64\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\UniversalWisdomLibrary-{#AppVersion}-windows-x64\READ ME FIRST.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Messages]
FinishedLabel=The Universal Wisdom Library is installed. The first time it opens, it downloads the library (about 3 GB) and shows the progress in your web browser.

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open the {#AppName} now"; Flags: nowait postinstall skipifsilent

[Code]
// Uninstalling removes the program. The downloaded library (about 7 GB) is
// the reader's data, so ask before deleting it.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  LibraryDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    LibraryDir := ExpandConstant('{localappdata}\{#AppName}');
    if DirExists(LibraryDir) then
      if MsgBox('Also delete the downloaded library (about 7 GB) in ' + LibraryDir + '?' + #13#10#13#10 +
                'Choose No to keep it, so a reinstall doesn''t have to download it again.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(LibraryDir, True, True, True);
  end;
end;
