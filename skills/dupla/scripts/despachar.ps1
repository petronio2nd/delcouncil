# Despacha uma tarefa a um subagente executor: ele lê e escreve dentro da pasta do projeto e grava o
# relatório final em -Saida. Quem despacha (em geral o Claude Code) confere o diff e os testes antes de
# pedir commit: o executor não commita, e a tarefa diz isso.
# Uso: powershell -ExecutionPolicy Bypass -File despachar.ps1 -Pasta <projeto> -Tarefa <tarefa.md> -Saida <relatorio.md>
#        [-Executor agy|opencode|codex|openrouter] [-Nivel simples|comum|dificil] [-Modelo <id>] [-Esforco low|medium|high|xhigh] [-Rede] [-SoTrava]
#   -Pasta    : raiz do projeto; o executor só escreve dentro dela
#   -Tarefa   : o pedido em Markdown (objetivo, critério de aceite, limites, relatório esperado)
#   -Saida    : relatório final do executor; o log completo fica em <Saida>.log
#   -Executor : agy (padrão), opencode ou openrouter. Tarefa que precisa rodar teste ou comando vai ao
#               opencode (o agy não roda nenhum); o resto, ao agy. Reservas (saída 3): agy -> opencode com GPT
#               (assinatura do ChatGPT, sem custo por chamada) -> opencode com Claude (-Modelo anthropic/...,
#               crédito da API). O openrouter só entra se o usuário pedir (2026-10-22: sem verba para ele).
#               codex: alias do opencode por capacidade (N1 Luna, N2 Terra, N3 Sol pela assinatura; Opus
#               pelo credito da API). O codex.exe nao e mais chamado.
#   -Nivel    : como a orquestradora julga a tarefa; escolhe o modelo barato que dá conta (padrão comum).
#               Esforços da politica-modelos.json (usuário, 2026-11-03): N1 e N2 low, N3 medium; escalada um degrau.
#                 agy:      simples = Gemini Flash-Lite low (sem ele no agy, Gemini Flash low);
#                           comum = Claude Sonnet low; dificil = Claude Opus medium
#                 opencode: N1 = GPT-Luna low; N2 = GPT-Terra low; N3 = GPT-Sol medium (assinatura),
#                           depois Claude Opus medium pelo credito da API.
#                           no provedor openai, nunca os -fast. Com -Modelo anthropic/..., o Claude pelo
#                           crédito da API (custo medido, teto de US$ 2,00 por tarefa).
#                 openrouter (só se o usuário pedir): o Muse Wonder, com reservas, esforço low, medium ou high
#               Astra, Fable e Argon ficam só para revisar (usuário, 2026-11-03): o executor os recusa no -Modelo.
#   -CapacidadeMinima: N1/N2/N3 da fatia; preserve nas reservas. Sem ela: simples N1, comum N2, dificil N3.
#                      Modelo explicito conhecido define o padrao. Modelo abaixo do piso sai 2.
#   -Modelo   : passa por cima do -Nivel: um id do OpenRouter, um modelo de `agy models` ou um openai/<id> ou
#               anthropic/<id> de `opencode models` (gpt-... sem provedor vale como openai/, o resto anthropic/)
#   -Esforco  : passa por cima do esforço do -Nivel (no opencode, vira a variante do modelo)
#   -Rede     : era do Codex (rede no sandbox); hoje só avisa: nenhum executor libera rede
#   -SoTrava  : só no opencode, grava a config da trava, diz onde e sai sem despachar (testar-trava-opencode.ps1)
#   -Conjuntos: conjuntos de regras de dupla\regras\<nome>.md colados antes da tarefa, separados por vírgula
#               (geral, backend, frontend); padrão geral; nenhuma = só a tarefa. A orquestradora escolhe pela
#               área da fatia (ideia tirada da alethe, 2026-10-25). O que o executor recebe fica em <Saida>.tarefa.md
# Sai com 0 e o relatório em -Saida; com 1 e o fim do log, se o executor falhar (no opencode com Claude, também
# acima de US$ 2,00 na tarefa; em qualquer opencode, acima de 40 min: o processo cai); com 3 quando a cota ou o
# crédito do executor acabou (antes ou durante) e a frase diz o próximo: agy -> "-Executor opencode" (GPT),
# opencode GPT -> "-Modelo anthropic/..."; o opencode com Claude é o último (acabou, a tarefa espera a cota ou é
# feita na sessão). -Modelo de família só de revisão (Astra, Fable, Argon) sai com 1.
#
# OpenRouter e agy recebem o caminho da tarefa; o opencode, a tarefa anexada (--file). O cmd faz o > em bytes
# crus, o que preserva o UTF-8 que o PowerShell 5.1 estragaria num pipe.

param(
  [Parameter(Mandatory)][string]$Pasta,
  [Parameter(Mandatory)][string]$Tarefa,
  [Parameter(Mandatory)][string]$Saida,
  [ValidateSet('codex', 'openrouter', 'agy', 'opencode')][string]$Executor = 'agy',
  [ValidateSet('simples', 'comum', 'dificil')][string]$Nivel = 'comum',
  [ValidateSet('N1', 'N2', 'N3', '')][string]$CapacidadeMinima = '',
  [string]$Modelo = '',
  [switch]$Rede,
  [switch]$SoTrava,
  [string]$Esforco = '',
  [string]$Conjuntos = 'geral'
)

