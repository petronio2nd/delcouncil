try { . ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'fontes-comum.ps1') -ErrorAction Stop).Path) }
catch { throw 'Controle de fontes indisponivel; consumo bloqueado.' }
# Pedaços do OpenCode (opencode-cli run --standalone) que o revisar.ps1, o gpt-review.ps1 e o despachar.ps1
# dividem (dot-source: . .\opencode-comum.ps1). Nada aqui chama modelo por conta própria: quem chama é o script.
#   Get-OpenCodeExe                       : o opencode-cli.exe do app desktop; sem ele, o do PATH
#   Get-ModelosOpenCode <oc>              : os ids anthropic/ e openai/ de `opencode models`, lidos com uma config
#                                           vazia (sem os MCP nem as instruções do usuário; o login vem do opencode.db)
#   Get-GptMaisNovo <lista> <familia>     : o openai/gpt-<versão>-<família> mais novo da lista, nunca os -fast
#   Get-ClaudeMaisNovo <lista> <familia>  : o anthropic/claude-<família>-<versão> mais novo, sem data nem -fast
#   New-CasaOpenCodeLeitura ...           : pasta de config só desta chamada, com a trava SÓ LEITURA (abaixo)
#   Invoke-OpenCodeRun ...                : roda o run por um .cmd (UTF-8, segredos fora do ambiente), grava o texto
#                                           da última resposta em -Saida e devolve o código
#   Test-CotaChatGPTNoLog <log>           : o run parou porque a janela da assinatura do ChatGPT acabou
#
# A trava só leitura é a do executor do despachar.ps1 apertada: nada de edit, nem de comando que não seja git
# de leitura. O modelo lê, lista, busca e grava nada; o pacote vai anexado (--file), que não passa pela trava.
# Testado em 2026-10-24 (OpenCode 2.1.4).

function Get-OpenCodeExe {
  $oc = "$env:LOCALAPPDATA\Programs\@opencodedesktop\resources\opencode-cli.exe"
  if (-not (Test-Path $oc)) { $oc = (Get-Command opencode -ErrorAction SilentlyContinue).Source }
  $oc
}

function Set-AmbienteOpenCode([string]$casa) {
  $env:OPENCODE_CONFIG_DIR = $casa; $env:OPENCODE_DISABLE_PROJECT_CONFIG = '1'
  $env:OPENCODE_DISABLE_CLAUDE_CODE = '1'; $env:OPENCODE_DISABLE_AUTOUPDATE = '1'
}
function Clear-AmbienteOpenCode {
  Remove-Item Env:\OPENCODE_CONFIG_DIR, Env:\OPENCODE_DISABLE_PROJECT_CONFIG, Env:\OPENCODE_DISABLE_CLAUDE_CODE,
    Env:\OPENCODE_DISABLE_AUTOUPDATE -ErrorAction SilentlyContinue
}

