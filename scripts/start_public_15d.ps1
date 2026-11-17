<#
.SYNOPSIS
    Launches the RoV SOTA Draft API + Frontend and Cloudflare Tunnel with auto-restart
    for long-running public testing (e.g. 15-day trials).

.USAGE
    powershell -ExecutionPolicy Bypass -File scripts/start_public_15d.ps1
    # Optional fixed URL with Cloudflare Named Tunnel token:
    # $env:CLOUDFLARE_TUNNEL_TOKEN = "<your-tunnel-token>"
    # powershell -ExecutionPolicy Bypass -File scripts/start_public_15d.ps1
#>

param(
    [int]$Port = 8000,
    [string]$BindHost = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$CloudflaredExe = (Get-Command cloudflared -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
if (-not $CloudflaredExe) {
    if (Test-Path "C:\Program Files (x86)\cloudflared\cloudflared.exe") {
        $CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    } else {
        $CloudflaredExe = "C:\Program Files\cloudflared\cloudflared.exe"
    }
}
if (-not (Test-Path $CloudflaredExe)) {
    throw "cloudflared.exe not found. Install via: winget install --id Cloudflare.cloudflared"
}

$env:ROV_ENV = "production"
$ProdIndex = Join-Path $RepoRoot "frontend\dist-prod\index.html"
if (-not (Test-Path $ProdIndex)) {
    throw "Production frontend bundle not found at $ProdIndex. Run npm run build:prod in frontend/ first."
}

$LogDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$ApiOutLog = Join-Path $LogDir "public_api.out.log"
$ApiErrLog = Join-Path $LogDir "public_api.err.log"
$TunnelOutLog = Join-Path $LogDir "public_tunnel.out.log"
$TunnelErrLog = Join-Path $LogDir "public_tunnel.err.log"

Write-Host "[RoV 15-Day Runner] Repo: $RepoRoot" -ForegroundColor Cyan
Write-Host "[RoV 15-Day Runner] DB:   $RepoRoot\data\rov_app.db" -ForegroundColor Cyan
Write-Host "[RoV 15-Day Runner] Tip:  Disable Sleep on AC power so Windows stays online (powercfg /change standby-timeout-ac 0)" -ForegroundColor Yellow

$apiProc = $null
$tunnelProc = $null

function Start-ApiProcess {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting uvicorn on ${BindHost}:${Port}..." -ForegroundColor Green
    return Start-Process -FilePath "uvicorn" `
        -ArgumentList @("src.api:app", "--host", $BindHost, "--port", "$Port", "--no-server-header") `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $ApiOutLog `
        -RedirectStandardError $ApiErrLog `
        -PassThru `
        -NoNewWindow
}

function Start-TunnelProcess {
    $NamedConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
    if ($env:CLOUDFLARE_TUNNEL_TOKEN) {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Cloudflare Named Tunnel (Token)..." -ForegroundColor Green
        $env:TUNNEL_TOKEN = $env:CLOUDFLARE_TUNNEL_TOKEN
        $args = @("tunnel", "--no-autoupdate", "run")
    } elseif (Test-Path $NamedConfig) {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Cloudflare Named Tunnel (minidraft -> https://minidraft.app)..." -ForegroundColor Green
        $args = @("tunnel", "--no-autoupdate", "run", "minidraft")
    } else {
        Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting Cloudflare Quick Tunnel -> http://${BindHost}:${Port}" -ForegroundColor Green
        $args = @("tunnel", "--no-autoupdate", "--url", "http://${BindHost}:${Port}")
    }
    return Start-Process -FilePath $CloudflaredExe `
        -ArgumentList $args `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $TunnelOutLog `
        -RedirectStandardError $TunnelErrLog `
        -PassThru `
        -NoNewWindow
}

$lastPrintedUrl = ""

try {
    $apiProc = Start-ApiProcess
    Start-Sleep -Seconds 3
    $tunnelProc = Start-TunnelProcess

    while ($true) {
        Start-Sleep -Seconds 5

        if ($apiProc.HasExited) {
            Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] uvicorn exited (code $($apiProc.ExitCode)). Restarting in 3s..."
            Start-Sleep -Seconds 3
            $apiProc = Start-ApiProcess
        }

        if ($tunnelProc.HasExited) {
            Write-Warning "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] cloudflared exited (code $($tunnelProc.ExitCode)). Restarting in 5s..."
            Start-Sleep -Seconds 5
            $lastPrintedUrl = ""
            $tunnelProc = Start-TunnelProcess
        }

        if (-not $env:CLOUDFLARE_TUNNEL_TOKEN -and (Test-Path $TunnelErrLog)) {
            $match = Select-String -Path $TunnelErrLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | Select-Object -Last 1
            if ($match -and $match.Matches.Count -gt 0) {
                $url = $match.Matches[$match.Matches.Count - 1].Value
                if ($url -ne $lastPrintedUrl) {
                    $lastPrintedUrl = $url
                    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] LIVE URL: $url" -ForegroundColor Cyan
                }
            }
        }
    }
} finally {
    Write-Host "`n[RoV 15-Day Runner] Stopping child processes..." -ForegroundColor Yellow
    if ($tunnelProc -and -not $tunnelProc.HasExited) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue }
    if ($apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
}
