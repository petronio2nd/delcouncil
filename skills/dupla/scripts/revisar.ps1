# Chama um modelo de OUTRA FAMÍLIA que a do autor como revisor, só leitura, e grava a revisão num arquivo.
# Uso: powershell -ExecutionPolicy Bypass -File revisar.ps1 -Autor claude|gpt|gemini [-Revisor gpt|claude|gemini]
#        [-Papel revisor|arbitro] -Pasta <projeto> -Pacote <pacote.md> -Saida <revisao.md> [-Nivel L0|L1|L2] [-Diff <ref>]
#        [-Topo] [-Economia] [-UsuarioPediu] [-SemReserva]
#   -Autor          : a família do modelo que escreveu a entrega (claude, gpt ou gemini; codex vale como gpt). Tanto
#                     faz o harness (Claude Code ou OpenCode): o que conta é a família (usuário, 2026-10-24).
#   -Revisor        : preferência opcional. Reservas automáticas: autor claude -> gpt -> gemini;
#                     autor gpt -> gemini -> claude; autor gemini -> gpt -> claude. Uma tentativa por família.
#                     Igual à do autor sai com 2. -SemReserva restringe à preferência, sem dispensar revisão.
#                     gpt    : o GPT-Astra mais novo pelo OpenCode (opencode-cli run --standalone, trava só leitura
#                              do opencode-comum.ps1), na janela da assinatura do ChatGPT
#                     claude : o Fable pelo claude -p, só ferramentas de leitura
#                     gemini : o Gemini pelo Antigravity CLI (agy -p, --mode plan); Argon N3; sem ele, arbitragem pendente
#                     openrouter : outra família pelo OpenRouter; só se o usuário pedir (2026-10-22: sem verba)
#   -Papel arbitro  : desempata os achados recusados. Sempre a TERCEIRA família, nem a do autor nem a de quem
#                     revisou; aqui o -Revisor nomeia a família que ARBITRA (seção 3b da skill). -Revisou diz quem
#                     revisou (obrigatório, da rota real); sem -Revisor, o árbitro é a que sobra. -Revisor
#                     igual ao autor ou a quem revisou sai com 2.
#   -Revisou        : só com -Papel arbitro: a família que fez a revisão (claude, gpt ou gemini).
#   -Nivel          : L0 = sem revisão cruzada (grava "L0: sem revisor" e sai 0); L1 = padrão; L2 = -Topo implícito.
#                     Sem -Nivel, calcula pelo diff da pasta (o que não foi commitado; árvore limpa, o último commit;
#                     -Diff <ref> troca por um commit ou intervalo a..b): L2 se algum caminho casar com
#                     migra|migration|.env|secret|segredo|prod|deploy|delete|apagar|pagamento|banco|.sql|ofx.
#                     Exemplos .env.example/sample/template/dist e *.pub sao publicos; outros termos/diretorios
#                     continuam contando. Nomes de segredo, inclusive app.env e dados credentials, sempre L2.
#                     ou o diff passar de 400 linhas; L0 se só .md/.txt e menos de 30 linhas; senão L1.
#                     A primeira linha diz nivel/motivo. So -Topo promove L0 e eleva esforco.
#   -SoNivel        : só calcula e imprime o nível (com o motivo) e sai 0, sem chamar revisor: para conferir a régua.
#   Esforco: politica-modelos.json; Astra, Fable e Argon medium em L1, high em L2 ou Topo (usuário, 2026-11-07).
#   -Topo: escala esforco sem reduzir por cota; fonte esgotada usa reserva.
#   -Economia/-UsuarioPediu: compatibilidade com chamadores; nao reduzem o piso de revisao.
# Sai com 0 e parecer completo (ou L0 dispensado/-SoNivel); com 2 por argumento invalido ou recusa
# de seguranca do provedor (sem reserva); falha ambiental de isolamento nao chama a familia e sai 3,
# permitindo outra familia elegivel com suas proprias travas. Sem parecer, etapa pendente.
# Cada tentativa fica ao lado da saída; <Saida>.rota.json registra família real e estado.
#
# Claude: o pacote vai pela entrada padrão; o cmd faz o < e o > em bytes crus, o que preserva o UTF-8 que o
# PowerShell 5.1 estragaria num pipe. gpt e gemini: a skill revisor e o pacote vão num arquivo ao lado da saída.

