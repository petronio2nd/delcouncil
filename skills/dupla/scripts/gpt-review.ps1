# Camada extra antes do commit: o GPT-Astra lê o diff, só leitura, e grava os achados num arquivo. Era o
# codex-review.ps1 (codex review); desde 2026-10-24 o GPT entra pelo OpenCode (opencode-cli run --standalone,
# trava só leitura do opencode-comum.ps1), na janela da assinatura do ChatGPT.
# Não substitui o /code-review, a revisão cruzada (revisar.ps1) nem os testes (usuário, 2026-10-22).
# DESATIVADA desde 2026-11-03 (usuário: "GPT extra desativado"; limites.gptExtra na politica-modelos.json):
# sem -Forcar, sai 0 sem chamar ninguém. -Forcar só com pedido explícito do usuário. -SoDiff segue offline.
# Uso: powershell -ExecutionPolicy Bypass -File gpt-review.ps1 -Autor claude|gemini -Pasta <projeto> -Saida <achados.md>
#   sem -Commit/-Base : o que ainda não foi commitado (staged, unstaged e arquivo novo; sem commit ainda, tudo)
#   -Commit <sha>     : o que esse commit trouxe
#                       merge compara com o primeiro pai: o que entrou na linha de quem recebeu, no anexo e risco
#   -Base <branch>    : do ponto em que o branch saiu dessa base até a árvore de trabalho (arquivo novo incluso)
#   -Alto             : forca L2; esforco da politica (Astra low em L1, medium em L2 do recorte original)
#   -SoDiff           : só gera o anexo (<Saida>.diff.md) e sai 0, sem chamar o GPT: para conferir o recorte
# O diff vai anexado (--file), gerado aqui: o modelo não precisa rodar git (pode, só leitura) e revisa o
# mesmo recorte que o script mediu.
# Esta camada e sempre GPT; sem cota ou parecer fica pendente, sem repetir outra familia.
# .env.example/sample/template/dist e *.pub sao publicos; app.env e dados credentials saem do anexo.
# O risco precede o filtro, preserva outros termos/diretorios e usa os mesmos dados ja coletados.
# Falha ambiental de isolamento deixa GPT indisponivel; recusa do provedor sai 2, sem reserva.
# Sai com 0 somente com parecer completo (ou -SoDiff); 1 por falha do git/sem diff;
# 2 por argumento inválido; 3 = revisão pendente.

param(
  [string]$Pasta = '.',
  [Parameter(Mandatory)][string]$Saida,
  [string]$Commit,
  [string]$Base,
  [ValidateSet('claude', 'gemini', 'gpt', 'codex')][string]$Autor,
  [switch]$Alto,
  [switch]$SemReserva, # Mantido por compatibilidade; esta camada sempre roda sem reserva.
  [switch]$SoDiff,
  [switch]$Forcar
)

$utf8 = New-Object System.Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'revisao-comum.ps1')
$politicaCamada = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\orquestrador\politica-modelos.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $SoDiff -and -not $Forcar -and $politicaCamada.limites.gptExtra -eq $false) {
  Write-Output 'dispensado: camada GPT extra desativada pela politica (usuário, 2026-11-03); nada foi chamado. Use o /code-review e, quando a dupla mandar, o revisar.ps1.'
  exit 0
}

if ($Commit -and $Base) { Write-Output 'use -Commit ou -Base, não os dois'; exit 2 }
if (-not $SoDiff -and (-not $Autor -or $Autor -in 'gpt', 'codex')) {
  Write-Output 'Informe -Autor claude|gemini; autor GPT não usa esta camada (mesma família). -SoDiff dispensa autor.'
  exit 2
}
# Pasta errada para aqui: sem isso, a revisão rodaria na pasta atual e revisaria outro repositório.
if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) { Write-Output "pasta não encontrada: $Pasta"; exit 2 }
$Pasta = (Resolve-Path -LiteralPath $Pasta -ErrorAction Stop).Path
$Saida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Saida)
$log = "$Saida.log"
Remove-Item -LiteralPath "$Saida.modelo", "$Saida.rota.json", "$Saida.nivel.json", "$Saida.diff.md" -ErrorAction SilentlyContinue
if (Test-Path $Saida) { Remove-Item $Saida }

