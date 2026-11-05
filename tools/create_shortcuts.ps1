$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$entries = @(
    @{ Name = 'Lerne — облачная БД'; File = 'run_cloud.bat'; Icon = 'shell32.dll,13'; Description = 'Lerne и Game Mode. Облачная база данных.' },
    @{ Name = 'Lerne — локальная БД'; File = 'run_local.bat'; Icon = 'shell32.dll,8'; Description = 'Lerne и Game Mode. Изолированная локальная PostgreSQL; AI и TTS отключены.' }
)
foreach ($entry in $entries) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop ($entry.Name + '.lnk')))
    $shortcut.TargetPath = Join-Path $projectRoot $entry.File
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.IconLocation = Join-Path $env:SystemRoot ('System32\' + $entry.Icon)
    $shortcut.Description = $entry.Description
    $shortcut.Save()
    Write-Host ('Created: ' + $entry.Name)
}
# Replace only the obsolete Lerne launchers belonging to this project.
foreach ($name in @('Lerne Clean Restart', 'Lerne Cloud Server', 'Lerne Dev Server', 'Lerne GameMode V2')) {
    $path = Join-Path $desktop ($name + '.lnk')
    if (Test-Path -LiteralPath $path) {
        $shortcut = $shell.CreateShortcut($path)
        if ($shortcut.TargetPath.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $path
        }
    }
}