function Q([string]$s) { '"' + $s + '"' }
. (Join-Path $PSScriptRoot 'cota.ps1')
. (Join-Path $PSScriptRoot 'opencode-comum.ps1')
. (Join-Path $PSScriptRoot 'revisao-comum.ps1')
. (Join-Path $PSScriptRoot 'politica-modelos.ps1')
if ($Esforco -and $Esforco -notin 'low', 'medium', 'high', 'xhigh') {
  Write-Output "esforco invalido: $Esforco (use low, medium, high ou xhigh)"; exit 2
}
try {
  if ($Modelo -and $Executor -ne 'openrouter' -and (Test-SoRevisao $Modelo)) {
    Write-Output "o $Modelo fica só para revisar (usuário, 2026-11-03): tarefa N3 vai para Sol ou Opus"; exit 1
  }
  $classeInformada = if ($Modelo -and $Executor -ne 'openrouter') { Get-CapacidadeModelo $Modelo } else { '' }
  if (-not $CapacidadeMinima) {
  $CapacidadeMinima = if ($classeInformada) { $classeInformada }
    elseif ($Nivel -eq 'simples') { 'N1' } elseif ($Nivel -eq 'dificil') { 'N3' } else { 'N2' }
} } catch { Write-Output $_.Exception.Message; exit 2 }
# Esforço do -Nivel, quando o -Esforco não vem.
$esforcoExplicito = [bool]$Esforco
if (-not $Esforco) {
  $classeEsforco = if ($classeInformada) { $classeInformada } else { $CapacidadeMinima }
  $Esforco = Get-EsforcoModelo -Capacidade $classeEsforco -Escalar:($Nivel -eq 'dificil' -and $classeEsforco -eq 'N2')
}
# codex e o alias antigo: usa o mesmo roteamento por capacidade do OpenCode.
if ($Executor -eq 'codex') {
  Write-Output 'codex → opencode (modelo conforme capacidade minima)'
  $Executor = 'opencode'
}

$Saida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Saida)
Remove-Item -LiteralPath $Saida, "$Saida.modelo", "$Saida.nivel.json", "$Saida.fonte.json" -ErrorAction SilentlyContinue
# Identifica a fonte pelo canal; Claude via agy nao consome assinatura Claude.
$fonteConsumo = if ($Executor -eq 'agy') { 'antigravity' }
  elseif ($Executor -eq 'openrouter') { 'openrouter' }
  elseif ($Modelo) {
    $id = if ($Modelo -match '/') { $Modelo } elseif ($Modelo -match '^gpt-') { "openai/$Modelo" } else { "anthropic/$Modelo" }
    if ($id -notmatch '^(openai|anthropic)/') { Write-Output 'Provedor nao suportado pelo executor OpenCode; use openai/ ou anthropic/.'; exit 2 }
    Get-FonteOpenCode $id
  } else { 'chatgpt' }
if (-not (Test-FonteConsumo $fonteConsumo $Saida)) { Write-Output 'Fonte indisponivel: use outra fonte ja autorizada preservando a capacidade minima; sem elegivel, execucao pendente.'; exit 3 }
$Pasta = (Resolve-Path $Pasta).Path
$Tarefa = (Resolve-Path $Tarefa).Path
$log = "$Saida.log"
$utf8 = New-Object System.Text.UTF8Encoding($false)
# Regras antes da tarefa: o executor recebe <Saida>.tarefa.md, com cada conjunto e depois a tarefa.
$nomesRegras = @($Conjuntos -split '[,; ]+' | Where-Object { $_ -and $_ -ne 'nenhuma' })
if ($nomesRegras.Count) {
  $pastaRegras = Join-Path (Split-Path $PSScriptRoot) 'regras'
  $falta = @($nomesRegras | Where-Object { -not (Test-Path (Join-Path $pastaRegras "$_.md")) })
  if ($falta.Count) { Write-Output "regras $($falta -join ', ') não existem em $pastaRegras"; exit 2 }
  $partes = @($nomesRegras | ForEach-Object { [IO.File]::ReadAllText((Join-Path $pastaRegras "$_.md"), $utf8).Trim() })
  $comRegras = "$Saida.tarefa.md"
  # Gravação que falha não pode deixar o executor com a tarefa de um despacho anterior (revisão do GPT).
  try {
    if (Test-Path $comRegras) { Remove-Item -LiteralPath $comRegras -Force -ErrorAction Stop }
    [IO.File]::WriteAllText($comRegras, (($partes + '---', [IO.File]::ReadAllText($Tarefa, $utf8)) -join "`r`n`r`n"), $utf8)
  } catch { Write-Output "não deu para gravar $comRegras ($($_.Exception.Message))"; exit 1 }
  $Tarefa = $comRegras
  Write-Output "regras: $($nomesRegras -join ', ') (em $comRegras)"
}
$envs = ''
$rodape = ''

