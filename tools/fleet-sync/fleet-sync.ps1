# مزامنة Excel اللحظية مع نظام الأسطول (1.35)
# يراقب ملف Excel المالك، وعند كل حفظ يرسله إلى دالة cost-sync في Supabase (الصيانة، الزيت، الكفرات، البطاريات).
# الموقع يضيف الجديد ويحدّث المعدّل ويؤرشف المحذوف — لا حذف أبداً. هذا البرنامج يقرأ الملف فقط ولا يعدّله.
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:LOCALAPPDATA 'FleetSync'
$Log = Join-Path $Dir 'log.txt'
$Cfg = Get-Content (Join-Path $Dir 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$Key = (Get-Content (Join-Path $Dir 'key.txt') -Raw).Trim()
$Url = 'https://pemyrokrbqzwvtretawa.supabase.co/functions/v1/cost-sync'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FleetExcelSync', [ref]$created)
if (-not $created) { exit }   # نسخة واحدة فقط

function Write-Log($m) {
  $line = (Get-Date -Format 'yyyy/MM/dd HH:mm:ss') + '  ' + $m
  Add-Content -Path $Log -Value $line -Encoding UTF8
  $all = Get-Content $Log -Encoding UTF8
  if ($all.Count -gt 300) { $all | Select-Object -Last 200 | Set-Content $Log -Encoding UTF8 }
}

function Send-File {
  $tmp = Join-Path $Dir 'upload.xlsx'
  for ($i = 0; $i -lt 5; $i++) {
    try { [IO.File]::Copy($Cfg.file, $tmp, $true); break }
    catch {
      try {   # Excel يقفل الملف أحياناً: نقرأه بمشاركة القراءة والكتابة
        $src = [IO.File]::Open($Cfg.file, 'Open', 'Read', 'ReadWrite'); $dst = [IO.File]::Create($tmp)
        $src.CopyTo($dst); $dst.Close(); $src.Close(); break
      } catch { Start-Sleep -Seconds 2 }
    }
  }
  if (-not (Test-Path $tmp)) { throw 'could not read the Excel file' }
  $r = Invoke-WebRequest -Uri $Url -Method Post -InFile $tmp -ContentType 'application/octet-stream' -Headers @{ 'x-sync-key' = $Key } -UseBasicParsing -TimeoutSec 120
  Remove-Item $tmp -ErrorAction SilentlyContinue
  return ($r.Content | ConvertFrom-Json)
}

Write-Log ('started, watching: ' + $Cfg.file)
$lastSent = ''; $failedAt = $null; $sig = ''
while ($true) {
  try {
    if (Test-Path -LiteralPath $Cfg.file) {
      $f = Get-Item -LiteralPath $Cfg.file
      $sig = '' + $f.LastWriteTimeUtc.Ticks + ':' + $f.Length
      $retry = $failedAt -and ((Get-Date) - $failedAt).TotalMinutes -ge 5
      if ($sig -ne $lastSent -or $retry) {
        Start-Sleep -Seconds 3   # ننتظر انتهاء الحفظ
        $f = Get-Item -LiteralPath $Cfg.file
        $sig2 = '' + $f.LastWriteTimeUtc.Ticks + ':' + $f.Length
        if ($sig2 -eq $sig) {
          $res = Send-File
          $x = $res.result
          Write-Log ("synced: rows $($res.rows) | new $($x.new), updated $($x.updated), unchanged $($x.unchanged), archived $($x.archived), restored $($x.restored)")
          $lastSent = $sig; $failedAt = $null
        }
      }
    }
  } catch {
    Write-Log ('error (will retry): ' + $_.Exception.Message); $failedAt = Get-Date; if ($sig) { $lastSent = $sig }
  }
  Start-Sleep -Seconds 10
}
