# Runs Folkbranch on Windows: start, stop, restart, status, logs, open, connect, and the server commands (./folkbranch help).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Get-Content .env | ForEach-Object { if ($_ -match '^([A-Za-z0-9_]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] } }
if (-not $env:PORT) { $env:PORT = '3000' }
if (-not $env:BIND) { $env:BIND = '127.0.0.1' }
$env:DATA_DIR = Join-Path $PSScriptRoot 'data'
$env:NODE_ENV = 'production'
$env:HOSTNAME = $env:BIND
$Node = if (Test-Path runtime\node.exe) { (Resolve-Path runtime\node.exe).Path } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $Node) { Write-Host 'Node is gone from this computer. Run the install command again: it brings its own.'; exit 1 }

function Test-Running {
  if (-not (Test-Path folkbranch.pid)) { return $false }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$(Get-Content folkbranch.pid)" -ErrorAction SilentlyContinue
  return [bool]($p -and $p.CommandLine -match 'folkbranch\.ps1.*_run')
}
function Test-Port { (Test-NetConnection 127.0.0.1 -Port $env:PORT -WarningAction SilentlyContinue -InformationLevel Quiet) }
function Stop-App {
  if (Test-Running) {
    $id = [int](Get-Content folkbranch.pid)
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Write-Host 'Stopped.'
  } else { Write-Host 'Not running.' }
  Remove-Item folkbranch.pid -ErrorAction SilentlyContinue
}
function Start-App {
  if (Test-Running) { Write-Host "Running at $env:BETTER_AUTH_URL"; return }
  if (Test-Port) { Write-Host "Port $env:PORT is in use by another program. Stop that program, or install again with `$env:FOLKBRANCH_PORT set."; exit 1 }
  New-Item -ItemType Directory -Force -Path data, logs | Out-Null
  $p = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '_run'
  Set-Content -Encoding ascii folkbranch.pid $p.Id
  Write-Host -NoNewline 'Waiting for the app'
  for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest "http://127.0.0.1:$env:PORT/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { Write-Host "`nRunning at $env:BETTER_AUTH_URL"; return } } catch {}
    Write-Host -NoNewline '.'
    Start-Sleep 1
  }
  Write-Host "`nIt did not start. The end of logs\folkbranch.log:"
  Get-Content logs\folkbranch.log -Tail 15
  Stop-App
  exit 1
}

switch ($args[0]) {
  # Restoring a copy ends the process and counts on something to start it again. So does a crash, up to a point.
  '_run' {
    $fails = 0
    while ($true) {
      $began = Get-Date
      Push-Location app
      & $Node server.js *>> ..\logs\folkbranch.log
      $code = $LASTEXITCODE
      Pop-Location
      if ($code -eq 0) { exit 0 }
      if (((Get-Date) - $began).TotalSeconds -lt 10) { $fails++ } else { $fails = 0 }
      if ($fails -ge 5) { Add-Content logs\folkbranch.log 'Stopped restarting: the app failed 5 times in a row.'; exit 1 }
      Start-Sleep 1
    }
  }
  'start' { Start-App; exit 0 }
  'stop' { Stop-App; exit 0 }
  'restart' { Stop-App; Start-App; exit 0 }
  'status' { if (Test-Running) { Write-Host "Running at $env:BETTER_AUTH_URL"; Write-Host "Data: $env:DATA_DIR"; exit 0 } else { Write-Host 'Stopped. Start it with: .\folkbranch start'; exit 1 } }
  'logs' { Get-Content logs\folkbranch.log -Tail 100; exit 0 }
  'open' {
    Start-App
    if ((& $Node app\folkbranch.mjs doctor) -match '^Users:   0') { $url = "$env:BETTER_AUTH_URL/setup?code=$env:SETUP_TOKEN" }
    else { $url = ((& $Node app\folkbranch.mjs login-link --now) | Where-Object { $_ -match '^\s*http' }).Trim() }
    if ($env:FOLKBRANCH_NO_OPEN -or $env:CI) { Write-Host "Open this address. A sign-in link works once:`n`n  $url" } else { Start-Process $url; Write-Host 'Opened in your browser.' }
    exit 0
  }
  'connect' {
    Start-App | Out-Null
    $out = & $Node app\folkbranch.mjs token create --name "agent-$env:COMPUTERNAME" --role editor --json | ConvertFrom-Json
    $done = @()
    if (Get-Command claude -ErrorAction SilentlyContinue) { claude mcp add --scope user --transport http folkbranch $out.url --header "Authorization: Bearer $($out.token)"; $done += 'Claude Code' }
    if (Get-Command codex -ErrorAction SilentlyContinue) { codex mcp add folkbranch --url $out.url --bearer-token-env-var FOLKBRANCH_TOKEN; $done += 'Codex'; Write-Host "Codex reads the key from your environment. Set FOLKBRANCH_TOKEN to $($out.token)" }
    if ($done) { Write-Host "Connected: $($done -join ', '). Edits wait for your review in the app." } else { Write-Host "No Claude Code or Codex here. The app shows how to connect others: Settings > Agents and MCP.`nAddress: $($out.url)`nKey: $($out.token)" }
    exit 0
  }
  default { & $Node app\folkbranch.mjs @args; exit $LASTEXITCODE }
}
