# Genera avatar e iconos de Michi a partir del gato pixel de assets/gato-pixel.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$sourceFile = Join-Path $assets 'gato-pixel\reference.png'
if (-not (Test-Path -LiteralPath $sourceFile)) {
  throw 'No se encuentra assets\gato-pixel\reference.png'
}

$source = [System.Drawing.Image]::FromFile($sourceFile)
Write-Output "Origen: gato-pixel\reference.png $($source.Width)x$($source.Height)"

# Recorte del rostro en la referencia de 236x216.
$crop = New-Object System.Drawing.Rectangle 28, 0, 180, 180

function New-Canvas([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

function Save-Avatar([string]$file, [int]$size) {
  $canvas = New-Canvas $size
  $bmp = $canvas[0]; $g = $canvas[1]
  $dest = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $g.DrawImage($source, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "Avatar: $file (${size}px)"
}

function Save-Icon([string]$file, [int]$size) {
  $canvas = New-Canvas $size
  $bmp = $canvas[0]; $g = $canvas[1]
  $scale = $size / 256.0
  $pad = [int](4 * $scale)
  $disk = New-Object System.Drawing.Rectangle $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)

  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 246, 235))
  $g.FillEllipse($brush, $disk)
  $penWidth = [Math]::Max(1, 5 * $scale)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 242, 211, 180), $penWidth)
  $g.DrawEllipse($pen, $disk.X + $penWidth / 2, $disk.Y + $penWidth / 2, $disk.Width - $penWidth, $disk.Height - $penWidth)

  $inner = [int](18 * $scale)
  $top = [int](10 * $scale)
  $dest = New-Object System.Drawing.Rectangle $inner, $top, ($size - 2 * $inner), ($size - 2 * $inner)
  $g.DrawImage($source, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)

  $brush.Dispose(); $pen.Dispose()
  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "Icono: $file (${size}px)"
}

Save-Avatar (Join-Path $assets 'avatar.png') 256
Save-Icon (Join-Path $assets 'icon.png') 256
Save-Icon (Join-Path $assets 'tray.png') 32
Save-Icon (Join-Path $assets 'tray@2x.png') 64

$source.Dispose()
Write-Output 'Listo.'
