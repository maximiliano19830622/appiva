Param(
  [Parameter(Mandatory=$true)][string]$Template,
  [Parameter(Mandatory=$true)][string]$OutputPdf,
  [Parameter(Mandatory=$true)][string]$DataJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Template)) { throw "Template not found: $Template" }
if (-not (Test-Path $DataJson)) { throw "Data file not found: $DataJson" }

$map = Get-Content $DataJson -Raw | ConvertFrom-Json

function ReplaceInTextRange($tr, $needle, $replacement) {
  try { $null = $tr.Replace($needle, [string]$replacement, 0, 0) } catch {}
}

$pp = $null
try {
  $pp = New-Object -ComObject PowerPoint.Application
  $pp.Visible = $false
  $pres = $pp.Presentations.Open($Template, $true, $false, $false)
  try {
    foreach ($slide in $pres.Slides) {
      foreach ($shape in $slide.Shapes) {
        try {
          if ($shape.HasTextFrame -ne $true) { continue }
          if ($shape.TextFrame.HasText -eq 0) { continue }
          $tr = $shape.TextFrame.TextRange
          foreach ($p in $map.PSObject.Properties) {
            $k = [string]$p.Name
            $v = [string]$p.Value
            ReplaceInTextRange $tr ("#$k#") $v
          }
        } catch {}
      }
    }
    # Exportar a PDF: 32 = ppFixedFormatTypePDF
    $pres.ExportAsFixedFormat($OutputPdf, 32)
  } finally {
    $pres.Close()
  }
} finally {
  if ($pp) { $pp.Quit() }
}

Write-Output "OK $OutputPdf"

