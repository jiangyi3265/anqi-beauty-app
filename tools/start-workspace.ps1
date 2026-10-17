$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$running = $false
try { $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; $running = $health.ok -eq $true } catch {}
if (-not $running) {
  Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $PSScriptRoot 'start-local.ps1') + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden
  for ($i=0;$i -lt 30;$i++) { try { $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health' -TimeoutSec 1; if($health.ok){break} } catch {}; Start-Sleep -Milliseconds 300 }
}
$hbuilder = 'G:/HBuilderX/HBuilderX/cli.exe'
if (Test-Path -LiteralPath $hbuilder) { & $hbuilder project open --path $projectRoot }
$wechat = 'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat'
$wechatProject = Join-Path $projectRoot 'dist/build/mp-weixin'
if ((Test-Path -LiteralPath $wechat) -and (Test-Path -LiteralPath $wechatProject)) { & $wechat open --project $wechatProject }
Start-Process 'https://anqiht.okam.top'
