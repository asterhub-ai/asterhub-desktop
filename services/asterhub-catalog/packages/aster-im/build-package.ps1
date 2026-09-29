param(
  [string]$OutputDirectory = (Join-Path $env:TEMP 'asterhub-catalog-artifacts')
)

$ErrorActionPreference = 'Stop'
$upstreamCommit = '6d97c9c09823050c293eef0e740f24dda1499ba3'
$sourcePatchArchive = Join-Path $PSScriptRoot 'aster-im-source.patch.gz'
$stage = Join-Path $env:TEMP "asterhub-aster-im-build-$PID"
$sourcePatch = Join-Path $env:TEMP "asterhub-aster-im-source-$PID.patch"
$stageFullPath = [System.IO.Path]::GetFullPath($stage)
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if (-not $stageFullPath.StartsWith("$tempRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)
  -or -not $output.StartsWith("$tempRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Aster IM staging and output must stay inside the system temporary directory.'
}
if (-not (Test-Path -LiteralPath $sourcePatchArchive)) { throw "Aster IM source patch is missing: $sourcePatchArchive" }
if (Test-Path -LiteralPath $stageFullPath) { Remove-Item -LiteralPath $stageFullPath -Recurse -Force }
New-Item -ItemType Directory -Path $output -Force | Out-Null

try {
  $compressedPatch = [System.IO.File]::OpenRead($sourcePatchArchive)
  $patchOutput = [System.IO.File]::Create($sourcePatch)
  $patchGzip = [System.IO.Compression.GzipStream]::new($compressedPatch, [System.IO.Compression.CompressionMode]::Decompress)
  try { $patchGzip.CopyTo($patchOutput) }
  finally { $patchGzip.Dispose(); $patchOutput.Dispose(); $compressedPatch.Dispose() }

  git clone --quiet --no-checkout --filter=blob:none https://github.com/xmanrui/dsh-im.git $stageFullPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not clone the pinned Aster IM upstream source.' }
  git -C $stageFullPath checkout --quiet --detach $upstreamCommit
  if ($LASTEXITCODE -ne 0) { throw 'Could not check out the pinned Aster IM source revision.' }
  git -C $stageFullPath apply --check $sourcePatch
  if ($LASTEXITCODE -ne 0) { throw 'The Aster IM source patch no longer applies cleanly.' }
  git -C $stageFullPath apply $sourcePatch
  if ($LASTEXITCODE -ne 0) { throw 'Could not apply the Aster IM source patch.' }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'aster-im-policy-check.mjs') -Destination (Join-Path $stageFullPath 'test\aster-im-policy-check.mjs')

  Push-Location $stageFullPath
  try {
    npm ci --ignore-scripts --no-audit --no-fund --omit=optional
    if ($LASTEXITCODE -ne 0) { throw 'Aster IM dependency installation failed.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Aster IM Client/Host build failed.' }
    node --test test/aster-im-policy-check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Aster IM model-routing policy checks failed.' }
    npm pack --ignore-scripts --silent --pack-destination $output
    if ($LASTEXITCODE -ne 0) { throw 'Aster IM package creation failed.' }
  }
  finally { Pop-Location }
  Get-Item -LiteralPath (Join-Path $output 'asterhub-aster-im-4.32.0.tgz') | Select-Object FullName, Length
}
finally {
  if (Test-Path -LiteralPath $sourcePatch) { Remove-Item -LiteralPath $sourcePatch -Force }
  if (Test-Path -LiteralPath $stageFullPath) { Remove-Item -LiteralPath $stageFullPath -Recurse -Force }
}
