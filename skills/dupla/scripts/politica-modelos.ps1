# Funcoes sem rede: a mesma politica e consumida pelos adaptadores dos harness.
$script:politicaModelos = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\orquestrador\politica-modelos.json') -Raw -Encoding UTF8 | ConvertFrom-Json

function Test-FamiliaDoModelo([string]$IdModelo, [string]$FamiliaModelo) {
  $prefixoModelo = if ($FamiliaModelo -in 'haiku','sonnet','opus','fable') { 'claude' } elseif ($FamiliaModelo -in 'luna','terra','sol','astra') { 'gpt' } else { 'gemini' }
  $IdModelo -eq $FamiliaModelo -or
    $IdModelo -match "^$prefixoModelo-(?:\d+(?:[.-]\d+)*-)?$([regex]::Escape($FamiliaModelo))(?:-\d+(?:[.-]\d+)*)?(?:-(?:low|medium|high|xhigh))?$"
}

function Get-CapacidadeModelo([string]$Modelo) {
  $idModelo = (($Modelo -split '/'))[-1] -replace '#.*$', ''
  # Alias conhecidos e identificadores das familias; desconhecido falha fechado.
  foreach ($classe in 'N1', 'N2', 'N3') {
    foreach ($familiaModelo in $script:politicaModelos.capacidades.$classe.familias) {
      if (Test-FamiliaDoModelo $idModelo $familiaModelo) { return $classe }
    }
  }
  # Revisores (Astra, Fable, Argon) tem a capacidade da revisao, mas nao executam (Test-SoRevisao).
  foreach ($familiaModelo in $script:politicaModelos.revisao.familias) {
    if (Test-FamiliaDoModelo $idModelo $familiaModelo) { return $script:politicaModelos.revisao.capacidade }
  }
  throw "Modelo sem classe de capacidade conhecida: $Modelo"
}

# Familia so de revisao e arbitragem (usuário, 2026-11-03): fora de execucao e orquestracao.
function Test-SoRevisao([string]$Modelo) {
  $idModelo = (($Modelo -split '/'))[-1] -replace '#.*$', ''
  foreach ($familiaModelo in $script:politicaModelos.revisao.familias) {
    if (Test-FamiliaDoModelo $idModelo $familiaModelo) { return $true }
  }
  $false
}

function Get-EsforcoModelo {
  param([ValidateSet('N1','N2','N3')][string]$Capacidade,
    [ValidateSet('executor','revisor','arbitro','sessao')][string]$Papel = 'executor',
    [ValidateSet('L0','L1','L2')][string]$Risco = 'L1', [switch]$Escalar,
    [ValidateSet('gpt','claude','gemini','')][string]$Familia = '')
  if ($Papel -in 'revisor','arbitro') {
    if ($Capacidade -ne $script:politicaModelos.revisao.capacidade) { throw 'Revisao e arbitragem exigem N3.' }
    # Mesmo piso para Astra, Fable e Argon (usuário, 2026-11-03); -Familia fica por compatibilidade.
    if ($Risco -eq 'L2' -or $Escalar) { return $script:politicaModelos.revisao.L2 }
    return $script:politicaModelos.revisao.L1
  }
  if ($Escalar) { return $script:politicaModelos.capacidades.$Capacidade.escalado }
  $script:politicaModelos.capacidades.$Capacidade.esforco
}

function Assert-CapacidadeModelo([string]$Modelo, [string]$Minima) {
  $real = Get-CapacidadeModelo $Modelo
  if ($script:politicaModelos.capacidades.$real.ordem -lt $script:politicaModelos.capacidades.$Minima.ordem) {
    throw "Reserva abaixo da capacidade minima $Minima : $Modelo e $real. Escolha outra fonte da mesma capacidade ou superior."
  }
  $real
}

