$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$dest=Join-Path (Split-Path $PSScriptRoot -Parent) 'static/reference'
$tasks=@(@('acecbd8e-0321-4b27-a0bf-edd00c487ed8','hero-logo',16,24,92,26),@('67586bd0-88bb-465b-9096-2373d5b62e23','profile-code',366,108,26,26))
foreach($t in $tasks){$img=[Drawing.Bitmap]::FromFile((Join-Path $env:TEMP ('codex-clipboard-'+$t[0]+'.png')));try{$copy=$img.Clone([Drawing.Rectangle]::new($t[2],$t[3],$t[4],$t[5]),$img.PixelFormat);try{$copy.Save((Join-Path $dest ($t[1]+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$copy.Dispose()}}finally{$img.Dispose()}}