param(
  [Parameter(Mandatory)][ValidateSet('claude', 'gpt', 'gemini', 'codex')][string]$Autor,
  [ValidateSet('gpt', 'claude', 'gemini', 'openrouter', 'codex')][string]$Revisor = '',
  [ValidateSet('revisor', 'arbitro')][string]$Papel = 'revisor',
  [ValidateSet('claude', 'gpt', 'gemini', 'codex', '')][string]$Revisou = '',
  [Parameter(Mandatory)][string]$Pasta,
  [Parameter(Mandatory)][string]$Pacote,
  [Parameter(Mandatory)][string]$Saida,
  [ValidateSet('L0', 'L1', 'L2')][string]$Nivel = '',
  [string]$Diff = '',
  [switch]$SoNivel,
  [switch]$Economia,
  [switch]$Topo,
  [switch]$UsuarioPediu,
  [switch]$SemReserva,
  [switch]$TentativaUnica
)

function Q([string]$s) { '"' + $s + '"' }
. (Join-Path $PSScriptRoot 'cota.ps1')
. (Join-Path $PSScriptRoot 'opencode-comum.ps1')
. (Join-Path $PSScriptRoot 'revisao-comum.ps1')
. (Join-Path $PSScriptRoot 'politica-modelos.ps1')

# Família: codex é o nome antigo do canal GPT.
if ($Autor -eq 'codex') { $Autor = 'gpt' }
if ($Revisor -eq 'codex') { $Revisor = 'gpt' }
if ($Revisou -eq 'codex') { $Revisou = 'gpt' }
# Claude -> Astra; GPT -> Argon; Gemini -> Astra; falta de cota ou parecer aciona a outra família elegível (usuário, 2026-11-07).
try { $rotas = @(Get-RotasRevisao -Autor $Autor -Revisor $Revisor -Papel $Papel -Revisou $Revisou -SemReserva:$SemReserva) }
catch { Write-Output $_.Exception.Message; exit 2 }
$Revisor = $rotas[0]
# Quem roda de fato: no árbitro, o -Revisor é a família que arbitra (quem chama sabe quem revisou).
$motor = $Revisor