function Get-ModelosOpenCode([string]$oc, [string]$casa = '') {
  # Com uma config vazia (ou a casa que o script já montou): o opencode.json do usuário carregaria os MCP dele.
  $temp = -not $casa
  if ($temp) { $casa = "$env:LOCALAPPDATA\dupla\opencode-modelos\$PID"; New-Item -ItemType Directory -Force $casa | Out-Null }
  Set-AmbienteOpenCode $casa
  try { @(& $oc models --standalone 2>$null | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^(anthropic|openai)/' }) }
  finally { Clear-AmbienteOpenCode; if ($temp) { Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue } }
}

function Get-GptMaisNovo($lista, [string]$familia) {
  # openai/gpt-<maior>[.<menor>]-<família>; o -fast (o dobro do custo de janela) fica de fora.
  $padrao = "^openai/gpt-(\d+(?:\.\d+)?)-$familia$"
  $lista | Where-Object { $_ -match $padrao } | ForEach-Object {
    $null = $_ -match $padrao; $v = $Matches[1]; if ($v -notmatch '\.') { $v += '.0' }
    [pscustomobject]@{ id = $_; v = [version]$v }
  } | Sort-Object v -Descending | Select-Object -First 1 -ExpandProperty id
}

function Get-ClaudeMaisNovo($lista, [string]$familia) {
  # anthropic/claude-<família>-<maior>[-<menor>]; o que tem data (-20251001) ou -fast fica de fora.
  $padrao = "^anthropic/claude-$familia-(\d+)(?:-(\d{1,2}))?$"
  $lista | Where-Object { $_ -match $padrao } | ForEach-Object {
    $null = $_ -match $padrao; [pscustomobject]@{ id = $_; v = [version]"$($Matches[1]).$(if ($Matches[2]) { $Matches[2] } else { 0 })" }
  } | Sort-Object v -Descending | Select-Object -First 1 -ExpandProperty id
}

function Get-ModeloExecutorOpenCode([string[]]$Catalogo, [string]$Minima) {
  # Assinatura do ChatGPT primeiro (Luna N1, Terra N2, Sol N3); Opus pelo credito da API so quando o Sol
  # falta no N3. Astra, Fable e Argon nao executam (usuário, 2026-11-03).
  $familiasExecutor = switch ($Minima) { 'N1' { 'luna'; 'terra' }; 'N2' { 'terra'; 'sol' }; 'N3' { 'sol'; 'opus' }; default { throw 'Capacidade minima invalida.' } }
  foreach ($familiaExecutor in $familiasExecutor) {
    $candidatoExecutor = if ($familiaExecutor -in 'luna', 'terra', 'sol') {
      Get-GptMaisNovo $Catalogo $familiaExecutor
    } else { Get-ClaudeMaisNovo $Catalogo $familiaExecutor }
    if (-not $candidatoExecutor) { continue }
    try { $null = Assert-CapacidadeModelo $candidatoExecutor $Minima }
    catch { continue }
    return $candidatoExecutor
  }
  throw "OpenCode sem executor compativel com $Minima; Astra reservado a revisao. Preserve o piso e use outra fonte autorizada."
}

function New-CasaOpenCodeLeitura([string]$modelo, [string]$pequeno, [string]$nome = 'opencode-ler', [int]$passos = 60) {
  # Permissões (OpenCode v2: lista de regras, a última que casa vence; * cruza a barra). Tudo negado, depois
  # só ler, listar e buscar na pasta do projeto, e os comandos git de leitura. Negados por omissão: edit,
  # subagente, execute (Code Mode), web, skill, pergunta e todo MCP. O grep entra (o revisor precisa achar
  # o que o pacote cita); o nome de arquivo de segredo o plugin segredos barra, mas o conteúdo de um .env
  # pode aparecer numa busca por texto: a revisão fica com quem despachou, não vai ao projeto.
  $regras = New-Object Collections.ArrayList
  function Regra([string]$a, [string]$r, [string]$e) { [void]$regras.Add([ordered]@{ action = $a; resource = $r; effect = $e }) }
  Regra '*' '*' 'deny'
  foreach ($a in 'read', 'glob', 'grep', 'list') { Regra $a '*' 'allow' }
  # Um padrão terminado em " *" também casa o comando sem argumento.
  foreach ($c in 'git status *', 'git diff *', 'git log *', 'git show *', 'git blame *', 'git ls-files *', 'git rev-parse *') { Regra 'shell' $c 'allow' }
  # Caminho fora da pasta na linha: só caminho relativo, sem subir de pasta. O intervalo a..b do git volta
  # logo abaixo, ANTES das negações de opção, segredo e redirecionamento, que seguem vencendo (a última regra
  # que casa vence; o gpt-review de 2026-10-24 pegou a ordem errada): o git não lê fora do repositório sem
  # --no-index, --work-tree ou --git-dir.
  foreach ($c in '*:\*', '*:/*', '*..*', '*~*', '* /*', '* \*', '*=/*', '*=\*', '*"/*', '*"\*', "*'/*", "*'\*") { Regra 'shell' $c 'deny' }
  foreach ($c in 'git diff *..*', 'git log *..*', 'git show *..*') { Regra 'shell' $c 'allow' }
  # O allow do intervalo reabre o que foi negado antes dele, então as negações de caminho fora da pasta
  # voltam DEPOIS: absoluto (`C:/fora/nota..txt` casava o `*..*`, Astra 2ª rodada de 2026-10-24) e
  # subida de pasta (`../fora.txt`; o intervalo a..b nunca tem barra, espaço ou fim de linha após os
  # pontos). O git compara caminho fora do repositório sem pedir --no-index.
  # `~` só como início de caminho (`~/`, `~\`): HEAD~1..HEAD é intervalo legítimo.
  foreach ($c in '*:\*', '*:/*', '*~/*', '*~\*', '* /*', '* \*', '*=/*', '*=\*', '*"/*', '*"\*', "*'/*", "*'\*",
    '*../*', '*..\*', '*.. *', '*..') { Regra 'shell' $c 'deny' }
  # Opção que faz o git gravar, rodar programa ou ler arquivo solto: fora.
  foreach ($c in 'git *--output*', 'git *--no-index*', 'git *--ext-diff*', 'git *--textconv*', 'git *-c *', 'git *--exec-path*',
    'git *--work-tree*', 'git *--git-dir*') { Regra 'shell' $c 'deny' }
  # Nome de arquivo de segredo na linha: o git show HEAD:.env lê sem passar pelo read.
  foreach ($c in '*.env*', '*.pem*', '*.key*', '*.p12*', '*.pfx*', '*.kdbx*', '*.ppk*', '*id_rsa*', '*id_ed25519*',
    '*credentials*', '*secret.*', '*secrets.*', '*recovery-key*', '*.claude.json*', '*mcp_config*', '*service.json*') { Regra 'shell' $c 'deny' }
  # Redirecionamento e subexpressão: o padrão casa a linha inteira (o despachar.ps1 viu um > gravar fora da pasta).
  foreach ($c in '*>*', '*<*', '*$*', '*%*', '*`*', '*&*', '*(*', '*)*', '*{*', '*}*', '*@*', '*|*', '*;*') { Regra 'shell' $c 'deny' }
  # Segredos e pastas internas: a lista de read do opencode.json do usuário, mais .git e .opencode.
  foreach ($s in '*.env', '*.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.kdbx', '*.ppk', '*recovery-key*', '*/id_*',
    '*credentials', '*credentials.*', '*secret.*', '*secrets.*', '*.claude.json', '*mcp_config.json', '*service.json',
    '.git/*', '*/.git/*', '.opencode/*', '*/.opencode/*') { Regra 'read' $s 'deny' }
  foreach ($s in '*.env.example', '*.env.sample', '*.env.template', '*.env.dist', '*/id_*.pub') { Regra 'read' $s 'allow' }
  Regra 'edit' '*' 'deny'
  Regra 'external_directory' '*' 'deny'
  # Saída longa de ferramenta, que o OpenCode guarda fora do projeto e relê.
  Regra 'external_directory' '~/.local/share/opencode/tool-output/*' 'allow'
  Regra 'external_directory' "$($env:USERPROFILE -replace '\\', '/')/.local/share/opencode/tool-output/*" 'allow'
  # Sem a trava inteira, não roda: regra perdida vira a base do OpenCode, que libera tudo.
  if ($regras.Count -lt 70 -or $regras[0].action -ne '*' -or $regras[0].effect -ne 'deny' -or
    -not ($regras | Where-Object { $_.action -eq 'edit' -and $_.resource -eq '*' -and $_.effect -eq 'deny' })) {
    throw "trava só leitura do opencode incompleta ($($regras.Count) regras)"
  }
  $baseCasas = [IO.Path]::GetFullPath("$env:LOCALAPPDATA\dupla").TrimEnd('\') + '\'
  $raizCasas = [IO.Path]::GetFullPath((Join-Path $baseCasas $nome)).TrimEnd('\') + '\'
  if ($raizCasas -eq $baseCasas -or -not $raizCasas.StartsWith($baseCasas, [StringComparison]::OrdinalIgnoreCase)) { throw 'raiz da casa isolada invalida' }
  $casa = [IO.Path]::GetFullPath((Join-Path $raizCasas ("$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID-" + [guid]::NewGuid())))
  if (-not $casa.StartsWith($raizCasas, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $casa)) {
    throw 'caminho da casa isolada invalido ou ja existente'
  }
  try {
    New-Item -ItemType Directory -Force "$casa\plugins" -ErrorAction Stop | Out-Null
    # O plugin segredos do usuário vai junto: cobre o grep e o shell pelo nome do arquivo.
    $segredos = "$env:USERPROFILE\.config\opencode\plugins\segredos.ts"
    if (-not (Test-Path -LiteralPath $segredos)) { throw "sem o plugin $segredos, que barra segredo: não chamo" }
    Copy-Item -LiteralPath $segredos -Destination "$casa\plugins\" -ErrorAction Stop
    $json = [ordered]@{
      '$schema' = 'https://opencode.ai/config.json'
      model = $modelo; small_model = $pequeno; instructions = @()
      permissions = $regras; agents = @{ build = @{ steps = $passos; permissions = $regras } }
    } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText("$casa\opencode.json", $json, (New-Object System.Text.UTF8Encoding($false)))
    $casa
  } catch {
    $falhaCasa = $_
    # So a pasta unica desta chamada; nunca apague a raiz nem siga um junction no alvo.
    try {
      $alvoCasa = [IO.Path]::GetFullPath($casa)
      if (-not $alvoCasa.StartsWith($raizCasas, [StringComparison]::OrdinalIgnoreCase)) { throw 'limpeza fora da raiz isolada' }
      if (Test-Path -LiteralPath $alvoCasa) {
        if ((Get-Item -LiteralPath $alvoCasa -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'alvo da limpeza e junction/symlink' }
        Remove-Item -LiteralPath $alvoCasa -Recurse -Force -ErrorAction Stop
      }
    } catch { Write-Warning "casa parcial mantida: $($_.Exception.Message)" }
    throw $falhaCasa
  }
}

function Invoke-OpenCodeRun([string]$oc, [string]$pasta, [string]$casa, [string]$modeloVariante, [string]$arquivo,
  [string]$prompt, [string]$saida, [string]$log, [string]$titulo, [int]$maxMin = 20) {
  $fonteRun = Get-FonteOpenCode $modeloVariante
  if ($fonteRun -eq 'desconhecida') { return [pscustomobject]@{ codigo = 2; sessao = ''; corte = 'argumento'; modelo = '' } }
  if (-not (Test-FonteConsumo $fonteRun $saida)) { return [pscustomobject]@{ codigo = 3; sessao = ''; corte = 'fonte-travada'; modelo = '' } }
  # O run vai por um .cmd (aspas aninhadas direto ao cmd pelo PowerShell 5.1 quebram), com a config da casa
  # e os segredos do ambiente apagados (um comando lê os.environ). O JSON de eventos fica em <saida>.jsonl;
  # o texto da última mensagem do modelo vai a -Saida. Passou de -maxMin, a árvore do processo cai.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  function Q([string]$s) { '"' + $s + '"' }
  $jsonl = "$saida.jsonl"
  $envs = "set `"OPENCODE_CONFIG_DIR=$casa`"`r`nset `"OPENCODE_DISABLE_PROJECT_CONFIG=1`"`r`nset `"OPENCODE_DISABLE_CLAUDE_CODE=1`"`r`n" +
    "set `"OPENCODE_DISABLE_AUTOUPDATE=1`"`r`n" +
    ((Get-ChildItem env: | Where-Object { $_.Name -match 'KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL' } | ForEach-Object { "set `"$($_.Name)=`"`r`n" }) -join '')
  $anexo = if ($arquivo) { "--file $(Q $arquivo) " } else { '' }
  $linha = "cd /d $(Q $pasta) && $(Q $oc) run --standalone --auto --format json -m $modeloVariante --title $(Q $titulo) " +
    "$anexo$(Q $prompt) > $(Q $jsonl) 2> $(Q $log)"
  $bat = "$saida.cmd"
  [IO.File]::WriteAllText($bat, "@echo off`r`nchcp 65001 > nul`r`n$envs$linha`r`n", $utf8)
  if (-not (Test-FonteConsumo $fonteRun $saida)) {
    return [pscustomobject]@{ codigo = 3; sessao = ''; corte = 'fonte-travada'; modelo = '' }
  }
  $proc = Start-Process cmd.exe -ArgumentList '/d', '/c', (Q $bat) -NoNewWindow -PassThru
  $null = $proc.Handle  # sem ler o Handle já, o ExitCode do Start-Process volta vazio
  $corte = ''
  if (-not $proc.WaitForExit($maxMin * 60000)) {
    taskkill /PID $proc.Id /T /F 2>&1 | Out-Null; $proc.WaitForExit(); $corte = "passou de $maxMin minutos"
  }
  $codigo = $proc.ExitCode
  $eventos = @(if (Test-Path $jsonl) { Get-Content -LiteralPath $jsonl -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } })
  $textos = @($eventos | Where-Object { $_.type -eq 'text' -and $_.part.text })
  if ($textos.Count) {
    $ultima = $textos[-1].part.messageID
    [IO.File]::WriteAllText($saida, (($textos | Where-Object { $_.part.messageID -eq $ultima } | ForEach-Object { $_.part.text }) -join "`r`n`r`n"), $utf8)
  }
  # Evento de erro é falha mesmo com texto parcial e código 0; a mensagem vai ao log, junto do stderr.
  $erros = @($eventos | Where-Object { $_.type -eq 'error' } | ForEach-Object { "erro do OpenCode: $($_.error.type): $($_.error.message)" })
  if ($corte) { $erros += "opencode cortado: $corte" }
  if ($erros.Count) { [IO.File]::AppendAllText($log, "`r`n" + ($erros -join "`r`n") + "`r`n", $utf8); if ($codigo -eq 0) { $codigo = 1 } }
  $sid = ($eventos | Where-Object { $_.sessionID } | Select-Object -First 1).sessionID
  # A sessão do run fica na barra do OpenCode como terminada; arquiva-se já, com 🗄️, para a barra
  # mostrar só o que está vivo ou espera o usuário (usuário, 2026-10-24). Falha aqui não muda o resultado.
  if ($sid) {
    # O PowerShell 5.1 entrega as aspas do JSON sem escape ao processo (HTTP 400): o patch vai por um .cmd
    # com \" escapado, como as notas do OpenCode mandam. Emoji não passa pelo cmd: marca em ASCII.
    $dados = (@{ title = "[arquivada] $titulo"; archived = $true } | ConvertTo-Json -Compress) -replace '"', '\"'
    $batArq = "$saida.arquivar.cmd"
    [IO.File]::WriteAllText($batArq, "@echo off`r`n$(Q $oc) api patch /api/session/$sid --data `"$dados`"`r`n", $utf8)
    cmd /d /c (Q $batArq) 2>&1 | Out-Null
  }
  $mod = Write-ModeloReal $saida $modeloVariante $sid
  [pscustomobject]@{ codigo = $codigo; sessao = $sid; corte = $corte; modelo = $mod }
}

# O modelo pedido contra o que a sessão usou de fato (session_v2.model no banco do OpenCode, pelo
# opencode_custo.py). Vai a <saida>.modelo, em duas linhas "pedido: ..." e "real: ...", para o painel
# orquestra; o texto volta para o rodapé. No agy não há de onde ler: real "não informado" (sid vazio).
function Write-ModeloReal([string]$saida, [string]$pedido, [string]$sid, [string]$real = '') {
  if (-not $real) {
    $real = 'não lido'
    $py = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
    if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
    if ($sid -and $py) {
      $r = & $py -I -X utf8 (Join-Path $PSScriptRoot 'opencode_custo.py') modelo $sid 2>$null
      if ("$r".Trim()) { $real = "$r".Trim() }
    }
  }
  # Sem a variante no banco, compara só o modelo.
  $p = $pedido -split '#', 2; $q = $real -split '#', 2
  $difere = $real -notin 'não lido', 'não informado' -and ($p[0] -ne $q[0] -or ($p.Count -gt 1 -and $q.Count -gt 1 -and $p[1] -ne $q[1]))
  # Pasta da saída ausente ou travada não derruba o script: o .modelo é só para o painel.
  try { [IO.File]::WriteAllText("$saida.modelo", "pedido: $pedido`r`nreal: $real`r`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }
  "modelo pedido $pedido, real $real$(if ($difere) { ' ⚠️ difere' })"
}

function Test-CotaChatGPTNoLog([string]$log) {
  # A janela da assinatura do ChatGPT acabou no meio: o erro vem do provedor openai, no evento de erro do run.
  if (-not (Test-Path -LiteralPath $log)) { return $false }
  [bool](Get-Content -LiteralPath $log -Tail 20 -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match 'usage.?limit|rate.?limit|insufficient_quota|quota exceeded|too many requests' })
}
