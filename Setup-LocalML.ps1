$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv-ml\Scripts\python.exe')) {
    & python -m venv .venv-ml
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required.' }
}
$python = Join-Path $PSScriptRoot '.venv-ml\Scripts\python.exe'
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip installation failed.' }
& $python -m pip install 'torch==2.11.0' --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw 'CUDA torch installation failed. See docs/LOCAL_ML.md for the hash-verified mirror.' }
& $python -m pip install -r ml/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'ML dependency installation failed.' }
& $python -c "import torch; print('CUDA available:', torch.cuda.is_available())"