if (-not (Test-Path -LiteralPath $Pasta -PathType Container)) { Write-Output "pasta não encontrada: $Pasta"; exit 2 }
if (-not (Test-Path -LiteralPath $Pacote -PathType Leaf)) { Write-Output "pacote não encontrado: $Pacote"; exit 2 }
$Pasta = (Resolve-Path $Pasta).Path
$Pacote = (Resolve-Path $Pacote).Path
# Absoluto: o .cmd do Claude troca de pasta antes de gravar, e a conferência no fim procura aqui.
$Saida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Saida)
$log = "$Saida.log"
# O .modelo de uma rodada anterior com a mesma -Saida não pode ficar com o revisor desta (revisão do GPT).
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Nível pelo risco da entrega, quando não veio na linha (só no papel de revisor: o árbitro desempata o que
# já foi revisado).

try {
  # Uma referencia explicita invalida e erro mesmo com -Nivel ou papel de arbitro.
  $nDiff = if ($Diff) { Get-NivelDiff $Pasta $Diff } else { $null }
  if ($Nivel) { $motivo = 'pedido na linha' }
  elseif ($Papel -eq 'arbitro') { $Nivel = 'L1'; $motivo = 'árbitro' }
  else {
    $n = if ($nDiff) { $nDiff } else { Get-NivelDiff $Pasta $Diff }
    $Nivel = $n.nivel; $motivo = $n.motivo
  }
} catch [ArgumentException] { Write-Output $_.Exception.Message; exit 2 }
if ($SoNivel) {
  if ($motor -eq 'openrouter') { Write-Output "nível $Nivel ($motivo); autor $Autor, $Papel $motor"; exit 0 }
  $esforcoPrevia = if ($Nivel -eq 'L0' -and -not $Topo) { 'sem revisor' } else {
    $familiaPrevia = if ($motor -in 'gpt', 'claude', 'gemini') { $motor } else { '' }
    Get-EsforcoModelo -Capacidade N3 -Papel $Papel -Risco $Nivel -Escalar:$Topo -Familia $familiaPrevia
  }
  Write-Output "nível $Nivel ($motivo); autor $Autor, $Papel $motor; esforço $esforcoPrevia"; exit 0
}
if (-not $TentativaUnica -and ($Nivel -ne 'L0' -or $Topo)) {
  $scriptRevisar = $PSCommandPath
  $shellRevisar = (Get-Process -Id $PID).Path
  $codigoReserva = Invoke-RevisaoComReserva -Rotas $rotas -Saida $Saida -Papel $Papel -PacoteSha256 (Get-FileHash -LiteralPath $Pacote -Algorithm SHA256).Hash -Executar {
    param($familia, $arquivo)
    $parametros = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptRevisar,
      '-Autor', $Autor, '-Revisor', $familia, '-Papel', $Papel, '-Pasta', $Pasta,
      '-Pacote', $Pacote, '-Saida', $arquivo, '-Nivel', $Nivel, '-TentativaUnica')
    if ($Revisou) { $parametros += @('-Revisou', $Revisou) }
    if ($Topo) { $parametros += '-Topo' }
    if ($Economia) { $parametros += '-Economia' }
    if ($UsuarioPediu) { $parametros += '-UsuarioPediu' }
    & $shellRevisar @parametros | ForEach-Object { Write-Host $_ }
    $LASTEXITCODE
  }
  exit $codigoReserva
}
# Só daqui em diante a saída anterior sai: o -SoNivel não mexe nela.
Remove-Item -LiteralPath "$Saida.modelo", "$Saida.rota.json", "$Saida.nivel.json", "$Saida.fonte.json" -ErrorAction SilentlyContinue
if (Test-Path $Saida) { Remove-Item $Saida }
if ($Nivel -eq 'L0' -and -not $Topo) {
  Write-Output "nível L0 ($motivo): sem revisor"
  [IO.File]::WriteAllText($Saida, "L0: sem revisor ($motivo)`r`n", $utf8)
  exit 0
}
# A tentativa direta e cada reserva consultam o estado antes de provar permissoes/cota.
$fonteConsumo = @{ gpt = 'chatgpt'; claude = 'claude-max'; gemini = 'antigravity'; openrouter = 'openrouter' }[$motor]
if (-not (Test-FonteConsumo $fonteConsumo $Saida)) { exit 3 }
# Variáveis com nome diferente do parâmetro: no PowerShell $economia e $Economia são a mesma coisa.
$perfilGasto = & (Join-Path $PSScriptRoot 'perfil.ps1') -Ler
if ($perfilGasto.perfil -eq 'economia') {
  Write-Output "$($perfilGasto.texto); economia preserva o piso da revisao N3 pelo risco"
}
$noTopo = [bool]$Topo -or $Nivel -eq 'L2'
if ($Nivel -eq 'L0') { $Nivel = 'L1'; $motivo += '; -Topo na linha, revisão feita' }
Write-Output "nível $Nivel ($motivo); autor $Autor, revisor $Revisor, papel $Papel -> $motor"

# Prompt só em ASCII; o conteúdo com acento vem no pacote.
$prompt = 'Siga a skill revisor. O pacote desta revisao vem no bloco stdin abaixo. O projeto e a pasta atual. Responda so no formato de saida da skill.'
if ($Papel -eq 'arbitro') {
  $prompt = 'Siga a skill revisor, no papel de arbitro. O pacote vem no bloco stdin abaixo. O projeto e a pasta atual. Responda so no formato da secao Papel de arbitro.'
}
$skill = Join-Path $PSScriptRoot '..\..\revisor\SKILL.md' | Resolve-Path
$papelTxt = if ($Papel -eq 'arbitro') { 'no papel de arbitro, e responda so no formato da secao Papel de arbitro' } else { 'e responda so no formato de saida da skill' }
$linha = ''

