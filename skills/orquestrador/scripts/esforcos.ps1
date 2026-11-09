# Mostra ou troca o perfil de esforco da orquestracao (usuário, 2026-11-07).
# Uso: powershell -ExecutionPolicy Bypass -File esforcos.ps1 [-Status | -Sobe | -Desce | -Perfil economia|folga] [-SemCommit]
#   -Sobe/-Desce: um degrau na ordem do perfis-esforco.json (de baixo para cima); nas pontas nao muda. Perfil personalizado: recusa.
#   sem -Perfil : mostra os esforcos em vigor e qual perfil eles batem.
#   -Perfil     : grava o perfil em politica-modelos.json, roda os testes da dupla e, se passarem,
#                 commit e push so desse arquivo (regra de Git do usuário). Teste que falha desfaz a troca.
#   -SemCommit  : troca e testa, sem commit nem push (para ensaio).
# Propagacao: o plugin orquestra (rotear_tarefa), o mod gemeo e os scripts da dupla releem o JSON a cada
# chamada, entao as sessoes abertas passam a usar o perfil novo na proxima fatia, sem reiniciar.
#   -ArquivoPolitica : so para teste: troca uma copia, sem rodar os testes da dupla nem commit.
param([string]$Perfil = '', [switch]$Sobe, [switch]$Desce, [switch]$Status, [switch]$SemCommit, [string]$ArquivoPolitica = '')
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$arqPolitica = if ($ArquivoPolitica) { $ArquivoPolitica } else { Join-Path $raiz 'politica-modelos.json' }
$perfis = Get-Content -LiteralPath (Join-Path $raiz 'perfis-esforco.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nomes = @($perfis.PSObject.Properties.Name | Where-Object { $_ -notlike '_*' })
$utf8 = New-Object Text.UTF8Encoding($false)

function Get-Vigente {
  $p = Get-Content -LiteralPath $arqPolitica -Raw -Encoding UTF8 | ConvertFrom-Json
  [ordered]@{
    N1 = @($p.capacidades.N1.esforco, $p.capacidades.N1.escalado)
    N2 = @($p.capacidades.N2.esforco, $p.capacidades.N2.escalado)
    N3 = @($p.capacidades.N3.esforco, $p.capacidades.N3.escalado)
    L1 = $p.revisao.L1; L2 = $p.revisao.L2
    codeReview = @($p.codeReview.comum, $p.codeReview.riscoElevado)
  }
}
function Get-PerfilDe($v) {
  foreach ($n in $nomes) {
    $x = $perfis.$n
    if ((($x.N1 -join ',') -eq ($v.N1 -join ',')) -and (($x.N2 -join ',') -eq ($v.N2 -join ',')) -and
      (($x.N3 -join ',') -eq ($v.N3 -join ',')) -and $x.L1 -eq $v.L1 -and $x.L2 -eq $v.L2 -and
      (($x.codeReview -join ',') -eq ($v.codeReview -join ','))) { return $n }
  }
  'personalizado'
}
function Show-Vigente {
  $v = Get-Vigente
  Write-Output "perfil em vigor: $(Get-PerfilDe $v)"
  foreach ($n in 'N1', 'N2', 'N3') { Write-Output ("  {0}: {1} (escalado {2})" -f $n, $v[$n][0], $v[$n][1]) }
  Write-Output "  revisao: L1 $($v.L1), L2 $($v.L2)"
  Write-Output "  /code-review: comum $($v.codeReview[0]), risco elevado $($v.codeReview[1])"
  Write-Output "perfis: $($nomes -join ', ')"
}

if ($Status -or (-not $Perfil -and -not $Sobe -and -not $Desce)) { Show-Vigente; exit 0 }
if ($Sobe -or $Desce) {
  $atual = Get-PerfilDe (Get-Vigente)
  $i = [array]::IndexOf($nomes, $atual)
  if ($i -lt 0) { Write-Output "perfil atual e '$atual': use -Perfil <nome> (ha: $($nomes -join ', '))"; exit 2 }
  $j = if ($Sobe) { $i + 1 } else { $i - 1 }
  if ($j -lt 0 -or $j -ge $nomes.Count) { Show-Vigente; Write-Output "ja esta no $(if ($Sobe) { 'topo' } else { 'piso' }) da escada; nada a fazer"; exit 0 }
  $Perfil = $nomes[$j]
}
if ($Perfil -notin $nomes) { Write-Output "perfil desconhecido: $Perfil (ha: $($nomes -join ', '))"; exit 2 }

$x = $perfis.$Perfil
$original = [IO.File]::ReadAllText($arqPolitica)
$texto = $original
# Troca so os valores, preservando o formato do arquivo; cada padrao tem de casar uma vez.
$trocas = @(
  @('("N1": \{ "ordem": 1, "esforco": ")[a-z]+(", "escalado": ")[a-z]+', "`${1}$($x.N1[0])`${2}$($x.N1[1])"),
  @('("N2": \{ "ordem": 2, "esforco": ")[a-z]+(", "escalado": ")[a-z]+', "`${1}$($x.N2[0])`${2}$($x.N2[1])"),
  @('("N3": \{ "ordem": 3, "esforco": ")[a-z]+(", "escalado": ")[a-z]+', "`${1}$($x.N3[0])`${2}$($x.N3[1])"),
  @('("L1": ")[a-z]+(", "L2": ")[a-z]+', "`${1}$($x.L1)`${2}$($x.L2)"),
  @('("comum": ")[a-z]+(", "riscoElevado": ")[a-z]+', "`${1}$($x.codeReview[0])`${2}$($x.codeReview[1])")
)
foreach ($t in $trocas) {
  if ([regex]::Matches($texto, $t[0]).Count -ne 1) { Write-Output "politica-modelos.json fora do formato esperado ($($t[0])); nada gravado"; exit 1 }
  $texto = [regex]::Replace($texto, $t[0], $t[1])
}
if ($texto -eq $original) { Show-Vigente; Write-Output 'ja estava neste perfil; nada a fazer'; exit 0 }
[IO.File]::WriteAllText($arqPolitica, $texto, $utf8)
if ($ArquivoPolitica) { Show-Vigente; Write-Output 'copia de teste trocada (sem testes nem commit)'; exit 0 }

$scripts = Join-Path (Split-Path $raiz -Parent) 'dupla\scripts'
foreach ($teste in 'testar-politica-modelos.ps1', 'testar-reservas-revisao.ps1') {
  $saida = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts $teste) 2>&1
  if ($LASTEXITCODE -ne 0) {
    [IO.File]::WriteAllText($arqPolitica, $original, $utf8)
    Write-Output "teste $teste falhou; troca desfeita:"; $saida | Select-Object -Last 8 | Write-Output; exit 1
  }
  Write-Output "$teste : $(@($saida)[-1])"
}
Show-Vigente
if ($SemCommit) { Write-Output 'sem commit (-SemCommit)'; exit 0 }
$repo = Split-Path $raiz -Parent
& git -C $repo add -- 'orquestrador/politica-modelos.json'
# Pathspec no commit: arquivo que outra sessao deixou staged fica fora.
& git -C $repo commit -q -m "orquestrador: perfil de esforco $Perfil" -m "Trocado por scripts/esforcos.ps1 a pedido do usuário." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- 'orquestrador/politica-modelos.json'
if ($LASTEXITCODE -ne 0) { Write-Output 'commit falhou; o arquivo ficou trocado, sem commit'; exit 1 }
& git -C $repo push -q
if ($LASTEXITCODE -ne 0) { Write-Output 'push falhou; commit local feito'; exit 1 }
Write-Output "commit e push feitos: $(& git -C $repo log --oneline -1)"
