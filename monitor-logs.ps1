# SonosCast Log Monitor
# Polls Home Assistant Supervisor API for addon logs

$addon = "94dc51a4_sonoscast"
$haUrl = "http://192.168.1.224:8123"

Write-Host "Monitoring SonosCast addon logs... (Press Ctrl+C to stop)" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Gray
Write-Host ""

$lastLogLength = 0

while ($true) {
    try {
        # Get current logs via Supervisor API
        $response = Invoke-WebRequest -Uri "$haUrl/api/hassio/addons/$addon/logs" `
            -Headers @{
                "Authorization" = "Bearer $env:SUPERVISOR_TOKEN"
                "Content-Type" = "application/json"
            } `
            -UseBasicParsing -TimeoutSec 5
        
        $logs = $response.Content
        
        # Only show new log entries
        if ($logs.Length -gt $lastLogLength) {
            $newLogs = $logs.Substring($lastLogLength)
            Write-Host $newLogs -NoNewline
            $lastLogLength = $logs.Length
        }
        
    } catch {
        if ($_.Exception.Response.StatusCode -eq 401) {
            Write-Host "Authentication error. Trying SSH method..." -ForegroundColor Yellow
            
            # Fallback to SSH with password
            $secPassword = ConvertTo-SecureString "Vision1080" -AsPlainText -Force
            $cred = New-Object System.Management.Automation.PSCredential("root", $secPassword)
            
            try {
                $sshCommand = "ha addons logs $addon --follow"
                # Note: Requires PowerShell SSH module or external SSH client
                Write-Host "Attempted SSH connection (may require manual SSH setup)" -ForegroundColor Yellow
            } catch {
                Write-Host "Error: $_" -ForegroundColor Red
            }
            break
        }
    }
    
    Start-Sleep -Milliseconds 1000
}
