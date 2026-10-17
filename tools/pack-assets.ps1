$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$assetRoot = Join-Path $projectRoot 'static/assets'
$sourceRoot = Join-Path $projectRoot 'source-assets'
if (-not ([IO.Path]::GetFullPath($sourceRoot).StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar))) { throw '素材目录超出项目范围' }
New-Item -ItemType Directory -Force $sourceRoot | Out-Null
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$parameters = New-Object Drawing.Imaging.EncoderParameters(1)
$parameters.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]92)
$names = @()
Get-ChildItem -LiteralPath $assetRoot -Filter '*.png' | Where-Object BaseName -notin @('brand-logo','avatar') | ForEach-Object {
  $bitmap = [Drawing.Bitmap]::FromFile($_.FullName)
  try { $bitmap.Save((Join-Path $assetRoot ($_.BaseName + '.jpg')), $codec, $parameters) } finally { $bitmap.Dispose() }
  $names += $_.BaseName
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $sourceRoot $_.Name) -Force
}
$parameters.Dispose()
@('components/BeautyScreen.vue','server/seed.cjs','server/data/db.json') | ForEach-Object {
  $file = Join-Path $projectRoot $_
  if (Test-Path -LiteralPath $file) {
    $content = [IO.File]::ReadAllText($file)
    foreach ($assetName in $names) { $content = $content.Replace("/assets/$assetName.png", "/assets/$assetName.jpg") }
    if ($_ -eq 'server/seed.cjs') { $content = $content.Replace("image + '.png'", "image + '.jpg'") }
    [IO.File]::WriteAllText($file,$content)
  }
}
Get-ChildItem -LiteralPath $assetRoot | Measure-Object Length -Sum
