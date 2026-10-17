$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$assetRoot = Join-Path $projectRoot 'static/assets'
New-Item -ItemType Directory -Force $assetRoot | Out-Null
function Export-Crop($id, $name, $x, $y, $w, $h) {
  $source = Join-Path $env:TEMP ('codex-clipboard-' + $id + '.png')
  $bitmap = [System.Drawing.Bitmap]::FromFile($source)
  try {
    $rect = New-Object System.Drawing.Rectangle($x,$y,$w,$h)
    $crop = $bitmap.Clone($rect, $bitmap.PixelFormat)
    try { $crop.Save((Join-Path $assetRoot ($name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
  } finally { $bitmap.Dispose() }
}
Export-Crop 'acecbd8e-0321-4b27-a0bf-edd00c487ed8' 'hero' 0 0 414 715
Export-Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'welcome' 0 0 414 204
Export-Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'booking' 15 355 179 250
Export-Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'stores-entry' 217 356 180 120
Export-Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'vip-entry' 217 486 180 119
Export-Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'alliance-entry' 15 619 382 95
Export-Crop '3e7c0e77-c351-4af5-93a8-7d2946acd35b' 'store' 27 91 357 429
Export-Crop '07250257-6908-4676-aa71-3e8d7e370c53' 'service-heading' 0 22 414 221
Export-Crop '5e5d04ec-2b8b-4480-a67e-4f59ba27afee' 'product-heading' 0 95 414 221
Export-Crop '07250257-6908-4676-aa71-3e8d7e370c53' 'service-1' 16 249 380 227
Export-Crop '5e5d04ec-2b8b-4480-a67e-4f59ba27afee' 'mask' 16 317 380 227
Export-Crop '49a1a9f0-6c3c-46fd-9b2a-c84069276a94' 'cream' 5 464 403 242
Export-Crop '7ce8ce7f-8197-4592-8249-400d8963e179' 'service-2' 16 129 182 182
Export-Crop '7ce8ce7f-8197-4592-8249-400d8963e179' 'service-3' 214 129 182 182
Export-Crop 'dec8eb0a-0421-4e66-988d-f2c345f3a40b' 'service-4' 16 396 182 182
Export-Crop 'dec8eb0a-0421-4e66-988d-f2c345f3a40b' 'service-5' 214 396 182 182
Export-Crop '03b20d22-596d-4a3d-9fde-99c66991cddd' 'service-6' 16 180 182 182
Export-Crop '03b20d22-596d-4a3d-9fde-99c66991cddd' 'service-7' 214 180 182 182
Export-Crop '03b20d22-596d-4a3d-9fde-99c66991cddd' 'service-8' 16 447 182 182
Export-Crop '53a3dd63-da76-400e-a44a-383149abe7ba' 'brand' 0 64 414 650
Export-Crop '371de309-7ae8-49fe-9aec-8b6cae290d32' 'brand-logo' 142 218 130 130
Export-Crop '9a58b797-4b60-41e7-be8f-0336121890a9' 'avatar' 124 97 66 85
Export-Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'points-banner' 16 96 380 193
Export-Crop 'd762ec27-f8c8-4a32-897a-0bbb6a44e60e' 'share-art' 0 64 414 438
Write-Output 'Extracted 23 screenshot assets.'
