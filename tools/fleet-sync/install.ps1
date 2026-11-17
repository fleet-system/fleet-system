# تثبيت مزامنة Excel اللحظية (مرة واحدة): ينسخ البرنامج إلى %LOCALAPPDATA%\FleetSync، يضيفه لبدء تشغيل ويندوز، ويشغّله الآن.
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Docs = Split-Path $Here
$File = Get-ChildItem -LiteralPath $Docs -Filter '*.xlsx' | Where-Object { $_.Name -like '*النسخه الجديده*' -and $_.Name -notlike '~$*' } | Select-Object -First 1
if (-not $File) { Write-Host 'لم أجد ملف «قاعة البيانات... النسخه الجديده» في المستندات' -ForegroundColor Red; Read-Host 'اضغط Enter'; exit 1 }
$Dir = Join-Path $env:LOCALAPPDATA 'FleetSync'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Copy-Item (Join-Path $Here 'fleet-sync.ps1') $Dir -Force
if (Test-Path (Join-Path $Here 'key.txt')) { Move-Item (Join-Path $Here 'key.txt') (Join-Path $Dir 'key.txt') -Force }   # المفتاح يخرج من OneDrive
(@{ file = $File.FullName } | ConvertTo-Json) | Set-Content (Join-Path $Dir 'config.json') -Encoding UTF8
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Dir 'fleet-sync.ps1') + '"'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'FleetExcelSync.lnk'
$sh = New-Object -ComObject WScript.Shell; $s = $sh.CreateShortcut($lnk); $s.TargetPath = $ps; $s.Arguments = $arg; $s.WindowStyle = 7; $s.Save()
Start-Process -FilePath $ps -ArgumentList $arg -WindowStyle Hidden
Write-Host 'تم التثبيت. المزامنة تعمل الآن وتبدأ تلقائياً مع تشغيل الجهاز.' -ForegroundColor Green
Write-Host ('الملف المراقب: ' + $File.FullName)
Start-Sleep -Seconds 25
$log = Join-Path $Dir 'log.txt'
if (Test-Path $log) { Get-Content $log -Encoding UTF8 | Select-Object -Last 3 }
Read-Host 'اضغط Enter للإغلاق'
