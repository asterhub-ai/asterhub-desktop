param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($Source)
$bitmap = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
try {
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage($sourceImage, 0, 0, 256, 256)
  $pngStream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $pngStream.ToArray()
  }
  finally { $pngStream.Dispose() }

  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$png.Length)
  $writer.Write([UInt32]22)
  $writer.Write($png)
  [System.IO.File]::WriteAllBytes($Destination, $stream.ToArray())
}
finally {
  $writer.Dispose()
  $stream.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $sourceImage.Dispose()
}
