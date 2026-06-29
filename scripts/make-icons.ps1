# Renders icon-{16,32,48,128}.png into the project root from the same geometry
# as icon.svg. Uses System.Drawing (built-in). Run with Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot   # project root (parent of scripts/)
$sizes = 16, 32, 48, 128
$srcSize = 128.0

foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $scale = $size / $srcSize
    $g.ScaleTransform($scale, $scale)

    # Background: rounded square in brand-green
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#005141"))
    $bgPath  = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 24.0
    $d = $r * 2
    $bgPath.AddArc(0, 0, $d, $d, 180, 90)
    $bgPath.AddArc(128 - $d, 0, $d, $d, 270, 90)
    $bgPath.AddArc(128 - $d, 128 - $d, $d, $d, 0, 90)
    $bgPath.AddArc(0, 128 - $d, $d, $d, 90, 90)
    $bgPath.CloseFigure()
    $g.FillPath($bgBrush, $bgPath)

    # Analytics bars inside the lens (white)
    $barBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillRectangle($barBrush, 37, 50, 8, 20)
    $g.FillRectangle($barBrush, 48, 42, 8, 28)
    $g.FillRectangle($barBrush, 59, 34, 8, 36)

    # Magnifier ring in brand-orange
    $orange = [System.Drawing.ColorTranslator]::FromHtml("#C44E00")
    $ringPen = New-Object System.Drawing.Pen $orange, 10
    $g.DrawEllipse($ringPen, 18, 18, 68, 68)   # circle cx=52 cy=52 r=34

    # Magnifier handle
    $handlePen = New-Object System.Drawing.Pen $orange, 13
    $handlePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handlePen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($handlePen, 78, 78, 100, 100)

    $ringPen.Dispose()
    $handlePen.Dispose()
    $barBrush.Dispose()
    $bgBrush.Dispose()
    $g.Dispose()

    $out = Join-Path $root "icon-$size.png"
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    Write-Host "Created $out"
}
