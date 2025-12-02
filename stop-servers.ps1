# PowerShell script to stop PESUConnect servers
Write-Host "Stopping PESUConnect servers..." -ForegroundColor Yellow
Write-Host ""

# Function to kill process on a port
function Stop-ProcessOnPort {
    param([int]$Port)
    
    $connections = netstat -ano | Select-String ":$Port.*LISTENING"
    if ($connections) {
        foreach ($conn in $connections) {
            $pid = ($conn -split '\s+')[-1]
            if ($pid -match '^\d+$') {
                Write-Host "Killing process $pid on port $Port..." -ForegroundColor Red
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        }
    } else {
        Write-Host "No process found on port $Port" -ForegroundColor Green
    }
}

Stop-ProcessOnPort -Port 5000
Stop-ProcessOnPort -Port 3000

Write-Host ""
Write-Host "Done! Ports should be free now." -ForegroundColor Green