if ($motor -eq 'gpt') {
  # GPT pelo OpenCode, na janela da assinatura do ChatGPT (a mesma do Codex de antes). Modelo: o GPT-Astra mais
  # novo de `opencode models` (nunca -fast); esforco da politica: medium em L1, high em L2 ou -Topo;
  # cota nao reduz piso. Esforco vai como variante (-m openai/<modelo>#<esforço>).
  $oc = Get-OpenCodeExe
  if (-not $oc) { Write-Output 'opencode-cli.exe não encontrado (app OpenCode desktop)'; exit 1 }
  $lista = @(Get-ModelosOpenCode $oc)
  $modelo = Get-GptMaisNovo $lista 'astra'
  if (-not $modelo) { Write-Output "opencode models sem openai/gpt-*-astra (login do ChatGPT no OpenCode?); há: $($lista -join ', ')"; exit 1 }
  # Cota esgotada aciona reserva, sem reduzir capacidade ou esforco exigidos.
  foreach ($j in @(Get-CotaChatGPT)) {
    if (-not $j.aberta) { continue }
    if ($j.usada -ge 100) {
      Write-Output "janela do ChatGPT zerada (janela $($j.janela) em 100%, volta $(Format-Volta $j.volta), fonte $($j.fonte)): tentativa indisponível; revisão usa a reserva elegível, arbitragem fica pendente sem terceira família"
      exit 3
    }
    if ($j.usada -ge 80) { Write-Output "cota do ChatGPT, janela $($j.janela): $($j.usada)% usada; piso N3 mantido; falta de cota aciona reserva" }
  }
  $esforco = Get-EsforcoModelo -Capacidade N3 -Papel $Papel -Risco $Nivel -Escalar:$noTopo -Familia gpt
  try { Write-RotaModelo $Saida $modelo $esforco 'N3' $Papel } catch { Write-Output $_.Exception.Message; exit 3 }
  $entrada = "$Saida.entrada.md"
  $bytes = [IO.File]::ReadAllBytes($skill) + [byte[]](13, 10, 13, 10) + [IO.File]::ReadAllBytes($Pacote)
  [IO.File]::WriteAllBytes($entrada, $bytes)
  $pequeno = Get-GptMaisNovo $lista 'luna'
  if (-not $pequeno) { $pequeno = $modelo }
  try { $casa = New-CasaOpenCodeLeitura $modelo $pequeno 'opencode-revisar' }
  catch { Write-Output "isolamento local do OpenCode indisponivel: $($_.Exception.Message); familia nao sera chamada"; exit 3 }
  $prompt = "O arquivo anexo traz a skill revisor e, depois dela, o pacote: leia por inteiro. Siga a skill, $papelTxt. " +
    "O projeto e a pasta atual ($Pasta): so leitura, com caminhos relativos; pode rodar so git status, diff, log, show e blame. Nao edite nem crie arquivos."
  Write-Output "revisor: opencode $modelo#$esforco, papel $Papel, config $casa"
  $r = Invoke-OpenCodeRun $oc $Pasta $casa "$modelo#$esforco" $entrada $prompt $Saida $log "dupla revisar $(Split-Path $Pasta -Leaf)" 20
  $codigo = $r.codigo
  Write-Output $r.modelo
  if ($codigo -eq 0 -or ($codigo -eq 3 -and $r.corte -eq 'fonte-travada')) { Remove-Item -LiteralPath $casa -Recurse -Force -ErrorAction SilentlyContinue }
  else { Write-Output "config do opencode mantida para depurar: $casa" }
} elseif ($motor -eq 'gemini') {
  # Gemini pelo Antigravity CLI (agy), com o login Google AI Pro do usuário: o Gemini CLI não aceita mais
  # conta pessoal (2026-06). Só leitura pelo settings.json do agy (deny de write_file, command, url e
  # mcp), mais --mode plan. O agy -p não lê a entrada padrão: a skill revisor e o pacote vão num arquivo
  # ao lado da saída, liberado com --add-dir, e o prompt manda ler esse arquivo.
  $agy = "$env:LOCALAPPDATA\agy\bin\agy.exe"
  if (-not (Test-Path $agy)) { $agy = (Get-Command agy -ErrorAction SilentlyContinue).Source }
  if (-not $agy) { Write-Output 'agy não encontrado (irm https://antigravity.google/cli/install.ps1 | iex)'; exit 1 }
  # A trava são as cinco regras de deny, conferidas como o agy as lê (/permissions no -p não gasta cota),
  # como no despachar.ps1. Ler o JSON pelo PowerShell não basta: em 2026-10-22 o arquivo ganhou BOM, o agy
  # deixou de ler o deny inteiro e o JSON ainda parecia certo. unsandboxed(*) saiu no mesmo dia: o agy
  # passou a recusar essa regra como inválida; command(*) já cobre.
  $trava = 'write_file(*)', 'command(*)', 'execute_url(*)', 'read_url(*)', 'mcp(*)'
  # Na pasta do projeto, onde a revisão roda: um settings.json de projeto lá também conta.
  Push-Location $Pasta
  try { $perm = @(& $agy -p '/permissions' 2>$null) } finally { Pop-Location }
  $faltam = @($trava | Where-Object { $r = $_; -not ($perm | Where-Object { $_ -match "\bdeny\b\s+$([regex]::Escape($r))\s*$" }) })
  if ($faltam.Count) {
    Write-Output "agy sem só leitura: o agy não lê deny de $($faltam -join ', ') em ~\.gemini\antigravity-cli\settings.json (arquivo ausente, JSON inválido ou com BOM?); familia nao sera chamada"; exit 3
  }
  # Modelo: sempre o Argon mais novo, não o Flash (usuário, 2026-10-09: no único teste de revisão achado, o
  # Flash escreve bonito e erra a lógica). Esforço da política (usuário, 2026-11-07): medium em L1, high em L2
  # ou -Topo; variante ausente só sobe. Sem Argon na lista, para: o agy roda o modelo padrão quando não
  # reconhece o nome (2026-10-18 entrou o 4 Argon; o Pro saiu da política em 2026-11-03).
  $lista = @(& $agy models 2>$null | ForEach-Object { ($_ -split '\s+')[0] })
  $esforco = Get-EsforcoModelo -Capacidade N3 -Papel $Papel -Risco $Nivel -Escalar:$noTopo -Familia gemini
  $baseArgon = $lista | Where-Object { $_ -match '^gemini-\d+(\.\d+)?-argon-(low|medium|high)$' } |
    ForEach-Object { $_ -replace '-(low|medium|high)$', '' } | Sort-Object -Unique |
    Sort-Object @{ Expression = { $v = ($_ -replace '^gemini-|-argon$', ''); if ($v -notmatch '\.') { $v += '.0' }; [version]$v }; Descending = $true } |
    Select-Object -First 1
  $modelo = $null
  if ($baseArgon) { try { $modelo = Select-VarianteAgy $baseArgon $esforco $lista } catch { $modelo = $null } }
  # Cota antes de chamar: limite próprio do Argon e os do grupo Gemini (5 h e semanal).
  $cotas = @(Get-CotaAgy $agy)
  $grupo = @($cotas | Where-Object { $_.resta -le 0 -and $_.grupo -eq 'Gemini Models' })
  if ($grupo.Count) {
    Write-Output "cota do Gemini no agy zerada ($(($grupo | ForEach-Object { "$($_.nome), volta $(Format-Volta $_.volta)" }) -join '; ')): tentativa indisponível; o coordenador usa a reserva elegível"
    exit 3
  }
  # Sem Argon N3 disponivel, nao rebaixar para Flash.
  $semTopo = if (-not $modelo) { "sem Argon com esforço $esforco ou acima na lista" } else {
    $z = $cotas | Where-Object { $_.resta -le 0 -and $modelo -match '-argon-' -and $_.grupo -match 'Argon' } | Select-Object -First 1
    if ($z) { "Argon zerado, volta $(Format-Volta $z.volta)" } }
  if ($semTopo) {
    # Revisor e arbitro preservam N3; falta de cota nao valida disputa.
    Write-Output "agy ${semTopo}: tentativa indisponível; o coordenador usa a próxima família elegível"
    exit 3
  }
  try { Write-RotaModelo $Saida $modelo $esforco 'N3' $Papel } catch { Write-Output $_.Exception.Message; exit 3 }
  $entrada = "$Saida.entrada.md"
  $bytes = [IO.File]::ReadAllBytes($skill) + [byte[]](13, 10, 13, 10) + [IO.File]::ReadAllBytes($Pacote)
  [IO.File]::WriteAllBytes($entrada, $bytes)
  $prompt = "Leia por inteiro o arquivo $entrada : ele traz a skill revisor e, depois dela, o pacote. Siga a skill, $papelTxt. O projeto e a pasta atual. Nao edite nem crie arquivos."
  Write-Output "revisor: agy $modelo, papel $Papel"
  $linha = "cd /d $(Q $Pasta) && $(Q $agy) -p $(Q $prompt) --model $modelo --mode plan --print-timeout 15m " +
    "--add-dir $(Q (Split-Path $Saida)) --output-format text > $(Q $Saida) 2> $(Q $log)"
} elseif ($motor -eq 'openrouter') {
  # Outra família pelo OpenRouter (usuário, 2026-10-13: uso pouco e complexo, qualidade antes de preço). Muse
  # Wonder da Meta; o Muse Spark 1.3 e o Qwen3.8 Max só entram se ele não responder.
  $modelos = 'meta/muse-wonder,meta/muse-spark-1.3,qwen/qwen3.8-max-0902'
  $entrada = "$Saida.entrada.md"
  $bytes = [IO.File]::ReadAllBytes($skill) + [byte[]](13, 10, 13, 10) + [IO.File]::ReadAllBytes($Pacote)
  [IO.File]::WriteAllBytes($entrada, $bytes)
  Write-Output "revisor: openrouter $modelos, papel $Papel"
  $linha = "powershell -NoProfile -ExecutionPolicy Bypass -File $(Q (Join-Path $PSScriptRoot 'openrouter.ps1')) " +
    "-Pasta $(Q $Pasta) -Entrada $(Q $entrada) -Saida $(Q $Saida) -Modelos $modelos -Papel $Papel 2> $(Q $log)"
} else {
  # Só leitura de verdade: --restricted ignora as permissões dos settings do usuário e tira Bash/PowerShell;
  # --tools deixa só Read, Grep e Glob (presos à pasta do projeto); do MCP, só o ai-memory, e dele
  # só as duas ferramentas de leitura passam pelo dontAsk. Sem git, o diff vem dentro do pacote.
  $mcp = "$Saida.mcp.json"
  [IO.File]::WriteAllText($mcp, '{"mcpServers":{"ai-memory":{"type":"http","url":"http://127.0.0.1:19374/mcp"}}}', $utf8)
  # Fable N3 com piso pelo risco, conforme politica comum.
  $esforco = Get-EsforcoModelo -Capacidade N3 -Papel $Papel -Risco $Nivel -Escalar:$noTopo -Familia claude
  try { Write-RotaModelo $Saida 'fable' $esforco 'N3' $Papel } catch { Write-Output $_.Exception.Message; exit 3 }
  Write-Output "revisor: claude fable, esforço $esforco, papel $Papel"
  $linha = "cd /d $(Q $Pasta) && claude -p $(Q $prompt) --model fable --effort $esforco --restricted --tools Read Grep Glob " +
    "--strict-mcp-config --mcp-config $(Q $mcp) --permission-mode dontAsk " +
    "--allowedTools Read Grep Glob mcp__ai-memory__memory_query mcp__ai-memory__memory_read_page " +
    "--append-system-prompt-file $(Q $skill) < $(Q $Pacote) > $(Q $Saida) 2> $(Q $log)"
}

