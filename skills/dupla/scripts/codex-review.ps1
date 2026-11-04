# Nome antigo: o Codex CLI saiu (usuário, 2026-10-24) e a camada virou gpt-review.ps1 (GPT-Astra pelo OpenCode). Mesmos argumentos.
Write-Output 'codex-review.ps1 virou gpt-review.ps1: use o novo (chamando-o agora com os mesmos argumentos)'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') @args; exit $LASTEXITCODE
