$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv-ml\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run Setup-LocalML.ps1 first.' }
foreach ($script in @('ml/download_corpus_snapshot.py','ml/corpus.py','ml/download_models.py','ml/train_classifier.py','ml/train_generator.py')) {
    & $python -u $script
    if ($LASTEXITCODE -ne 0) { throw "Failed: $script" }
}
Write-Host 'Training complete. Reports: data/reports. Start service: Start-LocalML.ps1'
