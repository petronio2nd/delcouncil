# Migracao isolada: nenhum estado real, modelo ou rede e consultado.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fontes-comum.ps1')
$raizMigracao = Join-Path ([IO.Path]::GetTempPath()) ('dupla-migracao-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($raizMigracao)
$perfilAnterior = $env:USERPROFILE; $homeAnterior = $env:HOME; $localAnterior = $env:LOCALAPPDATA
$utf8Migracao = New-Object Text.UTF8Encoding($false)
$casosMigracao = 0
function ConfereMigracao($Valor, [string]$Nome) {
  if (-not $Valor) { throw "FALHOU: $Nome" }
  $script:casosMigracao++
}
function GravaEstadoMigracao([string]$Caminho, [string]$Texto) {
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $Caminho))
  [IO.File]::WriteAllText($Caminho, $Texto, $utf8Migracao)
}
try {
  $env:USERPROFILE = Join-Path $raizMigracao 'perfil'
  $env:HOME = Join-Path $raizMigracao 'home-alternativo'
  $normal = Join-Path $env:USERPROFILE 'AppData/Local'
  $pacote = Join-Path $normal 'Packages/Claude_pacote-teste/LocalCache/Local'
  $env:LOCALAPPDATA = $normal
  $canonical = Get-ArquivoFontes
  $legadoNormal = Join-Path $normal 'dupla/fontes.json'
  $legadoPacote = Join-Path $pacote 'dupla/fontes.json'
  GravaEstadoMigracao $legadoNormal '{"versao":1,"bloqueadas":["openrouter"]}'
  GravaEstadoMigracao $legadoPacote '{"versao":1,"bloqueadas":["claude-max"]}'
  $antesNormal = [IO.File]::ReadAllText($legadoNormal); $antesPacote = [IO.File]::ReadAllText($legadoPacote)
  $estadoNormal = Get-EstadoFontes
  $env:LOCALAPPDATA = $pacote
  $estadoPacote = Get-EstadoFontes
  ConfereMigracao ($canonical -eq (Get-ArquivoFontes) -and $canonical -eq [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.local/share/dupla/fontes.json'))) 'canonical independe da virtualizacao LOCALAPPDATA'
  ConfereMigracao ($estadoNormal.valido -and ($estadoNormal.bloqueadas -join ',') -eq 'claude-max,openrouter' -and ($estadoPacote.bloqueadas -join ',') -eq 'claude-max,openrouter') 'normal e pacote leem uniao de travas'
  ConfereMigracao (-not (Test-Path $canonical) -and -not (Test-Path "$canonical.lock")) 'leitura unificada nao grava canonical'
  $isolado = Join-Path $raizMigracao 'isolado.json'
  ConfereMigracao ((Get-EstadoFontes -Arquivo $isolado).bloqueadas.Count -eq 0) 'Arquivo explicito nao importa legados'
  $null = Set-EstadoFonte travar chatgpt $isolado
  ConfereMigracao ((Get-EstadoFontes $isolado).bloqueadas.Count -eq 1 -and -not (Test-Path $canonical)) 'mutacao Arquivo isolado nao toca canonical'
  $importado = Set-EstadoFonte travar claude-max
  ConfereMigracao ($importado.valido -and ($importado.bloqueadas -join ',') -eq 'claude-max,openrouter' -and (Test-Path "$canonical.lock")) 'primeira mutacao idempotente consolida uniao'
  ConfereMigracao ([IO.File]::ReadAllText($legadoNormal) -ceq $antesNormal -and [IO.File]::ReadAllText($legadoPacote) -ceq $antesPacote) 'legados preservados sem sobrescrita'
  $liberado = Set-EstadoFonte liberar claude-max
  ConfereMigracao ($liberado.valido -and ($liberado.bloqueadas -join ',') -eq 'openrouter') 'liberacao apos import nao ressuscita legado'
  $env:LOCALAPPDATA = 'C:relativo'
  GravaEstadoMigracao $legadoPacote '{invalidado depois da consolidacao'
  ConfereMigracao ((Get-EstadoFontes).valido -and ((Get-EstadoFontes).bloqueadas -join ',') -eq 'openrouter') 'canonical autoridade ignora legado e LOCALAPPDATA invalidos'
  [IO.File]::Move($canonical, "$canonical.salvo")
  ConfereMigracao (-not (Get-EstadoFontes).valido) 'canonical perdido com marker nao reimporta'
  $recusou = $false; try { $null = Set-EstadoFonte travar claude-max } catch { $recusou = $true }
  ConfereMigracao ($recusou -and -not (Test-Path $canonical)) 'writer nao recria canonical gerenciado perdido'
  [IO.File]::Move("$canonical.salvo", $canonical)
  foreach ($homeRuim in '', 'relativo', 'C:relativo', '\raiz-relativa') {
    $env:USERPROFILE = $homeRuim; $env:HOME = ''
    ConfereMigracao (-not (Get-EstadoFontes).valido) 'home ausente ou relativo bloqueia'
  }
  $env:USERPROFILE = ''; $env:HOME = Join-Path $raizMigracao 'fallback-home'; $env:LOCALAPPDATA = ''
  ConfereMigracao ((Get-ArquivoFontes) -eq [IO.Path]::GetFullPath((Join-Path $env:HOME '.local/share/dupla/fontes.json'))) 'HOME explicito como fallback'
  foreach ($cenario in 'invalido', 'ilegivel', 'perdido') {
    $env:USERPROFILE = Join-Path $raizMigracao $cenario; $env:HOME = $env:USERPROFILE
    $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData/Local'
    $legado = Join-Path $env:LOCALAPPDATA 'dupla/fontes.json'
    if ($cenario -eq 'invalido') { GravaEstadoMigracao $legado '{' }
    elseif ($cenario -eq 'perdido') { GravaEstadoMigracao "$legado.lock" '' }
    else { GravaEstadoMigracao $legado '{"versao":1,"bloqueadas":["claude-max"]}'; $ocupado = [IO.File]::Open($legado, 'Open', 'ReadWrite', 'None') }
    try { ConfereMigracao (-not (Get-EstadoFontes).valido) "legado $cenario bloqueia leitura inicial" }
    finally { if ($cenario -eq 'ilegivel') { $ocupado.Dispose() } }
  }
  $env:USERPROFILE = Join-Path $raizMigracao 'local-relativo'; $env:HOME = $env:USERPROFILE; $env:LOCALAPPDATA = 'C:relativo'
  ConfereMigracao (-not (Get-EstadoFontes).valido) 'LOCALAPPDATA relativo bloqueia apenas descoberta inicial'
  Write-Output "OK: $casosMigracao casos migracao; PowerShell $($PSVersionTable.PSVersion); $raizMigracao"
} finally { $env:USERPROFILE = $perfilAnterior; $env:HOME = $homeAnterior; $env:LOCALAPPDATA = $localAnterior }
