param(
  [ValidateSet('start', 'restart', 'status', 'watchdog')]
  [string]$Mode = 'start'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $projectRoot 'backend'
$frontendDirectory = Join-Path $projectRoot 'frontend'
$logDirectory = Join-Path $projectRoot '.host-logs'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Test-Endpoint {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-PortOwner {
  param([int]$Port)
  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($connection) { return [int]$connection.OwningProcess }
  return 0
}

function Stop-PortProcess {
  param([int]$Port)
  $ownerProcessId = Get-PortOwner -Port $Port
  if ($ownerProcessId -gt 0) {
    Stop-Process -Id $ownerProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-Backend {
  Start-Process -FilePath $nodeExecutable `
    -ArgumentList 'src/server.js' `
    -WorkingDirectory $backendDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'backend.out.log') `
    -RedirectStandardError (Join-Path $logDirectory 'backend.error.log')
}

function Start-Frontend {
  Start-Process -FilePath $nodeExecutable `
    -ArgumentList '..\node_modules\serve\build\main.js', '-s', 'dist', '-l', '5173' `
    -WorkingDirectory $frontendDirectory `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'frontend.out.log') `
    -RedirectStandardError (Join-Path $logDirectory 'frontend.error.log')
}

function Wait-ForEndpoint {
  param([string]$Url)
  foreach ($attempt in 1..15) {
    if (Test-Endpoint -Url $Url) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

$backendUrl = 'http://127.0.0.1:3001/api/health'
$frontendUrl = 'http://127.0.0.1:5173/'

function Ensure-Host {
  if (-not (Test-Endpoint -Url $backendUrl)) {
    Stop-PortProcess -Port 3001
    Start-Backend
  }

  if (-not (Test-Endpoint -Url $frontendUrl)) {
    Stop-PortProcess -Port 5173
    Start-Frontend
  }

  $backendReady = Wait-ForEndpoint -Url $backendUrl
  $frontendReady = Wait-ForEndpoint -Url $frontendUrl

  return [pscustomobject]@{
    Backend = $backendReady
    Frontend = $frontendReady
  }
}

if ($Mode -eq 'status') {
  Write-Output "backend=$([int](Test-Endpoint -Url $backendUrl))"
  Write-Output "frontend=$([int](Test-Endpoint -Url $frontendUrl))"
  exit 0
}

if ($Mode -eq 'restart') {
  Stop-PortProcess -Port 3001
  Stop-PortProcess -Port 5173
  Start-Sleep -Seconds 1
}

if ($Mode -eq 'watchdog') {
  $watchdogMutex = New-Object System.Threading.Mutex($false, 'Local\LeadHunterHostWatchdog')
  if (-not $watchdogMutex.WaitOne(0)) { exit 0 }
  while ($true) {
    try {
      Ensure-Host | Out-Null
    } catch {
      Add-Content -LiteralPath (Join-Path $logDirectory 'watchdog.error.log') -Value "$(Get-Date -Format o) $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 30
  }
}

$hostState = Ensure-Host

Write-Output "backend=$([int]$hostState.Backend)"
Write-Output "frontend=$([int]$hostState.Frontend)"

if (-not $hostState.Backend -or -not $hostState.Frontend) { exit 1 }
exit 0
