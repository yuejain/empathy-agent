$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$python = Join-Path $PSScriptRoot '.venv-ml\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run Setup-LocalML.ps1 first.' }
$hasEncoder = Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models\local\encoder')
$hasHead = (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models\local\emotion-head.joblib')) -or (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'models\local\classifiers\active.json'))
if ($hasEncoder -or $hasHead) {
    if (-not ($hasEncoder -and $hasHead)) { throw 'Incomplete local model installation. Inspect models/local before retrying; existing artifacts will not be overwritten.' }
    Write-Host 'Existing model detected. Training a candidate; only the bilingual validation gate may publish it.'
    & $python -u ml/train_classifier.py --candidate
    if ($LASTEXITCODE -ne 0) { throw 'Candidate training failed; the active model was retained.' }
    Write-Host 'Candidate evaluation complete. Check the corpus panel for acceptance or rejection. Rebuild the public index separately if its corpus changed.'
    exit 0
}
foreach ($script in @('ml/download_corpus_snapshot.py','ml/corpus.py','ml/download_models.py','ml/train_classifier.py')) {
    & $python -u $script
    if ($LASTEXITCODE -ne 0) { throw "Failed: $script" }
}
Write-Host 'Emotion RAG training and index complete. Reports: data/reports. Start service: Start-LocalML.ps1'