function Write-RotaModelo([string]$Saida, [string]$Modelo, [string]$Esforco, [string]$Minima, [string]$Papel, [string]$EsforcoSelecionado = '') {
  $capacidadeModelo = Assert-CapacidadeModelo $Modelo $Minima
  $rotaModelo = [ordered]@{ politica = $script:politicaModelos.versao; capacidadeMinima = $Minima;
    capacidade = $capacidadeModelo; modeloPedido = $Modelo; esforcoPedido = $Esforco;
    esforcoSelecionado = $(if ($EsforcoSelecionado) { $EsforcoSelecionado } else { $Esforco }); papel = $Papel }
  [IO.File]::WriteAllText("$Saida.nivel.json", ($rotaModelo | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Write-Host "politica N: minimo $Minima, selecionado $capacidadeModelo $Modelo; esforco pedido $Esforco, selecionado $($rotaModelo.esforcoSelecionado) ($Papel)"
}

function Select-VarianteAgy([string]$Modelo, [string]$Esforco, [string[]]$Catalogo, [switch]$PermitirSemSufixo) {
  $baseAgy = $Modelo -replace '-(low|medium|high|xhigh)$',''
  $pisoAgy = $Esforco
  if ($Modelo -match '^gemini-' -and $Esforco -eq 'xhigh') { $pisoAgy = 'high' }
  $esforcosAgy = @('low','medium','high','xhigh')
  $indiceAgy = [array]::IndexOf($esforcosAgy,$pisoAgy)
  if ($indiceAgy -lt 0) { throw (New-Object ArgumentException "Esforco agy desconhecido: $Esforco") }
  foreach ($varianteAgy in $esforcosAgy[$indiceAgy..3]) {
    $candidatoAgy = "$baseAgy-$varianteAgy"
    if ($Catalogo -contains $candidatoAgy) { return $candidatoAgy }
  }
  # Compatibilidade apenas para um ID nu explicitamente pedido, sem -Esforco. O catalogo
  # nao confirma esforco nesse caso; quem registra a rota deve marca-lo como nao informado.
  if ($PermitirSemSufixo -and $Modelo -eq $baseAgy -and $Catalogo -contains $Modelo) { return $Modelo }
  # Modelo sem variantes de esforco no catalogo (ex.: Flash-Lite): so atende o piso low, o menor.
  $temVariante = @($Catalogo | Where-Object { $_ -match "^$([regex]::Escape($baseAgy))-(low|medium|high|xhigh)$" }).Count -gt 0
  if ($pisoAgy -eq 'low' -and -not $temVariante -and $Catalogo -contains $baseAgy) { return $baseAgy }
  throw "agy sem variante que atenda $Modelo com esforco $Esforco; nao reduzo o piso"
}

function Get-FamiliaModelo([string]$Modelo) {
  if ($Modelo -match '^(?:openai/)?gpt-|^(?:luna|terra|sol|astra)(?:#|$)') { return 'gpt' }
  if ($Modelo -match '^(?:anthropic/)?claude-|^(?:haiku|sonnet|opus|fable)(?:#|$)') { return 'claude' }
  if ($Modelo -match '^(?:google/)?gemini-') { return 'gemini' }
  throw "Familia desconhecida: $Modelo"
}

function Get-ValidacaoModeloObservado([string]$Pedido, [string]$Real, [string]$Minima) {
  if (-not $Real -or $Real -in 'não lido','não informado') { return 'nao-informado' }
  try {
    $null = Assert-CapacidadeModelo $Real $Minima
    if ((Get-FamiliaModelo $Pedido) -ne (Get-FamiliaModelo $Real)) { return 'divergente' }
    $ordemEsforco = @{low=1;medium=2;high=3;xhigh=4;max=5;ultra=6}
    $p = $Pedido -split '#',2; $r = $Real -split '#',2
    if ($p.Count -eq 2 -and $r.Count -eq 2) {
      if (-not $ordemEsforco.ContainsKey($r[1]) -or $ordemEsforco[$r[1]] -lt $ordemEsforco[$p[1]]) { return 'divergente' }
    }
    if ($p.Count -eq 2 -and $r.Count -lt 2) { return 'esforco-nao-informado' }
    return 'confirmado'
  } catch { return 'divergente' }
}

function Assert-ModeloObservado([string]$Saida, [string]$Minima) {
  if (-not (Test-Path -LiteralPath "$Saida.modelo")) { Write-Host 'modelo real: nao informado'; return }
  $registroModelo = [IO.File]::ReadAllText("$Saida.modelo")
  $pedidoModelo = [regex]::Match($registroModelo,'(?m)^pedido: (.+)\r?$').Groups[1].Value.Trim()
  $realModelo = [regex]::Match($registroModelo,'(?m)^real: (.+)\r?$').Groups[1].Value.Trim()
  $validacaoModelo = Get-ValidacaoModeloObservado $pedidoModelo $realModelo $Minima
  if (Test-Path -LiteralPath "$Saida.nivel.json") {
    $nivelModelo = [IO.File]::ReadAllText("$Saida.nivel.json") | ConvertFrom-Json
    $nivelModelo | Add-Member NoteProperty modeloReal $realModelo -Force
    $nivelModelo | Add-Member NoteProperty observacao $validacaoModelo -Force
    [IO.File]::WriteAllText("$Saida.nivel.json", ($nivelModelo | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  }
  if ($validacaoModelo -eq 'divergente') { throw "Modelo real abaixo do piso ou de outra familia: pedido $pedidoModelo, real $realModelo. Preserve o trabalho e confira antes de continuar." }
  Write-Host "confirmacao do modelo: $validacaoModelo"
}