if ($Executor -eq 'openrouter') {
  # Laço de agente do openrouter.ps1 no papel fazer: lê, lista, busca e grava, presos à pasta do projeto,
  # sem segredos nem .git, sem nenhum comando. Paga por chamada: o relatório traz o custo.
  # Fora das reservas desde 2026-10-22 (usuário, sem verba): só quando o usuário pedir. Padrão: os mesmos modelos do Muse que é reserva do árbitro no
  # revisar.ps1 (o primeiro que responder fica até o fim).
  $modelos = if ($Modelo) { $Modelo } else { 'meta/muse-wonder,meta/muse-spark-1.3,qwen/qwen3.8-max-0902' }
  if ($Rede) { Write-Output 'aviso: -Rede não vale no openrouter (o executor não tem ferramenta de rede)' }
  Write-Output "openrouter $modelos, esforço $Esforco, papel fazer"
  $linha = "powershell -NoProfile -ExecutionPolicy Bypass -File $(Q (Join-Path $PSScriptRoot 'openrouter.ps1')) " +
    "-Pasta $(Q $Pasta) -Entrada $(Q $Tarefa) -Saida $(Q $Saida) -Modelos $modelos -Papel fazer -Esforco $Esforco 2> $(Q $log)"
} elseif ($Executor -eq 'opencode') {
  # OpenCode (opencode-cli run): GPT pela assinatura do ChatGPT (a janela que o Codex usava; sem custo por
  # chamada) ou, com -Modelo anthropic/..., Claude pela API da Anthropic (o crédito mensal de US$ 100 que vem
  # com o Max, chave opencode-reserva, sem rollover; esgotado, a API recusa sem cobrar). O único executor que
  # roda teste. O shell do OpenCode não tem sandbox do sistema: a trava é a lista de permissões abaixo, numa
  # pasta de config só deste despacho (OPENCODE_CONFIG_DIR, lida pelo servidor privado do --standalone; sem
  # ele o run usaria o serviço de fundo, com a config do usuário e os MCP dele). O login fica no opencode.db, fora
  # da pasta de config, e vale igual. Testado em 2026-10-22 (OpenCode 2.1.2) e 2026-10-24 (2.1.4, GPT).
  $oc = Get-OpenCodeExe
  if (-not $oc) { Write-Output 'opencode-cli.exe não encontrado (app OpenCode desktop)'; exit 1 }
  $py = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
  if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
  if (-not $py) { Write-Output 'python não encontrado (o custo do OpenCode sai do banco dele pelo opencode_custo.py)'; exit 1 }
  $custoPy = Join-Path $PSScriptRoot 'opencode_custo.py'
  if ($Rede) { Write-Output 'aviso: -Rede não vale no opencode (URL, busca e o fetch do Code Mode ficam negados)' }
  $teto = 2.00

  # Permissões (OpenCode v2: lista de regras, a última que casa vence; caminho sem diferença de maiúscula
  # no Windows; * cruza a barra). Tudo negado, depois o que o executor precisa: ler, buscar e gravar na
  # pasta do projeto (fora dela, external_directory nega antes de read e edit) e só comandos de teste e de
  # leitura. Negados por omissão: subagente (o explore embutido libera shell *), execute (Code Mode, com
  # fetch), web, skill, pergunta e todo MCP (<servidor>_<ferramenta>).
  $regras = New-Object Collections.ArrayList
  function Regra([string]$a, [string]$r, [string]$e) { [void]$regras.Add([ordered]@{ action = $a; resource = $r; effect = $e }) }
  Regra '*' '*' 'deny'
  # Sem grep: o recurso dele é a expressão, não o arquivo, e no teste ele mostrou o .env que o read nega.
  foreach ($a in 'read', 'glob', 'edit') { Regra $a '*' 'allow' }
  # Um padrão terminado em " *" também casa o comando sem argumento.
  $comandos = 'pytest *', 'python *.py *', 'python --version', 'node --test *', 'node *.js *', 'node *.mjs *',
    'node *.cjs *', 'node --version', 'npm test *', 'npm run test *', 'npm run lint *', 'git status *', 'git diff *',
    'git log *', 'git show *', 'git ls-files *', 'git blame *', 'git rev-parse *'
  foreach ($c in $comandos) { Regra 'shell' $c 'allow' }
  # Nenhuma opção do interpretador antes do arquivo: "python *.py *" casaria "python -c<código> x.py" e
  # "python -m<módulo> x.py" (a opção colada ao valor, revisão do Codex). Depois, só os módulos de teste.
  foreach ($c in 'python -*', 'node -*') { Regra 'shell' $c 'deny' }
  foreach ($c in 'python --version', 'node --version', 'node --test *') { Regra 'shell' $c 'allow' }
  foreach ($c in 'pytest', 'unittest', 'py_compile', 'doctest', 'compileall') { Regra 'shell' "python -m $c *" 'allow' }
  # Código solto na linha de comando e saída de git em arquivo: tudo o que roda tem de ser arquivo da pasta
  # (fica no diff) ou ferramenta fixa.
  foreach ($c in 'python *-c *', 'node --test -*', 'node *-e *', 'node *--eval*', 'node *-p *', 'node *--print*', 'node *-r *',
    'node *--require*', 'node *--import*', 'node *--loader*', 'node *--experimental-loader*', '*data:*', 'git *--output*',
    'git *--no-index*', 'git *--ext-diff*', 'git *-c *', 'git *--exec-path*') { Regra 'shell' $c 'deny' }
  # Nome de arquivo de segredo na linha: o git diff --no-index e o git show leem o arquivo sem passar pelo read.
  foreach ($c in '*.env*', '*.pem*', '*.key*', '*.p12*', '*.pfx*', '*.kdbx*', '*.ppk*', '*id_rsa*', '*id_ed25519*',
    '*credentials*', '*secret.*', '*secrets.*', '*recovery-key*', '*.claude.json*', '*mcp_config*') { Regra 'shell' $c 'deny' }
  # Redirecionamento e subexpressão: o padrão casa a linha inteira, e no teste "python -m unittest --help >
  # <fora>\x.txt" passou e gravou fora da pasta. ; && e | o OpenCode já separa em comandos. Os parênteses
  # também: o PowerShell avalia "(Get-Content .env)" no meio dos argumentos.
  foreach ($c in '*>*', '*<*', '*$*', '*%*', '*`*', '*&*', '*(*', '*)*', '*{*', '*}*', '*@*') { Regra 'shell' $c 'deny' }
  # Caminho fora da pasta na linha: a inferência de pasta externa do OpenCode é "best effort" e deixou rodar
  # "python <fora>\x.py" e "unittest discover -s <fora>". Só caminho relativo, sem subir de pasta.
  foreach ($c in '*:\*', '*:/*', '*..*', '*~*', '* /*', '* \*', '*=/*', '*=\*', '*"/*', '*"\*', "*'/*", "*'\*") { Regra 'shell' $c 'deny' }
  # Segredos: a lista de read do opencode.json do usuário (o .env.example e afins seguem legíveis).
  foreach ($s in '*.env', '*.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.kdbx', '*.ppk', '*recovery-key*', '*/id_*',
    '*credentials', '*credentials.*', '*secret.*', '*secrets.*', '*.claude.json', '*mcp_config.json') { Regra 'read' $s 'deny' }
  foreach ($s in '*.env.example', '*.env.sample', '*.env.template', '*.env.dist', '*/id_*.pub') { Regra 'read' $s 'allow' }
  # Nunca grava em .git, .env nem config do OpenCode no projeto (a sessão seguinte do usuário a carregaria).
  foreach ($s in '.git', '*/.git', '.git/*', '*/.git/*', '*.env', '*.env.*', '.opencode', '*/.opencode', '.opencode/*',
    '*/.opencode/*', 'opencode.json', 'opencode.jsonc', '*/opencode.json', '*/opencode.jsonc') { Regra 'edit' $s 'deny' }
  Regra 'external_directory' '*' 'deny'
  # Saída longa de ferramenta, que o OpenCode guarda fora do projeto e relê.
  Regra 'external_directory' '~/.local/share/opencode/tool-output/*' 'allow'
  Regra 'external_directory' "$($env:USERPROFILE -replace '\\', '/')/.local/share/opencode/tool-output/*" 'allow'
  # Sem a trava inteira, não roda: regra perdida vira a base do OpenCode, que libera tudo (2026-10-22, um
  # alias do PowerShell engoliu as regras e o run saiu sem nenhuma).
  if ($regras.Count -lt 60 -or $regras[0].action -ne '*' -or $regras[0].effect -ne 'deny') {
    Write-Output "trava do opencode incompleta ($($regras.Count) regras): não despacho"; exit 1
  }

  # Config só deste despacho: sem MCP, sem instructions (o CLAUDE.md global manda commitar), modelo pequeno
  # do mesmo provedor, as regras também no agente build (regra de agente vem depois da global) e no máximo
  # 100 passos. O plugin segredos do usuário vai junto: cobre o grep e o shell pelo conteúdo, não só pelo nome.
  $casa = "$env:LOCALAPPDATA\dupla\opencode-fazer\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
  New-Item -ItemType Directory -Force "$casa\plugins" | Out-Null
  function Sai([int]$cod, [string]$msg) { Write-Output $msg; Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue; exit $cod }
  $segredos = "$env:USERPROFILE\.config\opencode\plugins\segredos.ts"
  if (-not (Test-Path -LiteralPath $segredos)) { Sai 1 "sem o plugin $segredos, que barra segredo pelo conteúdo: não despacho" }
  try { Copy-Item -LiteralPath $segredos -Destination "$casa\plugins\" -ErrorAction Stop }
  catch { Sai 1 "nao deu para copiar o plugin segredos; executor nao sera chamado: $($_.Exception.Message)" }
  # Modelo: o pedido, se for openai/ ou anthropic/, estiver na lista e não for de revisão nem -fast; sem pedido,
  # pelo piso de capacidade: Luna/Terra/Sol sem custo por chamada; Opus pela API só quando o Sol falta.
  $lista = @(Get-ModelosOpenCode $oc $casa)
  if (-not $lista.Count) { Sai 1 'opencode models não trouxe nenhum openai/ nem anthropic/ (login no OpenCode?)' }
  if ($Modelo) {
    # $id ja foi normalizado e validado no preflight.
    if ($id -notmatch '^(openai|anthropic)/') { Sai 1 "o executor opencode usa só os provedores openai (assinatura do ChatGPT) e anthropic (crédito da API): $Modelo" }
    if (Test-SoRevisao ($id -replace '-fast$', '')) { Sai 1 "o $id fica só para revisar (usuário, 2026-11-03): tarefa N3 vai para Sol ou Opus" }
    if ($id -match '-fast$') { Sai 1 "$id custa o dobro: use o mesmo sem -fast" }
    if ($lista -notcontains $id) { Sai 1 "modelo $id fora de opencode models; há: $($lista -join ', ')" }
    $modeloUsado = $id
  } else {
    try { $modeloUsado = Get-ModeloExecutorOpenCode $lista $CapacidadeMinima }
    catch { Sai 3 $_.Exception.Message }
  }
  $provedor = ($modeloUsado -split '/')[0]
  $fonteConsumo = Get-FonteOpenCode $modeloUsado
  if (-not (Test-FonteConsumo $fonteConsumo $Saida)) { Sai 3 'fonte-travada: use outra fonte autorizada preservando a capacidade minima.' }
  if (-not $esforcoExplicito) {
    $classeResolvida = Get-CapacidadeModelo $modeloUsado
    $Esforco = Get-EsforcoModelo -Capacidade $classeResolvida -Escalar:($Nivel -eq 'dificil' -and $classeResolvida -eq 'N2')
  }
  try { Write-RotaModelo $Saida $modeloUsado $Esforco $CapacidadeMinima 'executor' }
  catch { Sai 2 $_.Exception.Message }
  # Modelo pequeno (título e resumo) do mesmo provedor: Luna no openai, Haiku no anthropic.
  $pequeno = if ($provedor -eq 'openai') { Get-GptMaisNovo $lista 'luna' } else { Get-ClaudeMaisNovo $lista 'haiku' }
  if (-not $pequeno) { $pequeno = $modeloUsado }

  if ($provedor -eq 'openai') {
    # Janela da assinatura do ChatGPT: em 100%, a assinatura recusa; o próximo é o Claude pelo crédito da API.
    $classeReserva = if ((Get-CapacidadeModelo $modeloUsado) -eq 'N3') { 'opus' } elseif ($CapacidadeMinima -eq 'N1') { 'haiku' } else { 'sonnet' }
    $reservaModelo = Get-ClaudeMaisNovo $lista $classeReserva
    $proximo = "preserve -CapacidadeMinima $CapacidadeMinima; confira o diff e use -Modelo $(if ($reservaModelo) { $reservaModelo } else { "anthropic/claude-$classeReserva-..." }) (Claude pelo crédito da API)"
    foreach ($j in @(Get-CotaChatGPT)) {
      if (-not $j.aberta) { continue }
      if ($j.usada -ge 100) { Sai 3 "janela do ChatGPT zerada (janela $($j.janela) em 100%, volta $(Format-Volta $j.volta), fonte $($j.fonte)): $proximo" }
      Write-Output ("cota do ChatGPT, janela {0}: {1}% usada, zera {2} (fonte {3})" -f $j.janela, $j.usada, (Format-Volta $j.volta), $j.fonte)
    }
  } else {
    # Crédito: o OpenCode não diz o saldo; o gasto do ciclo do Max (dia 20 ao 19) sai do banco dele (cálculo
    # dele, o Console é a conta oficial). Com US$ 100 ou mais no ciclo, o crédito acabou: nem chama. O Claude é
    # a última reserva.
    $proximo = 'sem executor: faça na sessão ou espere a cota'
    Set-AmbienteOpenCode $casa
    try { $ciclo = & $py -I -X utf8 $custoPy ciclo 2>$null | ConvertFrom-Json } finally { Clear-AmbienteOpenCode }
    if ($ciclo) {
      $desde = [DateTimeOffset]::FromUnixTimeSeconds($ciclo.inicio_ts).UtcDateTime.ToString('dd/MM')
      Write-Output ("crédito da API pelo OpenCode: US$ {0:N2} gastos desde {1}, de US$ 100" -f $ciclo.custo, $desde)
      if ($ciclo.custo -ge 100) { Sai 3 "crédito da API do ciclo esgotado pela conta do OpenCode (US$ $($ciclo.custo)): $proximo" }
    } else { Write-Output 'aviso: o gasto do ciclo no banco do OpenCode não foi lido' }
  }

  $json = [ordered]@{
    '$schema' = 'https://opencode.ai/config.json'
    model = $modeloUsado; small_model = $pequeno; instructions = @()
    permissions = $regras; agents = @{ build = @{ steps = 100; permissions = $regras } }
  } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText("$casa\opencode.json", $json, $utf8)
  if ($SoTrava) { Write-Output "trava gravada, sem despachar: $casa"; exit 0 }

  # O prompt (só ASCII) vai na linha; a tarefa, anexada (--file).
  $prompt = "A tarefa esta no arquivo anexo: leia por inteiro e faca por completo, respeitando os limites dela. O projeto e a pasta atual ($Pasta): " +
    'leia e grave so dentro dela, com caminhos relativos. Pode rodar so comandos de teste e de leitura (python -m pytest, pytest, python -m unittest, ' +
    'python <arquivo>.py, node --test, node <arquivo>.js, npm test, git status, git diff, git log); o resto e negado, e tambem redirecionamento ' +
    '(>, 2>&1), variavel e caminho absoluto ou com ..: a saida do comando ja volta inteira. Use o python e o node do PATH. ' +
    'Nada de commit. Termine com o relatorio que a tarefa pede, listando os arquivos que gravou e os comandos que rodou, com o resultado de cada um.'
  $jsonl = "$Saida.jsonl"
  $tetoTxt = if ($provedor -eq 'openai') { 'sem teto de US$ (assinatura do ChatGPT)' } else { "para acima de US$ $teto" }
  Write-Output "opencode $modeloUsado#$Esforco, ferramentas presas a $Pasta (o teste roda solto), config $casa, $tetoTxt"
  # Segredos do ambiente fora do processo: um teste lê os.environ.
  $envs = "set `"OPENCODE_CONFIG_DIR=$casa`"`r`nset `"OPENCODE_DISABLE_PROJECT_CONFIG=1`"`r`nset `"OPENCODE_DISABLE_CLAUDE_CODE=1`"`r`n" +
    "set `"OPENCODE_DISABLE_AUTOUPDATE=1`"`r`n" +
    ((Get-ChildItem env: | Where-Object { $_.Name -match 'KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL' } | ForEach-Object { "set `"$($_.Name)=`"`r`n" }) -join '')
  $linha = "cd /d $(Q $Pasta) && $(Q $oc) run --standalone --auto --format json -m $modeloUsado#$Esforco --title $(Q "dupla $(Split-Path $Pasta -Leaf)") " +
    "--file $(Q $Tarefa) $(Q $prompt) > $(Q $jsonl) 2> $(Q $log)"
} else {
  # agy (Antigravity CLI) com um home só deste despacho, em %LOCALAPPDATA%\dupla\agy-fazer\<id>: o
  # settings.json de lá libera write_file só na pasta do projeto (menos .git e .env) e nega comando, URL
  # e MCP; no -p, o que não está liberado é negado sem perguntar. O ~\.gemini\antigravity-cli\settings.json
  # do revisor (tudo negado) fica intocado. O login vem do cofre do Windows, não do home, e vale nos dois.
  # Não use write_file(*) nem --mode accept-edits: no teste de 2026-10-18 os dois deixaram o agy gravar
  # fora do projeto.
  $agy = "$env:LOCALAPPDATA\agy\bin\agy.exe"
  if (-not (Test-Path $agy)) { $agy = (Get-Command agy -ErrorAction SilentlyContinue).Source }
  if (-not $agy) { Write-Output 'agy não encontrado (irm https://antigravity.google/cli/install.ps1 | iex)'; exit 1 }
  if ($Rede) { Write-Output 'aviso: -Rede não vale no agy (URL e comando ficam negados)' }
  $casa = "$env:LOCALAPPDATA\dupla\agy-fazer\$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
  $cfg = "$casa\.gemini\antigravity-cli"
  New-Item -ItemType Directory -Force $cfg | Out-Null
  $barra = $Pasta -replace '\\', '/'
  $trava = 'command(*)', 'execute_url(*)', 'read_url(*)', 'mcp(*)', "write_file($barra/.git)", "write_file($barra/.env)"
  $json = @{ permissions = @{ allow = @("write_file($barra)"); deny = $trava } } | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText("$cfg\settings.json", $json, $utf8)
  $velhoPerfil = $env:USERPROFILE; $velhoHome = $env:HOME
  $env:USERPROFILE = $casa; $env:HOME = $casa
  # Saída antes de rodar: o home deste despacho não serve para depurar nada, sai junto.
  function Sai([int]$cod, [string]$msg) { Write-Output $msg; Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue; exit $cod }
  try {
    # Confere a trava como o agy a lê, pega a lista de modelos e a cota (/permissions e /usage no -p não
    # gastam cota).
    # Na pasta do projeto, onde o executor roda: um settings.json de projeto lá também conta.
    Push-Location $Pasta
    try { $perm = @(& $agy -p '/permissions' 2>$null) } finally { Pop-Location }
    $lista = @(& $agy models 2>$null | ForEach-Object { ($_ -split '\s+')[0] } | Where-Object { $_ })
    $cotas = @(Get-CotaAgy $agy)
  } finally { $env:USERPROFILE = $velhoPerfil; $env:HOME = $velhoHome }
  $faltam = @($trava | Where-Object { $r = $_; -not ($perm | Where-Object { $_ -match "\bdeny\b\s+$([regex]::Escape($r))\s*$" }) })
  if ($faltam.Count) { Sai 1 "agy sem a trava do executor (falta deny de $($faltam -join ', ') em $cfg\settings.json)" }
  if (-not $lista.Count) { Sai 1 'agy models não respondeu (login do agy?)' }

  # Modelo: o pedido, se estiver na lista; sem pedido, pelo -Nivel, o mais novo da família: Gemini Flash-Lite
  # nas simples (sem ele, Gemini Flash, um degrau acima), Claude Sonnet nas comuns, Claude Opus nas difíceis
  # (usuário, 2026-10-22: o grupo Claude/GPT do agy sobrava inteiro e o Flash erra lógica; Argon só revisa). O
  # esforço do -Nivel vira o sufixo desejado. Variante ausente so sobe o esforco; sem variante suficiente, sai indisponivel.
  $proximo = if ($CapacidadeMinima -eq 'N3') { 'confira o diff; preserve -CapacidadeMinima N3 com -Executor opencode (GPT Sol; reserva Claude Opus pela API)' }
    else { "confira o diff; preserve -CapacidadeMinima $CapacidadeMinima com -Executor opencode (GPT; reserva Claude da mesma capacidade)" }
  if ($Modelo) {
    if ($lista -notcontains $Modelo) { Sai 1 "modelo $Modelo fora de agy models; há: $($lista -join ', ')" }
    $modeloUsado = $Modelo
    if (-not $esforcoExplicito -and $Modelo -match '-(low|medium|high|xhigh)$') { $Esforco = $Matches[1] }
  } else {
    $familias = @{ simples = @('flash-lite', 'flash'); comum = @('sonnet'); dificil = @('opus') }[$Nivel]
    $base = $null
    foreach ($familia in $familias) {
      # gemini-<versão>-<família>[-<esforço>] ou claude-<família>-<versão com hífen>-<esforço>; a família é
      # obrigatória. O Flash-Lite pode vir sem sufixo de esforço (só atende o piso low).
      $padrao = "^(?:gemini-(\d+(?:\.\d+)?)-$familia(?:-(?:low|medium|high))?|claude-$familia-(\d+(?:-\d+)?)-(?:low|medium|high))$"
      $base = $lista | Where-Object { $_ -match $padrao } | ForEach-Object {
        $null = $_ -match $padrao; $v = "$($Matches[1])$($Matches[2])" -replace '-', '.'; if ($v -notmatch '\.') { $v += '.0' }
        [pscustomobject]@{ id = $_; base = $_ -replace '-(low|medium|high)$', ''; v = [version]$v }
      } | Sort-Object v -Descending | Select-Object -First 1
      if (-not $base) { continue }
      $esforcoFamilia = if ($esforcoExplicito) { $Esforco } else { Get-EsforcoModelo -Capacidade (Get-CapacidadeModelo $base.id) }
      # Familia sem variante que atenda o piso (ex.: Flash-Lite sem sufixo com piso medium) cede a vez a
      # proxima da lista, em vez de encerrar o despacho (2026-11-07, N1 subiu para medium).
      try { $null = Select-VarianteAgy $base.id $esforcoFamilia $lista; $Esforco = $esforcoFamilia; break }
      catch [ArgumentException] { Sai 2 $_.Exception.Message }
      catch { $base = $null }
    }
    if (-not $base) { Sai 3 "agy sem $($familias -join '/') que atenda o esforço na lista de modelos ($($lista -join ', ')): $proximo" }
    $modeloUsado = $base.id
  }
  try { $modeloUsado = Select-VarianteAgy $modeloUsado $Esforco $lista -PermitirSemSufixo:([bool]$Modelo -and -not $esforcoExplicito) }
  catch [ArgumentException] { Sai 2 $_.Exception.Message }
  catch { Sai 3 $_.Exception.Message }
  $esforcoSelecionado = if ($modeloUsado -match '-(low|medium|high|xhigh)$') { $Matches[1] } else { 'nao-informado' }
  if ($esforcoSelecionado -eq 'nao-informado') { Write-Output 'agy: ID explicito sem sufixo; esforco aplicado nao informado pelo catalogo' }
  try { Write-RotaModelo $Saida $modeloUsado $Esforco $CapacidadeMinima 'executor' $esforcoSelecionado }
  catch { Sai 2 $_.Exception.Message }

  # Cota: o grupo do modelo zerado (5 h ou semanal) passa ao próximo executor. O Argon é dividido com o
  # árbitro, que tem prioridade (usuário, 2026-10-18): o executor só usa o Argon com mais de 30% do limite
  # semanal dele.
  $grupo = if ($modeloUsado -match '^gemini-') { 'Gemini Models' } else { 'Claude and GPT models' }
  $zeradas = @($cotas | Where-Object { $_.grupo -eq $grupo -and $_.resta -le 0 })
  if ($zeradas.Count) {
    Sai 3 "cota do agy zerada ($(($zeradas | ForEach-Object { "$($_.grupo), $($_.nome), volta $(Format-Volta $_.volta)" }) -join '; ')): $proximo"
  }
  if (-not ($cotas | Where-Object { $_.grupo -eq $grupo })) { Write-Output "aviso: o /usage do agy não trouxe o grupo $grupo" }
  $argon = $cotas | Where-Object { $_.grupo -match 'Argon' } | Select-Object -First 1
  # Sem a cota do Argon no /usage, os 30% não estão confirmados: não usa (revisão do Codex, 2026-10-18).
  if ($modeloUsado -match '-argon-' -and -not $argon) {
    Sai 3 "cota do Argon não veio no /usage do agy, sem como garantir a reserva do árbitro: $proximo"
  }
  if ($modeloUsado -match '-argon-' -and $argon.resta -le 30) {
    Sai 3 "Argon reservado ao árbitro (resta $($argon.resta)% do limite semanal, volta $(Format-Volta $argon.volta)): $proximo"
  }
  if ($argon -and $modeloUsado -match '-argon-') { Write-Output "cota do Argon: resta $($argon.resta)% do limite semanal" }
  $rodape = "`r`n`r`n---`r`nExecutor: agy $modeloUsado (plano Google AI Pro do usuário, sem custo por chamada)"
  # O agy -p não lê a entrada padrão: o prompt (só ASCII) manda ler a tarefa. Sem --add-dir, que tornaria
  # a pasta da tarefa gravável; o agy já lê o %TEMP% por padrão.
  $prompt = "Leia por inteiro o arquivo $Tarefa : e a tarefa. Faca a tarefa por completo, respeitando os limites dela. O projeto e a pasta atual ($Pasta): " +
    'grave arquivos so dentro dela, nunca na pasta da tarefa. Comandos, URL e MCP estao bloqueados, entao nao diga que rodou testes. ' +
    'Termine com o relatorio que a tarefa pede, listando os arquivos que gravou.'
  Write-Output "agy $modeloUsado, grava só em $Pasta, home $casa"
  $envs = "set `"USERPROFILE=$casa`"`r`nset `"HOME=$casa`"`r`n"
  $linha = "cd /d $(Q $Pasta) && $(Q $agy) -p $(Q $prompt) --model $modeloUsado --print-timeout 30m " +
    "--output-format text > $(Q $Saida) 2> $(Q $log)"
}

if (-not (Test-FonteConsumo $fonteConsumo $Saida)) {
  $msgFonte = 'Fonte indisponivel: use outra fonte ja autorizada preservando a capacidade minima; sem elegivel, execucao pendente.'
  if ($Executor -in 'agy', 'opencode') { Sai 3 $msgFonte }
  Write-Output $msgFonte; exit 3
}
# Vai por um .cmd ao lado da saída: passar aspas aninhadas direto ao cmd pelo PowerShell 5.1 quebra.
$bat = "$Saida.cmd"
[IO.File]::WriteAllText($bat, "@echo off`r`nchcp 65001 > nul`r`n$envs$linha`r`n", $utf8)
if ($Executor -ne 'opencode') {
  cmd /d /c (Q $bat)
  $codigo = $LASTEXITCODE
} else {
  # O OpenCode não tem teto de gasto: no anthropic, o custo da sessão sai do banco a cada 15 s e, passou do
  # teto (ou de 40 min), a árvore do processo cai. No openai (assinatura) não há custo por chamada: só os 40 min.
  $medir = $provedor -eq 'anthropic'
  $proc = Start-Process cmd.exe -ArgumentList '/d', '/c', (Q $bat) -NoNewWindow -PassThru
  $null = $proc.Handle  # sem ler o Handle já, o ExitCode do Start-Process volta vazio
  $inicio = Get-Date; $sid = $null; $custo = 0.0; $corte = ''; $lido = $inicio
  # A sessão sai do primeiro evento do jsonl; o custo, do banco. $lido marca a última leitura válida: sem
  # medição, o teto não vale, e o despacho cai em 2 minutos sem ela (revisão do Codex).
  function LerCusto {
    if (-not $script:sid -and (Test-Path $jsonl)) {
      $m = Select-String -LiteralPath $jsonl -Pattern '"sessionID":"(ses_[^"]+)"' -List -ErrorAction SilentlyContinue
      if ($m) { $script:sid = $m.Matches[0].Groups[1].Value }
    }
    if (-not $script:sid) { return $false }
    $c = & $py -I -X utf8 $custoPy sessao $script:sid 2>$null
    if ("$c" -notmatch '^\d+(\.\d+)?$') { return $false }
    $script:custo = [double]::Parse("$c", [Globalization.CultureInfo]::InvariantCulture); $script:lido = Get-Date
    $true
  }
  function Teto {
    if ($custo -gt $teto) { $script:corte = ('custo de US$ {0:N4} passou do teto de US$ {1:N2}' -f $custo, $teto) }
  }
  while (-not $proc.WaitForExit(15000)) {
    if ($medir) {
      $null = LerCusto; Teto
      if (-not $corte -and ((Get-Date) - $lido).TotalMinutes -gt 2) { $corte = 'custo sem leitura há 2 minutos (sessão ou banco do OpenCode)' }
    }
    if (-not $corte -and ((Get-Date) - $inicio).TotalMinutes -gt 40) { $corte = 'passou de 40 minutos' }
    if ($corte) { taskkill /PID $proc.Id /T /F 2>&1 | Out-Null; $proc.WaitForExit(); break }
  }
  $codigo = $proc.ExitCode
  # A tarefa pode ter passado do teto entre a última leitura e o fim: sem uma leitura final válida (3
  # tentativas), o custo não está confirmado e o despacho falha (revisão do Codex, 2ª rodada).
  if ($medir) {
    $final = $false
    for ($t = 0; $t -lt 3 -and -not $final; $t++) { if ($t) { Start-Sleep 2 }; $final = LerCusto }
    if (-not $corte) { if ($final) { Teto } else { $corte = 'custo final não confirmado (sessão ou banco do OpenCode sem leitura)' } }
  } elseif (-not $sid -and (Test-Path $jsonl)) {
    $m = Select-String -LiteralPath $jsonl -Pattern '"sessionID":"(ses_[^"]+)"' -List -ErrorAction SilentlyContinue
    if ($m) { $sid = $m.Matches[0].Groups[1].Value }
  }
  # Relatório: o texto da última mensagem do assistente. Erros da API vão ao log, junto do stderr.
  $eventos = @(if (Test-Path $jsonl) { Get-Content -LiteralPath $jsonl -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } })
  $textos = @($eventos | Where-Object { $_.type -eq 'text' -and $_.part.text })
  if ($textos.Count) {
    $ultima = $textos[-1].part.messageID
    [IO.File]::WriteAllText($Saida, (($textos | Where-Object { $_.part.messageID -eq $ultima } | ForEach-Object { $_.part.text }) -join "`r`n`r`n"), $utf8)
  }
  $erros = @($eventos | Where-Object { $_.type -eq 'error' } | ForEach-Object { "erro do OpenCode: $($_.error.type): $($_.error.message)" })
  # Evento de erro é falha mesmo com texto parcial e código 0 (revisão do Codex).
  if ($erros.Count) { [IO.File]::AppendAllText($log, "`r`n" + ($erros -join "`r`n") + "`r`n", $utf8); if ($codigo -eq 0) { $codigo = 1 } }
  $custoTxt = ('US$ {0:N4}' -f $custo) + $(if ($sid) { ", sessão $sid" } else { '' })
  $rodape = if ($medir) {
    "`r`n`r`n---`r`nExecutor: opencode $modeloUsado#$Esforco (crédito da API da Anthropic do Max, chave opencode-reserva); custo $custoTxt (cálculo do OpenCode)" +
      $(if ($custo -gt 0.5) { ' ATENCAO: passou de US$ 0,50' } else { '' })
  } else {
    "`r`n`r`n---`r`nExecutor: opencode $modeloUsado#$Esforco (assinatura do ChatGPT do usuário, sem custo por chamada)$(if ($sid) { "; sessão $sid" } else { '' })"
  }
  if ($corte) {
    Write-Output "opencode cortado: $corte ($custoTxt). Confira o que ele já gravou; o fim do log:"
    Get-Content $log -Tail 10 -Encoding UTF8 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
  }
}
# Fonte travada dentro do processo filho continua indisponibilidade, nao falha de tarefa.
if ($codigo -eq 3 -and $Executor -eq 'openrouter') {
  if ($Executor -in 'agy', 'opencode') { Sai 3 'Fonte indisponivel durante execucao; confira o trabalho parcial antes da reserva.' }
  Write-Output 'Fonte indisponivel durante execucao; confira o trabalho parcial antes da reserva.'; exit 3
}
# Modelo pedido × real em <saida>.modelo (painel orquestra) e no rodapé; o agy não diz qual rodou.
$modTxt = if ($Executor -eq 'opencode') { Write-ModeloReal $Saida "$modeloUsado#$Esforco" $sid }
elseif ($Executor -eq 'agy') { Write-ModeloReal $Saida $modeloUsado '' 'não informado' }
if ($modTxt) { Write-Output $modTxt; if ($rodape) { $rodape += "; $modTxt" } }
try { Assert-ModeloObservado $Saida $CapacidadeMinima }
catch { Write-Output $_.Exception.Message; exit 1 }
$vazio = -not (Test-Path $Saida) -or (Get-Item $Saida).Length -eq 0
$respostaExecutor = if (-not $vazio) { [IO.File]::ReadAllText($Saida) } else { '' }
if (Test-LimiteExecutor $respostaExecutor $codigo) {
  Write-Output "limite do provedor na resposta do executor, mesmo com exit $codigo; confira o diff antes de continuar: $proximo"
  if ($Executor -in 'agy', 'opencode') { Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue }
  exit 3
}

