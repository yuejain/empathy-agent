$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'local-ml.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No local ML PID file.'; exit 0 }
$mlId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$mlId)) { throw 'Invalid PID file.' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $mlId" -ErrorAction SilentlyContinue
$entry = Join-Path $PSScriptRoot 'ml\serve.py'
if ($process) {
    if ($process.Name -ne 'python.exe' -or -not $process.CommandLine.Contains($entry)) { throw 'PID does not belong to this local ML service.' }
    Stop-Process -Id $mlId
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Local ML stopped.'
