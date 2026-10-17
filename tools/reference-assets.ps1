$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot=Split-Path $PSScriptRoot -Parent
$out=Join-Path $projectRoot 'static/reference'
New-Item -ItemType Directory -Force $out | Out-Null
function Crop($id,$name,$x,$y,$w,$h){
 $src=[Drawing.Bitmap]::FromFile((Join-Path $env:TEMP ('codex-clipboard-'+$id+'.png')))
 try{$img=$src.Clone([Drawing.Rectangle]::new($x,$y,$w,$h),$src.PixelFormat);try{$img.Save((Join-Path $out ($name+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$img.Dispose()}}finally{$src.Dispose()}
}
Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'shortcut-trial' 60 237 48 48
Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'shortcut-vip' 184 237 48 48
Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'shortcut-share' 306 237 48 48
Crop '2536f27a-edca-4f08-a047-42fe1372faba' 'welcome-texture' 0 116 414 35
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'daily' 54 321 67 67
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'income' 174 321 67 67
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'redeem' 293 321 67 67
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'points' 131 185 57 57
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'earnings' 329 185 57 57
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'pool' 165 331 48 38
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'menu-orders' 32 423 30 31
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'menu-addresses' 32 483 30 32
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'menu-shares' 32 544 30 32
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'menu-earnings' 32 605 30 32
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'menu-contact' 32 683 30 29
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'tab-home' 39 724 26 28
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'tab-mall' 142 724 26 28
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'tab-discover' 246 724 26 28
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'tab-mine' 350 724 26 28
Crop 'acecbd8e-0321-4b27-a0bf-edd00c487ed8' 'tab-home-active' 39 724 26 28
Crop 'c701e92e-3086-4b6b-9d85-0a4f1eec82d6' 'tab-discover-active' 246 724 26 28
Crop '67586bd0-88bb-465b-9096-2373d5b62e23' 'tab-mine-active' 350 724 26 28
Crop '3799a6bb-4650-4773-bdab-8316e652110d' 'sign-off' 36 342 36 36
Crop '52580418-60bb-4b7c-acc9-b39e7971b98a' 'sign-on' 36 342 36 36
Crop 'd762ec27-f8c8-4a32-897a-0bbb6a44e60e' 'share-card' 19 499 376 267
Crop '49a1a9f0-6c3c-46fd-9b2a-c84069276a94' 'customer-service' 74 730 27 23
Write-Output 'Extracted reference UI icons and textures.'
