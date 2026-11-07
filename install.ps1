# Installs Folkbranch on Windows, with no Docker and nothing else set up first. Safe to run again.
#   irm https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.ps1 | iex
# Another port or folder: set $env:FOLKBRANCH_PORT or $env:FOLKBRANCH_DIR first.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NodeVersion = '24.22.2'
$Dir = if ($env:FOLKBRANCH_DIR) { $env:FOLKBRANCH_DIR } else { Join-Path $HOME 'folkbranch' }
$Port = if ($env:FOLKBRANCH_PORT) { $env:FOLKBRANCH_PORT } else { '3000' }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$Url = if ($env:FOLKBRANCH_BUNDLE) { $env:FOLKBRANCH_BUNDLE } else { "https://github.com/danarkhipov/folkbranch/releases/latest/download/folkbranch-win32-$Arch.zip" }

if (Test-Path (Join-Path $Dir 'docker-compose.yml')) {
  if (-not (Test-Path (Join-Path $Dir '.local'))) { throw "$Dir holds a Docker install. To move: download a full copy under Settings, install into another folder, and restore it there." }
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Set-Location $Dir

$Temp = Join-Path ([IO.Path]::GetTempPath()) ("folkbranch-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
  Write-Host 'Getting the app.'
  $Zip = Join-Path $Temp 'bundle.zip'
  if (Test-Path $Url) { Copy-Item $Url $Zip; Copy-Item "$Url.sha256" "$Zip.sha256" }
  else { Invoke-WebRequest $Url -OutFile $Zip; Invoke-WebRequest "$Url.sha256" -OutFile "$Zip.sha256" }
  $Want = ((Get-Content "$Zip.sha256" -Raw).Trim() -split '\s+')[0]
  if ((Get-FileHash $Zip -Algorithm SHA256).Hash.ToLower() -ne $Want.ToLower()) { throw 'The download is damaged: its checksum does not match. Run this again.' }

  $Fresh = -not (Test-Path .env)
  if ($Fresh) {
    function Random-Text($n) { -join ((48..57 + 65..90 + 97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
    @(
      "BETTER_AUTH_URL=http://localhost:$Port",
      "BETTER_AUTH_SECRET=$(Random-Text 48)",
      "SETUP_TOKEN=$(Random-Text 24)",
      "RECOVERY_TOKEN=$(Random-Text 32)",
      "PORT=$Port",
      'BIND=127.0.0.1'
    ) | Set-Content -Encoding ascii .env
    # Only this user reads the keys.
    icacls .env /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
  }

  $Installed = if (Test-Path app\.sha256) { (Get-Content app\.sha256 -Raw).Trim() } else { '' }
  if ($Installed -ne $Want) {
    if (Test-Path app.new) { Remove-Item app.new -Recurse -Force }
    Expand-Archive $Zip app.new
    $Inner = Get-ChildItem app.new -Directory | Select-Object -First 1
    Set-Content -Encoding ascii (Join-Path $Inner.FullName '.sha256') $Want
    if (-not (Test-Path runtime\node.exe)) {
      $Own = Get-Command node -ErrorAction SilentlyContinue
      $Fits = $false
      if ($Own) {
        Push-Location $Inner.FullName
        & $Own.Source -e "if (+process.versions.node.split('.')[0] < 24) process.exit(1); require('better-sqlite3'); require('sharp')" 2>$null
        $Fits = $LASTEXITCODE -eq 0
        Pop-Location
      }
      if (-not $Fits) {
        Write-Host "Getting Node $NodeVersion, kept inside this folder."
        $Base = "node-v$NodeVersion-win-$Arch"
        $NodeZip = Join-Path $Temp 'node.zip'
        Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$Base.zip" -OutFile $NodeZip
        $Sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
        $Line = ($Sums -split "`n") | Where-Object { $_ -match "  $Base\.zip$" }
        if ((Get-FileHash $NodeZip -Algorithm SHA256).Hash.ToLower() -ne ($Line -split '\s+')[0].ToLower()) { throw 'The Node download is damaged: its checksum does not match. Run this again.' }
        Expand-Archive $NodeZip (Join-Path $Temp 'node')
        New-Item -ItemType Directory -Force -Path runtime | Out-Null
        Copy-Item (Join-Path $Temp "node\$Base\node.exe") runtime\node.exe
      }
    }
    if (Test-Path folkbranch.cmd) { & .\folkbranch.cmd stop | Out-Null }
    if (Test-Path app) { Remove-Item app -Recurse -Force }
    Move-Item $Inner.FullName app
    Remove-Item app.new -Recurse -Force
    Copy-Item app\folkbranch.ps1 . -Force
    Copy-Item app\folkbranch.cmd . -Force
    Set-Content -Encoding ascii .local ''
  }
  & .\folkbranch.cmd start
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  $Conf = @{}; Get-Content .env | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $Conf[$Matches[1]] = $Matches[2] } }
  if ((& .\folkbranch.cmd doctor) -match '^Users:   0') {
    $Link = "$($Conf.BETTER_AUTH_URL)/setup?code=$($Conf.SETUP_TOKEN)"
    Write-Host "`nReady. Open this address and create your family:`n`n  $Link`n"
    if (-not ($env:FOLKBRANCH_NO_OPEN -or $env:CI)) { Start-Process $Link }
  } else {
    Write-Host "`nRunning at $($Conf.BETTER_AUTH_URL)`n"
  }
  Write-Host "Open it again later:  cd $Dir; .\folkbranch open"
} finally {
  Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
