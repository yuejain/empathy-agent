$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js 22.9 或更新版本。' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
}
if ([IO.File]::ReadAllText((Join-Path $PSScriptRoot '.env')) -match '(?m)^LOCAL_ML_URL=http://(127\.0\.0\.1|localhost):3001\s*$') {
    & (Join-Path $PSScriptRoot 'Start-LocalML.ps1')
}
& npm.cmd run dev
if ($LASTEXITCODE -ne 0) { throw '服务启动失败，请查看上面的提示。' }
