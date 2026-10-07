$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host '没有记录的后台服务。前台服务请按 Ctrl+C。'; exit 0 }
$serverId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$serverId)) { throw 'PID 文件格式错误。' }
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId" -ErrorAction SilentlyContinue
$expectedScript = Join-Path $PSScriptRoot 'dist\server\index.js'
if ($serverProcess) {
    if ($serverProcess.Name -ne 'node.exe' -or -not $serverProcess.CommandLine.Contains($expectedScript)) { throw 'PID 对应的不是本项目服务，未停止任何进程。' }
    Stop-Process -Id $serverId
}
Remove-Item -LiteralPath $pidFile
Write-Host '本项目后台服务已停止。'
