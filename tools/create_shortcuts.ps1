$WshShell = New-Object -ComObject WScript.Shell

# 1. Admin Panel Shortcut
$adminLnk = $WshShell.CreateShortcut("$PSScriptRoot\..\Admin_Console.lnk")
$adminLnk.TargetPath = "$PSScriptRoot\..\run_admin.bat"
$adminLnk.WorkingDirectory = "$PSScriptRoot\.."
$adminLnk.IconLocation = "%SystemRoot%\System32\imageres.dll, 102"
$adminLnk.Description = "Lerne TMA Admin Console"
$adminLnk.Save()

# 2. Dev Launcher Shortcut
$devLnk = $WshShell.CreateShortcut("$PSScriptRoot\..\Launch_Lerne_TMA.lnk")
$devLnk.TargetPath = "$PSScriptRoot\..\run_dev.bat"
$devLnk.WorkingDirectory = "$PSScriptRoot\.."
$devLnk.IconLocation = "%SystemRoot%\System32\imageres.dll, 98"
$devLnk.Description = "Lerne TMA Dev Launcher"
$devLnk.Save()

Write-Host "Created shortcuts Admin_Console.lnk and Launch_Lerne_TMA.lnk"