# O diff, gerado aqui e anexado. Arquivo novo não aparece no git diff: entra por inteiro, com cabeçalho, menos
# os de nome de segredo (o anexo não passa pela trava de read do revisor). core.quotePath=false: sem ele, nome
# com acento sai entre aspas e com escape octal.
$pulados = @()
try { $recorteDiff = Get-RecorteDiff $Pasta $Commit -Base $Base -SemUltimoCommit -ComPatch -CommitUnico }
catch [ArgumentException] { Write-Output $_.Exception.Message; exit 2 }
catch { Write-Output $_.Exception.Message; exit 1 }
$alvo = $recorteDiff.alvo
$diff = @(); $pula = $false
# Filtra apenas depois de guardar estatisticas do recorte original, inclusive renames.
foreach ($l in $recorteDiff.patch) {
  if ("$l" -match '^diff --git a/(.*) b/(.*)$') {
    $pula = (Test-NomeSensivelDiff $Matches[1]) -or (Test-NomeSensivelDiff $Matches[2])
    if ($pula) { $pulados += $Matches[2] }
  }
  if (-not $pula) { $diff += $l }
}
foreach ($novo in $recorteDiff.novos) {
  $n = $novo.caminho
  if ($novo.sensivel) { $pulados += $n; continue }
  $diff += "diff --git a/$n b/$n", 'new file (nao rastreado; conteudo inteiro abaixo)', "+++ b/$n"
  $diff += @($novo.conteudo | ForEach-Object { "+$_" })
}
if ($pulados.Count) { Write-Output "fora do anexo (nome de segredo): $($pulados -join ', ')" }
if (-not ($diff | Where-Object { $_ })) { Write-Output "sem diff ($alvo) em ${Pasta}: nada a revisar"; exit 1 }
$anexo = "$Saida.diff.md"
$riscoDiff = Get-NivelDiff -Recorte $recorteDiff
# A camada explicitamente pedida exige um parecer, inclusive em diff L0 de texto.
$nivelCamada = if ($Alto -or $riscoDiff.nivel -eq 'L2') { 'L2' } else { 'L1' }
Write-Output "camada GPT: nivel $nivelCamada ($($riscoDiff.motivo)); sem reserva de outra familia"
$pedidoCamada = "# Revisão técnica do diff ($alvo) em $Pasta`r`n`r`n" +
  "## Pedido`r`nRevise somente problemas reais do diff: bug, borda, regressão, segurança, risco de dado ou teste que não prova o comportamento. Não peça reescrita por estilo.`r`n`r`n" +
  "## Critério de aceite`r`nParecer completo no formato da skill revisor, com evidência e arquivo:linha por achado. Sem erro confirmado, diga nenhum achado; sem evidência suficiente, não comprovado. Esta camada não atesta critérios de produto que não constem do pacote.`r`n`r`n" +
  "## Risco do recorte original`r`nNivel $nivelCamada ($($riscoDiff.motivo)); calculado antes de excluir nomes sensiveis do anexo.`r`n`r`n"
[IO.File]::WriteAllText($anexo, "$pedidoCamada``````diff`r`n$($diff -join "`r`n")`r`n```````r`n", $utf8)
if ($SoDiff) { Write-Output "anexo gravado, sem revisar: $anexo"; exit 0 }

$shellRevisar = (Get-Process -Id $PID).Path
$parametros = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'revisar.ps1'),
  '-Autor', $Autor, '-Revisor', 'gpt', '-Pasta', $Pasta, '-Pacote', $anexo, '-Saida', $Saida, '-Nivel', $nivelCamada, '-SemReserva')
if ($Alto) { $parametros += '-Topo' }
& $shellRevisar @parametros
exit $LASTEXITCODE