if ($linha) {
  # Vai por um .cmd ao lado da saída: passar aspas aninhadas direto ao cmd pelo PowerShell 5.1 quebra.
  $bat = "$Saida.cmd"
  [IO.File]::WriteAllText($bat, "@echo off`r`nchcp 65001 > nul`r`n$linha`r`n", $utf8)
  if (-not (Test-FonteConsumo $fonteConsumo $Saida)) { exit 3 }
  cmd /d /c (Q $bat)
  $codigo = $LASTEXITCODE
  # O agy não diz qual modelo rodou: o painel orquestra mostra o pedido e "não informado".
  if ($motor -eq 'gemini') { Write-Output (Write-ModeloReal $Saida $modelo '' 'não informado') }
  if ($motor -eq 'claude') { Write-Output (Write-ModeloReal $Saida "fable#$esforco" '' 'não informado') }
}

$vazio = -not (Test-Path $Saida) -or (Get-Item $Saida).Length -eq 0
# Cota que acabou no meio da revisão. No gpt, o erro do provedor vai ao log pelo Invoke-OpenCodeRun; no agy, o
# log é só o stderr.
$cotaMeio = ($codigo -ne 0 -or $vazio) -and (
  ($motor -eq 'gpt' -and (Test-CotaChatGPTNoLog $log)) -or
  ($motor -eq 'gemini' -and (Test-Path $log) -and (Select-String -LiteralPath $log -Pattern 'quota|RESOURCE_EXHAUSTED' -Quiet)))
if ($cotaMeio) {
  $proximo = if ($Papel -eq 'arbitro') { 'arbitragem pendente sem terceira família' } else { 'o coordenador usa a próxima família elegível' }
  Write-Output "cota do revisor $motor acabou no meio: $proximo"
  Get-Content $log -Tail 5 -Encoding UTF8 -ErrorAction SilentlyContinue
  exit 3
}
if ($codigo -eq 3 -and ($motor -eq 'openrouter' -or ($motor -eq 'gpt' -and $r.corte -eq 'fonte-travada'))) { exit 3 }
if ($codigo -ne 0 -or $vazio) {
  Write-Output "revisor $motor falhou (exit $codigo). Fim do log:"
  Get-Content $log -Tail 15 -Encoding UTF8 -ErrorAction SilentlyContinue
  exit 1
}
try { Assert-ModeloObservado $Saida 'N3' } catch { Write-Output $_.Exception.Message; exit 3 }
Write-Output "revisão gravada em $Saida"