# Cota que acabou no meio. No opencode com GPT, o erro do provedor openai vai ao log (evento de erro do run).
if ($Executor -eq 'opencode' -and -not $medir -and ($codigo -ne 0 -or $vazio) -and (Test-CotaChatGPTNoLog $log)) {
  Write-Output "janela do ChatGPT acabou no meio da tarefa (confira o que ele já gravou): $proximo"
  Get-Content $log -Tail 5 -Encoding UTF8 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue
  exit 3
}
# No agy, o log é só o stderr: "quota" ou RESOURCE_EXHAUSTED nele é a cota que acabou no meio.
if ($Executor -eq 'agy' -and ($codigo -ne 0 -or $vazio) -and (Test-Path $log) -and
  (Select-String -LiteralPath $log -Pattern 'quota|RESOURCE_EXHAUSTED' -Quiet)) {
  Write-Output "cota do agy acabou no meio da tarefa (confira o que ele já gravou): $proximo"
  Get-Content $log -Tail 5 -Encoding UTF8 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue
  exit 3
}
# No opencode, crédito da API esgotado vem como erro da Anthropic ("credit balance is too low") no log.
if ($Executor -eq 'opencode' -and $medir -and ($codigo -ne 0 -or $vazio) -and (Test-Path $log) -and
  (Select-String -LiteralPath $log -Pattern 'credit balance is too low|insufficient.?(credit|funds|balance)' -Quiet)) {
  Write-Output "crédito da API da Anthropic esgotado (confira o que ele já gravou): $proximo"
  Get-Content $log -Tail 5 -Encoding UTF8 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue
  exit 3
}
if ($codigo -ne 0 -or $vazio) {
  Write-Output "$Executor falhou (exit $codigo). Fim do log:"
  Get-Content $log -Tail 15 -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($Executor -in 'agy', 'opencode') { Write-Output "config do $Executor mantida para depurar: $casa" }
  exit 1
}
if ($Executor -in 'agy', 'opencode') { Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue }
if ($rodape) { [IO.File]::AppendAllText($Saida, $rodape, $utf8) }
Write-Output "relatório gravado em $Saida"
