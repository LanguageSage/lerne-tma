$WshShell = New-Object -ComObject WScript.Shell

# Dev Launcher Shortcut
$devLnk = $WshShell.CreateShortcut("$PSScriptRoot\..\Launch_Lerne_TMA.lnk")
$devLnk.TargetPath = "$PSScriptRoot\..\run_dev.bat"
$devLnk.WorkingDirectory = "$PSScriptRoot\.."
$devLnk.IconLocation = "%SystemRoot%\System32\imageres.dll, 98"
$devLnk.Description = "Lerne TMA Dev Launcher"
$devLnk.Save()

Write-Host "Created shortcut Launch_Lerne_TMA.lnk; admin shortcuts belong to lerne-admin"
