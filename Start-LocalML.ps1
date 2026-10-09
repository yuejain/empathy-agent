$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv-ml\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run Setup-LocalML.ps1 first.' }
if (-not (Test-Path -LiteralPath 'models\local\emotion-head.joblib')) { throw 'Run Train-LocalML.ps1 first.' }
$health = $null
try { $health = Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 2 } catch {}
if ($health.ok -and $health.classifier -and $health.role -eq 'emotion-rag' -and $health.api_version -eq 2) { Write-Host 'Local emotion RAG is already available on port 3001.'; exit 0 }
if ($health.ok -and $health.classifier) { throw 'An older local model service is running. Run Stop-LocalML.ps1, then Start-LocalML.ps1 to switch to emotion RAG.' }
$entry = Join-Path $PSScriptRoot 'ml\serve.py'
$process = Start-Process -FilePath $python -ArgumentList @('-u', $entry) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'local-ml.log') -RedirectStandardError (Join-Path $PSScriptRoot 'local-ml-error.log') -PassThru
$process.Id | Set-Content (Join-Path $PSScriptRoot 'local-ml.pid')
Write-Host "Local ML starting in background, PID $($process.Id). Log: local-ml.log"
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw 'Local ML exited. Check local-ml-error.log.' }
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:3001/health' -TimeoutSec 1
        if ($health.ok -and $health.classifier -and $health.role -eq 'emotion-rag' -and $health.api_version -eq 2) { Write-Host 'Local emotion RAG is ready.'; exit 0 }
    } catch {}
}
throw 'Local ML did not become ready. Check local-ml-error.log.'
