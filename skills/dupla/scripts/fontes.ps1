# Sem argumentos: lista. -Arquivo destina-se a testes isolados. Somente pedido do usuário libera fonte.
param(
  [ValidateSet('listar', 'travar', 'liberar')][string]$Acao = 'listar',
  [ValidateSet('claude-max', 'chatgpt', 'anthropic-api', 'antigravity', 'openrouter')][string]$Fonte,
  [string]$Arquivo = '',
  [switch]$Json
)
try { . ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'fontes-comum.ps1') -ErrorAction Stop).Path) }
catch { throw 'Controle de fontes indisponivel; consumo bloqueado.' }
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$codigo = 0
try {
  if ($Acao -ne 'listar' -and -not $Fonte) { throw 'Informe -Fonte para travar ou liberar.' }
  $estado = if ($Acao -eq 'listar') { Get-EstadoFontes $Arquivo } else { Set-EstadoFonte $Acao $Fonte $Arquivo }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  $estado = Get-EstadoFontes $Arquivo
  $codigo = 3
}
if (-not $estado.valido) { $codigo = 3 }
if ($Json) { $estado | ConvertTo-Json -Depth 4 -Compress }
else {
  foreach ($aviso in $estado.avisos) { Write-Output $aviso }
  foreach ($id in @(Get-IdsFontes)) { '{0}: {1}' -f $id, $(if ($estado.bloqueadas -ccontains $id) { 'travada' } else { 'liberada' }) }
}
exit $codigo
