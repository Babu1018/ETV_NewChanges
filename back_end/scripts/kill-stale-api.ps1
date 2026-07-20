# End stuck ASR API on port 8000 (run from back_end: .\scripts\kill-stale-api.ps1)
$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    if ($c.OwningProcess) {
        Write-Host "Stopping PID $($c.OwningProcess) on port 8000"
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 2
Write-Host "Done. Next: .\scripts\start-api.ps1"
