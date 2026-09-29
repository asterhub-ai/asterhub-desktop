param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseResources,
  [string]$OutputDirectory = (Join-Path $env:TEMP 'asterhub-catalog-artifacts')
)

$ErrorActionPreference = 'Stop'
$required = @(
  'cli\genoffice.cjs',
  'cli\node_modules',
  'native\xlsx-sidecar.exe',
  'wasm\pdfium.wasm',
  'ocr\win-ocr.exe'
)
foreach ($relative in $required) {
  $candidate = Join-Path $ReleaseResources $relative
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "GenOffice v0.11.0 release resource is missing: $candidate"
  }
}

$source = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$release = (Resolve-Path -LiteralPath $ReleaseResources).Path
$stage = Join-Path $env:TEMP "asterhub-genoffice-stage-$PID"
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$stageFullPath = [System.IO.Path]::GetFullPath($stage)
if (-not $stageFullPath.StartsWith("$tempRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Temporary staging directory escaped the system temporary directory.'
}
if (-not $output.StartsWith("$tempRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be inside the system temporary directory.'
}

try {
if (Test-Path -LiteralPath $stageFullPath) { Remove-Item -LiteralPath $stageFullPath -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $output -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $stage
Copy-Item -LiteralPath (Join-Path $source 'cordis.patch.yml') -Destination $stage
Copy-Item -LiteralPath (Join-Path $source 'index.mjs') -Destination $stage
Copy-Item -LiteralPath (Join-Path $source 'UPSTREAM.md') -Destination $stage
foreach ($file in @('LICENSE', 'NOTICE', 'LICENSE-UNICODE.txt')) {
  Copy-Item -LiteralPath (Join-Path $source $file) -Destination $stage
}
$noticesInput = [System.IO.File]::OpenRead((Join-Path $source 'THIRD-PARTY-NOTICES.txt.gz'))
$noticesOutput = [System.IO.File]::Create((Join-Path $stage 'THIRD-PARTY-NOTICES.txt'))
$noticesGzip = [System.IO.Compression.GzipStream]::new($noticesInput, [System.IO.Compression.CompressionMode]::Decompress)
try { $noticesGzip.CopyTo($noticesOutput) }
finally { $noticesGzip.Dispose(); $noticesOutput.Dispose(); $noticesInput.Dispose() }
New-Item -ItemType Directory -Path (Join-Path $stage 'resources') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'cli') -Destination (Join-Path $stage 'resources') -Recurse
foreach ($directory in @('native', 'wasm', 'ocr')) {
  New-Item -ItemType Directory -Path (Join-Path $stage "resources\$directory") -Force | Out-Null
  $file = switch ($directory) {
    'native' { 'xlsx-sidecar.exe' }
    'wasm' { 'pdfium.wasm' }
    'ocr' { 'win-ocr.exe' }
  }
  Copy-Item -LiteralPath (Join-Path $release "$directory\$file") -Destination (Join-Path $stage "resources\$directory\$file")
}

Push-Location $stage
try {
  npm pack --ignore-scripts --silent --pack-destination $output
  if ($LASTEXITCODE -ne 0) { throw 'npm pack failed for the GenOffice CLI bundle.' }
}
finally { Pop-Location }

Get-ChildItem -LiteralPath $output -Filter 'asterhub-genoffice-cli-0.11.0-asterhub.1.tgz' | Select-Object FullName,Length
}
finally {
  if (Test-Path -LiteralPath $stageFullPath) { Remove-Item -LiteralPath $stageFullPath -Recurse -Force }
}
