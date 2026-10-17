$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath '.env')) {
  $localPassword = [Guid]::NewGuid().ToString('N').Substring(0,16)
  "PORT=3000`nHOST=127.0.0.1`nDEMO_MODE=true`nADMIN_PASSWORD=$localPassword`nPAYMENT_MODE=off" | Set-Content -LiteralPath '.env' -Encoding utf8
}
node --env-file-if-exists=.env server/index.cjs

