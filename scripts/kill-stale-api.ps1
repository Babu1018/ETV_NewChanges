# End stuck ASR API / Python workers on port 8000 (run before start-api.ps1)
$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
    if ($c.OwningProcess) {
        Write-Host "Stopping PID $($c.OwningProcess) on port 8000"
        Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "Done. From back_end run: .\scripts\start-api.ps1"
Write-Host "Or from ETV run: .\scripts\start-api.ps1"
