#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Port = 3000
$ServerScript = "$PSScriptRoot/server/index.js"

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' }
    return $conn
}

function Stop-ProcessOnPort {
    param([int]$Port)
    $conn = Test-PortListening -Port $Port
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[WARN] Port $Port occupied by PID $($proc.Id) ($($proc.ProcessName)), stopping..." -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force
            Start-Sleep -Seconds 2
        }
    }
}

function Start-LocalServer {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] node not found" -ForegroundColor Red
        exit 1
    }

    if (!(Test-Path $ServerScript)) {
        Write-Host "[ERROR] Script not found: $ServerScript" -ForegroundColor Red
        exit 1
    }

    Stop-ProcessOnPort -Port $Port

    Write-Host "[INFO] Starting local server on port $Port..." -ForegroundColor Cyan

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'node'
    $psi.Arguments = $ServerScript
    $psi.WorkingDirectory = $PSScriptRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Seconds 3

    $retry = 0
    $maxRetry = 10
    while ($retry -lt $maxRetry) {
        $conn = Test-PortListening -Port $Port
        if ($conn -and $conn.OwningProcess -eq $proc.Id) {
            Write-Host "[OK] Server started" -ForegroundColor Green
            Write-Host "  API:    http://localhost:$Port/api" -ForegroundColor Green
            Write-Host "  Web:    http://localhost:$Port/" -ForegroundColor Green
            Write-Host "  PID:    $($proc.Id)" -ForegroundColor DarkGray
            Write-Host "  Stop:   Stop-Process -Id $($proc.Id)" -ForegroundColor DarkGray
            return
        }
        Start-Sleep -Milliseconds 500
        $retry++
    }

    $stderr = $proc.StandardError.ReadToEnd()
    $stdout = $proc.StandardOutput.ReadToEnd()
    Write-Host "[ERROR] Server failed to start on port $Port" -ForegroundColor Red
    if ($stdout) { Write-Host "STDOUT:`n$stdout" -ForegroundColor DarkGray }
    if ($stderr) { Write-Host "STDERR:`n$stderr" -ForegroundColor DarkGray }
    exit 1
}

Start-LocalServer
