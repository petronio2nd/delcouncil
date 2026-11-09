# Testes offline: sem modelo, rede, segredo ou alteração no projeto revisado.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'revisao-comum.ps1')
$utf8 = New-Object Text.UTF8Encoding($false)
$raizTeste = Join-Path ([IO.Path]::GetTempPath()) ("dupla-reservas-" + [guid]::NewGuid())
New-Item -ItemType Directory $raizTeste | Out-Null
$script:casos = 0
function Confere($condicao, [string]$nome) {
  if (-not $condicao) { throw "FALHOU: $nome" }
  $script:casos++
}
# Esforcos vem do perfil em vigor (esforcos.ps1 troca o perfil; usuário, 2026-11-07).
$P = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\orquestrador\politica-modelos.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$parecerValido = "## Veredito`naprovado — casos conferidos`n`n## Achados`nnenhum achado`n`n## Não conferido`n- rede não testada`n"
foreach ($autorTeste in 'claude', 'gpt', 'gemini') {
  $rotasTeste = @(Get-RotasRevisao -Autor $autorTeste)
  Confere ($rotasTeste.Count -eq 2 -and $autorTeste -notin $rotasTeste) "duas famílias distintas do autor $autorTeste"
}
Confere ((@(Get-RotasRevisao gpt) -join ',') -eq 'gemini,claude') 'Argon → Claude para autor GPT'
Confere ((@(Get-RotasRevisao claude) -join ',') -eq 'gpt,gemini') 'Astra → Argon para autor Claude'
Confere ((@(Get-RotasRevisao claude gpt) -join ',') -eq 'gpt,gemini') 'preferência explícita preserva reserva'
Confere ((@(Get-RotasRevisao codex) -join ',') -eq 'gemini,claude') 'alias codex'
Confere ((@(Get-RotasRevisao -Autor gpt -SemReserva) -join ',') -eq 'gemini') 'opção sem reserva'
Confere ((@(Get-RotasRevisao -Autor gpt -Revisor openrouter) -join ',') -eq 'openrouter') 'pago só explícito'
foreach ($autorTeste in 'claude', 'gpt', 'gemini') {
  $recusou = $false
  try { Get-RotasRevisao $autorTeste $autorTeste | Out-Null } catch { $recusou = $true }
  Confere $recusou "recusa autor igual ao revisor $autorTeste"
}
$recusou = $false
try { Get-RotasRevisao -Autor gpt -Papel arbitro | Out-Null } catch { $recusou = $true }
Confere $recusou 'árbitro não presume a família que revisou'
Confere ((@(Get-RotasRevisao -Autor gpt -Papel arbitro -Revisou claude) -join ',') -eq 'gemini') 'árbitro usa a revisão real da reserva'
$recusou = $false
try { Get-RotasRevisao -Autor gpt -Papel arbitro -Revisou claude -Revisor claude | Out-Null } catch { $recusou = $true }
Confere $recusou 'árbitro não é o revisor'
Confere (Test-ParecerRevisao $parecerValido) 'aceita parecer completo'
Confere (Test-ParecerRevisao ($parecerValido -replace 'aprovado —', '**não comprovado** —')) 'não comprovado é parecer, não aprovação'
Confere (-not (Test-ParecerRevisao "You've hit your limit · resets tomorrow")) 'recusa limite em stdout com código zero'
Confere (-not (Test-ParecerRevisao ('```markdown' + "`n" + $parecerValido + '```'))) 'exemplo cercado não vale parecer'
Confere (-not (Test-ParecerRevisao "## Veredito`naprovado")) 'recusa parecer interrompido'
$arbitragem = "## Arbitragem`n1 em disputa`n## Decisões`n1. achado — fica com: autor`nPor quê: exemplo.py:1`n## Fora da pauta`n- nada"
Confere (Test-ParecerRevisao $arbitragem arbitro) 'aceita arbitragem completa'
Confere (-not (Test-ParecerRevisao $parecerValido arbitro)) 'parecer não substitui arbitragem'
foreach ($respostaLimite in "You've hit your limit", 'Error: credit balance is too low', 'RESOURCE_EXHAUSTED: quota') {
  Confere (Test-RespostaLimiteProvedor $respostaLimite) 'detecta limite na resposta do executor'
}
Confere (-not (Test-RespostaLimiteProvedor 'STATUS: FEITO')) 'relatório normal não é limite'
$exemploLimite = '```text' + "`nRESOURCE_EXHAUSTED: teste da captura`n" + '```'
Confere (-not (Test-RespostaLimiteProvedor $exemploLimite)) 'erro citado em código não é limite atual'
$relatorioComLimite = "Teste tratou a saída:`nRESOURCE_EXHAUSTED: simulado`nSTATUS: FEITO`nRESUMO: tratamento conferido"
Confere (-not (Test-LimiteExecutor $relatorioComLimite 0)) 'executor concluído pode citar erro de cota'
Confere (Test-LimiteExecutor $relatorioComLimite 1) 'falha real não é mascarada pelo rodapé'
Confere (Test-LimiteExecutor "You've hit your limit" 0) 'executor sem relatório não pode concluir com limite'
Confere (-not (Test-RecusaSegurancaProvedor 'A função testa content_filter para detectar recusa.')) 'menção no código não é recusa do provedor'
Confere (Test-RecusaSegurancaProvedor 'erro do OpenCode: ProviderError: policy_violation') 'recusa explícita do provedor é preservada'
Confere (Test-RespostaLimiteProvedor "erro do OpenCode: APIError: You've hit your usage limit") 'limite com prefixo do OpenCode é reconhecido'
Confere (Test-RespostaLimiteProvedor 'erro do OpenCode: ProviderError: usage_limit_exceeded') 'código de cota esgotada é reconhecido'

$saidaTeste = Join-Path $raizTeste 'parecer com espaço.md'
$chamadas = New-Object Collections.Generic.List[string]
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  if ($familiaTeste -eq 'gemini') { return 3 }
  [IO.File]::WriteAllText($arquivoTeste, $parecerValido, $utf8)
  [IO.File]::WriteAllText("$arquivoTeste.modelo", 'Claude de reserva', $utf8)
  return 0
}
$rotaTeste = Get-Content -LiteralPath "$saidaTeste.rota.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Confere ($codigoTeste -eq 0 -and ($chamadas -join ',') -eq 'gemini,claude') 'cota zerada tenta reserva uma vez'
Confere ($rotaTeste.familia -eq 'claude' -and $rotaTeste.estado -eq 'revisado') 'registra família real'
Confere ((Get-Content -LiteralPath "$saidaTeste.modelo" -Raw) -eq 'Claude de reserva') 'metadado final vem da reserva'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  if ($familiaTeste -eq 'gemini') { [IO.File]::WriteAllText($arquivoTeste, "You've hit your limit", $utf8); return 0 }
  [IO.File]::WriteAllText($arquivoTeste, $parecerValido, $utf8); return 0
}
Confere ($codigoTeste -eq 0 -and $chamadas.Count -eq 2) 'limite com exit zero também troca'
$rotaTeste = Get-Content -LiteralPath "$saidaTeste.rota.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Confere ($rotaTeste.tentativas[0].motivo -eq 'limite') 'registro distingue falta de cota de formato'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  $respostaTeste = $parecerValido
  if ($familiaTeste -eq 'gemini') { $respostaTeste += "`nYou've hit your limit" }
  [IO.File]::WriteAllText($arquivoTeste, $respostaTeste, $utf8); return 0
}
Confere ($codigoTeste -eq 0 -and $chamadas.Count -eq 2) 'não aceita parecer seguido por limite do provedor'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  $respostaTeste = $parecerValido
  if ($familiaTeste -eq 'gemini') {
    $respostaTeste = 'Evidência:' + "`n" + '```powershell' + "`ncontent_filter`n" + '```' + "`nYou've hit your limit"
  }
  [IO.File]::WriteAllText($arquivoTeste, $respostaTeste, $utf8); return 0
}
Confere ($codigoTeste -eq 0 -and $chamadas.Count -eq 2) 'parecer cortado após citar controle ainda usa reserva por cota'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  [IO.File]::WriteAllText($arquivoTeste, $parecerValido, $utf8); return 1
}
$rotaTeste = Get-Content -LiteralPath "$saidaTeste.rota.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Confere ($codigoTeste -eq 3 -and $chamadas.Count -eq 2 -and $rotaTeste.estado -eq 'pendente') 'falhas esgotam reservas sem laço'
Confere (-not (Test-Path -LiteralPath $saidaTeste)) 'falha não deixa parecer final antigo'
Confere (-not (Test-Path -LiteralPath "$saidaTeste.modelo")) 'falha não deixa metadado antigo'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste); return 2
}
Confere ($codigoTeste -eq 2 -and $chamadas.Count -eq 1) 'não contorna falha de trava ou argumento'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  [IO.File]::WriteAllText($arquivoTeste, 'Error: blocked by safety_policy', $utf8); return 1
}
Confere ($codigoTeste -eq 2 -and $chamadas.Count -eq 1) 'não troca de provedor após recusa de segurança'

$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gemini', 'claude') -Saida $saidaTeste -Executar {
  param($familiaTeste, $arquivoTeste)
  $chamadas.Add($familiaTeste)
  [IO.File]::WriteAllText($arquivoTeste, $parecerValido, $utf8); return 0
}
Confere ($codigoTeste -eq 0 -and $chamadas.Count -eq 1) 'parecer válido encerra tentativas'

# Exercita a entrada pública em processo separado, com caminhos contendo espaço e sem chamar modelo.
$shellTeste = (Get-Process -Id $PID).Path
$pacoteTeste = Join-Path $raizTeste 'pacote com espaço.md'
[IO.File]::WriteAllText($pacoteTeste, '# Pedido de teste offline', $utf8)
$antesParecer = [IO.File]::ReadAllText($saidaTeste)
[IO.File]::WriteAllText("$saidaTeste.modelo", 'modelo da chamada anterior', $utf8)
$antesModelo = [IO.File]::ReadAllText("$saidaTeste.modelo")
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Nivel L1 -SoNivel -Pasta $raizTeste -Pacote $pacoteTeste -Saida $saidaTeste | Out-Null
Confere ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText($saidaTeste) -eq $antesParecer -and [IO.File]::ReadAllText("$saidaTeste.modelo") -eq $antesModelo) '-SoNivel não apaga parecer ou metadado'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Nivel L0 -Pasta $raizTeste -Pacote $pacoteTeste -Saida $saidaTeste | Out-Null
Confere ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText($saidaTeste).StartsWith('L0: sem revisor')) 'L0 explícito mantém dispensa sem modelo'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Nivel L0 -Economia -UsuarioPediu -Pasta $raizTeste -Pacote $pacoteTeste -Saida $saidaTeste | Out-Null
Confere ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText($saidaTeste).StartsWith('L0: sem revisor')) 'economia e pedido nao promovem L0 sem Topo'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -Forcar -Autor gpt -Pasta $raizTeste -Saida $saidaTeste | Out-Null
Confere ($LASTEXITCODE -eq 2) 'camada GPT recusa autor GPT sem chamar modelo'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit HEAD -Base main -Pasta $raizTeste -Saida $saidaTeste | Out-Null
Confere ($LASTEXITCODE -eq 2) 'camada de diff distingue argumento inválido'

# O recorte pode ser gerado no próprio repositório sem provedor nem consulta de cota.
$recorteTeste = Join-Path $raizTeste 'recorte.md'
$repoTeste = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit HEAD -Pasta $repoTeste -Saida $recorteTeste | Out-Null
$recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('## Pedido') -and $recorteTexto.Contains('## Critério de aceite')) 'recorte offline leva objetivo e aceite técnicos'

# Previa do Fable deve usar o piso proprio, inclusive em -Topo com L0, sem mexer na saida.
# Piso unico de revisao: L1 da politica, L2 em L2 ou -Topo, tambem para o Fable.
foreach ($cenario in @(
  @{nivel='L1';topo=$false;esforco=$P.revisao.L1}, @{nivel='L2';topo=$false;esforco=$P.revisao.L2},
  @{nivel='L1';topo=$true;esforco=$P.revisao.L2}, @{nivel='L0';topo=$true;esforco=$P.revisao.L2}
)) {
  $argsPrevia = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'revisar.ps1'),
    '-Autor','gpt','-Revisor','claude','-Nivel',$cenario.nivel,'-SoNivel','-Pasta',$raizTeste,'-Pacote',$pacoteTeste,'-Saida',$saidaTeste)
  if ($cenario.topo) { $argsPrevia += '-Topo' }
  $previa = (& $shellTeste @argsPrevia) -join "`n"
  Confere ($LASTEXITCODE -eq 0 -and $previa.Contains("esforço $($cenario.esforco)") -and [IO.File]::ReadAllText($saidaTeste).StartsWith('L0: sem revisor')) "previa Fable $($cenario.nivel), Topo $($cenario.topo), sem efeito colateral"
}

# Argumento invalido deve sair 2 antes de consultar catalogo ou executar provedor.
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'despachar.ps1') -Pasta $raizTeste -Tarefa $pacoteTeste -Saida $saidaTeste -Executor agy -Modelo modelo-inexistente -Esforco max | Out-Null
Confere ($LASTEXITCODE -eq 2) 'esforco invalido sai 2 mesmo com modelo indisponivel'

# Repositorio descartavel: apenas fixtures publicas e sentinela sintetica, sem segredo real.
$repoDiffTeste = Join-Path $raizTeste 'repo diff com espaco'
New-Item -ItemType Directory "$repoDiffTeste\privado" -Force | Out-Null
Push-Location -LiteralPath $repoDiffTeste
try {
  git init --template= -q
  git config user.name 'Teste offline'
  git config user.email 'offline@example.invalid'
  git config core.autocrlf false
  git config commit.gpgsign false
  New-Item -ItemType Directory (Join-Path $raizTeste 'hooks vazios') | Out-Null
  [IO.File]::WriteAllText((Join-Path $raizTeste 'ignore vazio'), '', $utf8)
  git config core.hooksPath (Join-Path $raizTeste 'hooks vazios')
  git config core.excludesFile (Join-Path $raizTeste 'ignore vazio')
  [IO.File]::WriteAllText("$repoDiffTeste\app.py", "base`n", $utf8)
  [IO.File]::WriteAllText("$repoDiffTeste\.env.example", "EXEMPLO=publico`n", $utf8)
  [IO.File]::WriteAllText("$repoDiffTeste\id_teste.pub", "chave publica sintetica`n", $utf8)
  [IO.File]::WriteAllText("$repoDiffTeste\privado\.env", "SENTINELA_OFFLINE_NAO_ANEXAR`n", $utf8)
  [IO.File]::WriteAllText("$repoDiffTeste\privado\.env^{commit}", "SENTINELA_OFFLINE_NAO_ANEXAR`n", $utf8)
  git add -- app.py .env.example id_teste.pub privado/.env 'privado/.env^{commit}'
  git commit -qm 'fixture inicial'
  $commitInicialTeste = (git rev-parse HEAD).Trim()
  [IO.File]::AppendAllText("$repoDiffTeste\.env.example", "OUTRO=publico`n", $utf8)
  [IO.File]::AppendAllText("$repoDiffTeste\id_teste.pub", "outra linha publica`n", $utf8)
  [IO.File]::WriteAllText("$repoDiffTeste\test_credentials_parser.py", "codigo sintetico`n", $utf8)
  $riscoPublico = Get-NivelDiff $repoDiffTeste '' -SemUltimoCommit
  Confere ($riscoPublico.nivel -eq 'L1') 'templates, pub e parser nao promovem risco'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  $recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('OUTRO=publico') -and $recorteTexto.Contains('outra linha publica') -and $recorteTexto.Contains('codigo sintetico') -and $recorteTexto.Contains('Nivel L1')) 'anexo preserva exemplos, chave publica e codigo'
  git add -- .env.example id_teste.pub test_credentials_parser.py
  git commit -qm 'fixture publica'
  $commitPublicoTeste = (git rev-parse HEAD).Trim()
  git mv -- privado/.env privado/.env.example
  [IO.File]::AppendAllText("$repoDiffTeste\app.py", "mudanca local`n", $utf8)
  git add -- app.py
  [IO.File]::AppendAllText("$repoDiffTeste\app.py", "mudanca posterior ao staging`n", $utf8)
  $dadosStaging = Get-RecorteDiff $repoDiffTeste -SemUltimoCommit
  $estatisticaApp = @($dadosStaging.numstat | Where-Object { $_ -match "`tapp.py$" })
  Confere ($estatisticaApp.Count -eq 1 -and $estatisticaApp[0] -eq "2`t0`tapp.py") 'coletor usa max(staged, arvore) por caminho sem duplicar linhas'
  foreach ($nomeSensivelTeste in 'app-credentials-prod.json','gcp-credentials-dev.json','aws_credentials_backup','app.env') {
    [IO.File]::WriteAllText((Join-Path $repoDiffTeste $nomeSensivelTeste), "SENTINELA_OFFLINE_NAO_ANEXAR`n", $utf8)
  }
  foreach ($nomeSensivelTeste in 'gcp-credentials-prod.json5','aws-credentials-prod.tfvars','svc-credentials-dev.jsonl','app-credentials.enc','app-credentials-prod.json.old',
      'service.env.local','service.env.production','service.env.json','service.env.bak','appCredentials.json','awscredentials','set-credentials.sh','aws-credentials.ps1',
      'server-credentials2.json','server_credentials2_backup.log','secrets.env.example','server.key.env.example','appCredentials.env.example','id_rsa.env.example') {
    [IO.File]::WriteAllText((Join-Path $repoDiffTeste $nomeSensivelTeste), "SENTINELA_OFFLINE_NAO_ANEXAR`n", $utf8)
  }
  foreach ($nomePublicoTeste in 'config.env.ts','docker.env.example','app.env.sample') {
    [IO.File]::WriteAllText((Join-Path $repoDiffTeste $nomePublicoTeste), "EXEMPLO_PUBLICO_ANEXAR`n", $utf8)
  }
  Confere ((Get-NivelDiff $repoDiffTeste '' -SemUltimoCommit).nivel -eq 'L2') 'rename sensivel considera os dois nomes'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  $recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('Nivel L2') -and -not $recorteTexto.Contains('SENTINELA_OFFLINE_NAO_ANEXAR') -and $recorteTexto.Contains('mudanca local') -and $recorteTexto.Contains('config.env.ts') -and $recorteTexto.Contains('docker.env.example') -and $recorteTexto.Contains('app.env.sample')) 'risco L2 filtra dados sensiveis e mantem fontes/exemplos no anexo'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit $commitPublicoTeste -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  $recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('Nivel L1') -and -not $recorteTexto.Contains('mudanca local')) '-Commit mede so o commit, sem a arvore suja'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit $commitInicialTeste -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  $recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('Nivel L2') -and $recorteTexto.Contains('+base') -and -not $recorteTexto.Contains('mudanca local') -and -not $recorteTexto.Contains('SENTINELA_OFFLINE_NAO_ANEXAR')) '-Commit raiz mede o commit L2, filtrando a sentinela e ignorando arvore suja'
  Confere ((Get-NivelDiff $repoDiffTeste "$commitInicialTeste..$commitPublicoTeste").nivel -eq 'L1') 'intervalo continua em diff sem incluir arvore suja'
  foreach ($intervaloTeste in "$commitInicialTeste..", "..$commitInicialTeste", "$commitInicialTeste...", "...$commitInicialTeste") {
    $recorteIntervalo = Get-RecorteDiff $repoDiffTeste $intervaloTeste
    $nativoIntervalo = @(git -c core.quotePath=false diff --no-renames --numstat $intervaloTeste)
    Confere ((@($recorteIntervalo.numstat | Sort-Object) -join "`n") -eq (@($nativoIntervalo | Sort-Object) -join "`n")) "intervalo com ponta omitida equivale ao Git: $intervaloTeste"
  }
  foreach ($refInvalida in 'HEAD:privado/.env','ref-offline-inexistente') {
    $textoInvalido = & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Diff $refInvalida -SoNivel -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $saidaTeste
    Confere ($LASTEXITCODE -eq 2) "-Diff invalido para antes da revisao: $refInvalida"
  }
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Diff 'ref-offline-inexistente' -Nivel L1 -SoNivel -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $saidaTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2) '-Nivel nao ignora -Diff invalido'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Base 'ref-offline-inexistente' -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2 -and -not (Test-Path -LiteralPath "$recorteTeste.diff.md")) '-Base invalida e rejeitada sem anexo'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Pasta (Join-Path $repoDiffTeste '.git') -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2) '-Pasta .git com is-inside-work-tree=false e rejeitada'
  $repoBareTeste = Join-Path $raizTeste 'repo bare'
  git init --bare --template= -q $repoBareTeste
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Pasta $repoBareTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2) '-Pasta bare com is-inside-work-tree=false e rejeitada'
  Confere ((Get-NivelDiff $raizTeste).nivel -eq 'L1') 'revisao generica fora de git sem -Diff segue aceita'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit 'HEAD:privado/.env' -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2 -and -not (Test-Path -LiteralPath "$recorteTeste.diff.md")) '-Commit recusa blob sensivel sem gerar anexo'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit '--stat' -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2 -and -not (Test-Path -LiteralPath "$recorteTeste.diff.md")) '-Commit recusa opcao no lugar de commit'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit "$commitInicialTeste..$commitPublicoTeste" -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2 -and -not (Test-Path -LiteralPath "$recorteTeste.diff.md")) '-Commit recusa intervalo, reservado a -Diff'
  $saidaIndevida = Join-Path $raizTeste 'saida-indesejada.txt'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit '--output=../saida-indesejada.txt' -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 2 -and -not (Test-Path -LiteralPath $saidaIndevida) -and -not (Test-Path -LiteralPath "$recorteTeste.diff.md")) '-Commit recusa opcao com pontos sem efeito em disco'
  $recusou = $false
  try { Get-RecorteDiff $repoDiffTeste '--output=../saida-indesejada.txt' | Out-Null } catch { $recusou = $true }
  Confere ($recusou -and -not (Test-Path -LiteralPath $saidaIndevida)) 'intervalo valida os dois endpoints antes de chamar diff'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Base $commitInicialTeste -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  $recorteTexto = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $recorteTexto.Contains('Nivel L2') -and $recorteTexto.Contains('OUTRO=publico') -and $recorteTexto.Contains('mudanca local')) '-Base inclui commits, staging e arvore suja no mesmo risco'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Alto -Commit $commitPublicoTeste -Pasta $repoDiffTeste -Saida $recorteTeste | Out-Null
  Confere ($LASTEXITCODE -eq 0 -and [IO.File]::ReadAllText("$recorteTeste.diff.md").Contains('Nivel L2')) '-Alto promove camada L1 para L2'
  # Reusar o recorte dispensa toda nova leitura: o arquivo contado pode ate sair depois da coleta.
  $contadoTeste = Join-Path $repoDiffTeste 'novo-contado.py'
  [IO.File]::WriteAllText($contadoTeste, ((1..401 | ForEach-Object { 'linha publica sintetica' }) -join "`n"), $utf8)
  $dadosColetados = Get-RecorteDiff $repoDiffTeste -SemUltimoCommit -ComPatch
  $novoContado = @($dadosColetados.novos | Where-Object { $_.caminho -eq 'novo-contado.py' })[0]
  $dadosStreaming = Get-RecorteDiff $repoDiffTeste -SemUltimoCommit
  $novoStreaming = @($dadosStreaming.novos | Where-Object { $_.caminho -eq 'novo-contado.py' })[0]
  Confere ($novoStreaming.linhas -eq 401 -and -not $novoStreaming.conteudo) 'medicao sem patch conta novos sem reter conteudo'
  Remove-Item -LiteralPath $contadoTeste
  $dadosContados = [pscustomobject]@{ numstat=@($dadosColetados.numstat | Where-Object { $_ -match "`tnovo-contado.py$" }); origem=$dadosColetados.origem }
  Confere ($novoContado.linhas -eq 401 -and @($novoContado.conteudo).Count -eq 401 -and (Get-NivelDiff -Recorte $dadosContados).nivel -eq 'L2') 'classificacao reutiliza contagens e conteudo do mesmo recorte sem reler arquivo'
  $soEstatisticas = Get-RecorteDiff $repoDiffTeste $commitInicialTeste -SemUltimoCommit
  Confere (@($soEstatisticas.patch).Count -eq 0 -and @($soEstatisticas.novos).Count -eq 0) 'medicao de commit nao coleta patch nem conteudo rastreado'
} finally { Pop-Location }

# Merge sintetico: primeiro pai e a linha que recebeu o ramo; tag e realmente anotada.
$repoMergeTeste = Join-Path $raizTeste 'repo merge'
New-Item -ItemType Directory $repoMergeTeste | Out-Null
Push-Location -LiteralPath $repoMergeTeste
try {
  git init --template= -q -b destino
  git config user.name 'Teste offline'
  git config user.email 'offline@example.invalid'
  git config core.autocrlf false
  git config commit.gpgsign false
  git config core.hooksPath (Join-Path $raizTeste 'hooks vazios')
  git config core.excludesFile (Join-Path $raizTeste 'ignore vazio')
  [IO.File]::WriteAllText((Join-Path $repoMergeTeste 'base.txt'), "base publica`n", $utf8)
  git add -- base.txt
  git commit -qm 'base do merge'
  git checkout -qb origem
  [IO.File]::WriteAllText((Join-Path $repoMergeTeste 'deploy.ps1'), "CONTEUDO_DO_RAMO`n", $utf8)
  git add -- deploy.ps1
  git commit -qm 'mudanca recebida'
  git checkout -q destino
  [IO.File]::WriteAllText((Join-Path $repoMergeTeste 'linha.txt'), "CONTEUDO_SO_PRIMEIRO_PAI`n", $utf8)
  git add -- linha.txt
  git commit -qm 'mudanca da linha destino'
  git merge --no-ff -qm 'merge de teste' origem
  $commitMergeTeste = (git rev-parse HEAD).Trim()
  git -c tag.gpgsign=false -c tag.forceSignAnnotated=false tag -a merge-anotado -m 'tag anotada offline'
  $tipoTagTeste = (git cat-file -t refs/tags/merge-anotado).Trim()
  $recorteMerge = Get-RecorteDiff $repoMergeTeste $commitMergeTeste -CommitUnico -ComPatch
  $numPrimeiroPai = @(git -c core.quotePath=false diff --no-renames --numstat "$commitMergeTeste^1" $commitMergeTeste)
  $patchPrimeiroPai = @(git -c core.quotePath=false diff --patch "$commitMergeTeste^1" $commitMergeTeste)
  Confere ((@($recorteMerge.numstat | Sort-Object) -join "`n") -eq (@($numPrimeiroPai | Sort-Object) -join "`n") -and
    ($recorteMerge.patch -join "`n").Trim() -eq ($patchPrimeiroPai -join "`n").Trim() -and (Get-NivelDiff -Recorte $recorteMerge).nivel -eq 'L2') 'merge usa primeiro pai identico no patch e nas estatisticas de risco'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit $commitMergeTeste -Pasta $repoMergeTeste -Saida $recorteTeste | Out-Null
  $anexoMerge = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $anexoMerge.Contains('Nivel L2') -and $anexoMerge.Contains('CONTEUDO_DO_RAMO') -and -not $anexoMerge.Contains('CONTEUDO_SO_PRIMEIRO_PAI')) 'anexo do merge mostra somente o que entrou na linha destino'
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'gpt-review.ps1') -SoDiff -Commit merge-anotado -Pasta $repoMergeTeste -Saida $recorteTeste | Out-Null
  $anexoTag = [IO.File]::ReadAllText("$recorteTeste.diff.md")
  Confere ($LASTEXITCODE -eq 0 -and $tipoTagTeste -eq 'tag' -and $anexoTag.Contains('Nivel L2') -and $anexoTag.Contains('CONTEUDO_DO_RAMO') -and -not $anexoTag.Contains('CONTEUDO_SO_PRIMEIRO_PAI')) '-Commit aceita tag anotada para merge preservando primeiro pai'
  $arvoreOrfa = (git rev-parse "$commitMergeTeste^{tree}").Trim()
  $commitOrfao = ('commit sem pais sintetico' | git commit-tree $arvoreOrfa).Trim()
  $intervaloSemBase = "$commitMergeTeste...$commitOrfao"
  foreach ($nivelExplicito in '', 'L1') {
    $argsSemBase = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'revisar.ps1'),
      '-Autor','gpt','-Diff',$intervaloSemBase,'-SoNivel','-Pasta',$repoMergeTeste,'-Pacote',$pacoteTeste,'-Saida',$saidaTeste)
    if ($nivelExplicito) { $argsSemBase += @('-Nivel',$nivelExplicito) }
    & $shellTeste @argsSemBase | Out-Null
    Confere ($LASTEXITCODE -eq 2) "tres pontos sem merge-base param com exit 2, nivel explicito '$nivelExplicito'"
  }
  $recorteDoisPontos = Get-RecorteDiff $repoMergeTeste "$commitMergeTeste..$commitOrfao"
  Confere (@($recorteDoisPontos.numstat).Count -eq 0) 'dois pontos entre historias sem ancestral continuam validos'
} finally { Pop-Location }

# Entradas publicas com dependencias simuladas: nenhum binario de modelo e chamado.
$scriptsMock = Join-Path $raizTeste 'isolado\dupla\scripts'
New-Item -ItemType Directory $scriptsMock, "$raizTeste\isolado\orquestrador", "$raizTeste\isolado\revisor" -Force | Out-Null
foreach ($nomeMock in 'revisar.ps1','gpt-review.ps1','despachar.ps1','politica-modelos.ps1','revisao-comum.ps1','opencode-comum.ps1','perfil.ps1','fontes-comum.ps1') {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $nomeMock) -Destination (Join-Path $scriptsMock $nomeMock)
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\orquestrador\politica-modelos.json') -Destination "$raizTeste\isolado\orquestrador\politica-modelos.json"
[IO.File]::WriteAllText("$raizTeste\isolado\revisor\SKILL.md", '# Revisor sintetico offline', $utf8)
$cotaMock = @'
$env:LOCALAPPDATA = $PSScriptRoot
$env:USERPROFILE = Join-Path $PSScriptRoot 'perfil-mock'
$env:HOME = $env:USERPROFILE
$env:PATH = "$PSScriptRoot;$env:PATH"
function Copy-Item {
  [CmdletBinding()]
  param([Parameter(Position=0)]$Path,[string]$LiteralPath,[Parameter(Position=1)]$Destination)
  if ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'modo.txt')) -eq 'executor-copia') { Write-Error 'copia de plugin sintetica falhou'; return }
  $origemMock = if ($LiteralPath) { $LiteralPath } else { $Path }
  Microsoft.PowerShell.Management\Copy-Item -LiteralPath $origemMock -Destination $Destination
}
function Get-CotaChatGPT {
  if ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'modo.txt')) -eq 'cota') {
    [pscustomobject]@{aberta=$true;usada=100;janela='teste';volta=(Get-Date);fonte='offline'}
  }
}
function Get-CotaAgy {
  if ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'modo.txt')) -eq 'agy-trava-tardia') {
    $null = Set-EstadoFonte travar antigravity -Arquivo (Join-Path $PSScriptRoot 'perfil-mock/.local/share/dupla/fontes.json')
  }
  [pscustomobject]@{grupo='Claude and GPT models';resta=100;nome='cota sintetica'}
}
function Format-Volta($Valor) { 'offline' }
function Get-Command {
  param([string]$Name, $ErrorAction)
  if ($Name -eq 'agy') { return [pscustomobject]@{Source=(Join-Path $PSScriptRoot 'agy-offline.cmd')} }
  Microsoft.PowerShell.Core\Get-Command -Name $Name -ErrorAction SilentlyContinue
}
'@
[IO.File]::WriteAllText((Join-Path $scriptsMock 'cota.ps1'), $cotaMock, $utf8)
New-Item -ItemType Directory (Join-Path $scriptsMock 'perfil-mock\.config\opencode\plugins') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $scriptsMock 'perfil-mock\.config\opencode\plugins\segredos.ts'), '// plugin sintetico offline', $utf8)
$agyMock = @'
$modo = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'modo.txt'))
if ($modo -notin 'agy-nu','agy-trava-tardia','agy-exit3','agy-simples') { Write-Output 'permissao sintetica sem deny'; exit 0 }
if ($args -contains '/permissions') {
  $cfg = Join-Path $env:USERPROFILE '.gemini\antigravity-cli\settings.json'
  $config = [IO.File]::ReadAllText($cfg) | ConvertFrom-Json
  foreach ($regra in $config.permissions.deny) { Write-Output "deny $regra" }
  exit 0
}
if ($args -contains 'models') {
  if ($modo -eq 'agy-simples') { 'gemini-4-flash-lite', 'gemini-4-flash-low', 'gemini-4-flash-medium' | Write-Output; exit 0 }
  Write-Output 'claude-opus-5-5'; exit 0
}
if ($modo -eq 'agy-exit3') { [Console]::Error.WriteLine('falha sintetica de processo, sem cota'); exit 3 }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'agy-inferencia.txt'), 'execucao local simulada')
Write-Output 'STATUS: FEITO'
Write-Output 'RESUMO: execucao offline simulada'
exit 0
'@
[IO.File]::WriteAllText((Join-Path $scriptsMock 'agy-offline.ps1'), $agyMock, $utf8)
$agyCmdMock = "@echo off`r`n`"$shellTeste`" -NoProfile -ExecutionPolicy Bypass -File `"$scriptsMock\agy-offline.ps1`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $scriptsMock 'agy-offline.cmd'), $agyCmdMock, $utf8)
$claudeMock = "@echo off`r`necho %* > `"$scriptsMock\claude.args`"`r`necho ## Veredito`r`necho aprovado - offline`r`necho ## Achados`r`necho nenhum achado`r`necho ## Não conferido`r`necho rede externa`r`nexit /b 0`r`n"
[IO.File]::WriteAllText((Join-Path $scriptsMock 'claude.cmd'), $claudeMock, $utf8)
$opencodeMock = @'
function Get-OpenCodeExe { 'opencode-offline-nao-executado.exe' }
function Get-ModelosOpenCode { @('openai/gpt-6-astra','openai/gpt-6-luna') }
function New-CasaOpenCodeLeitura {
  if ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'modo.txt')) -eq 'isolamento') { throw 'falha ambiental sintetica' }
  $casaMock = Join-Path $PSScriptRoot ('casa-' + [guid]::NewGuid())
  New-Item -ItemType Directory $casaMock | Out-Null
  $casaMock
}
function Invoke-OpenCodeRun($oc,$pasta,$casa,$modeloVariante,$arquivo,$prompt,$saida,$log,$titulo,$maxMin) {
  $parecerMock = "## Veredito`naprovado - offline`n## Achados`nnenhum achado`n## Não conferido`nrede externa`n"
  [IO.File]::WriteAllText($saida, $parecerMock, (New-Object Text.UTF8Encoding($false)))
  [pscustomobject]@{codigo=0;modelo='modelo simulado offline'}
}
'@
# Os scripts copiados tem BOM para o PowerShell 5.1 ler os acentos do mock tambem.
$textoMock = [IO.File]::ReadAllText((Join-Path $scriptsMock 'opencode-comum.ps1')) + "`r`n" + $opencodeMock
[IO.File]::WriteAllText((Join-Path $scriptsMock 'opencode-comum.ps1'), $textoMock, (New-Object Text.UTF8Encoding($true)))
$saidaMock = Join-Path $raizTeste 'parecer mock.md'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'agy-nu', $utf8)
$saidaAgyNu = Join-Path $raizTeste 'executor agy nu.md'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor agy -Modelo claude-opus-5-5 -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaAgyNu -Conjuntos nenhuma | Out-Null
$codigoAgyNu = $LASTEXITCODE
$nivelAgyNu = [IO.File]::ReadAllText("$saidaAgyNu.nivel.json") | ConvertFrom-Json
Confere ($codigoAgyNu -eq 0 -and $nivelAgyNu.esforcoSelecionado -eq 'nao-informado' -and $nivelAgyNu.esforcoPedido -eq $P.capacidades.N3.esforco -and (Test-Path -LiteralPath (Join-Path $scriptsMock 'agy-inferencia.txt'))) 'entrada normal agy aceita ID nu explicito sem alegar esforco confirmado'
Remove-Item -LiteralPath (Join-Path $scriptsMock 'agy-inferencia.txt')
# N1 em medium (2026-11-07): Flash-Lite sem variante cede a vez ao Flash medium, sem encerrar o despacho.
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'agy-simples', $utf8)
$saidaAgySimples = Join-Path $raizTeste 'executor agy simples.md'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor agy -Nivel simples -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaAgySimples -Conjuntos nenhuma | Out-Null
$codigoAgySimples = $LASTEXITCODE
# Piso low: Flash-Lite sem sufixo atende; acima disso ele cede a vez ao Flash com a variante do piso.
$modeloSimplesEsperado = if ($P.capacidades.N1.esforco -eq 'low') { 'gemini-4-flash-lite' } else { "gemini-4-flash-$($P.capacidades.N1.esforco)" }
$esforcoSimplesEsperado = if ($P.capacidades.N1.esforco -eq 'low') { 'nao-informado' } else { $P.capacidades.N1.esforco }
$nivelAgySimples = [IO.File]::ReadAllText("$saidaAgySimples.nivel.json") | ConvertFrom-Json
Confere ($codigoAgySimples -eq 0 -and $nivelAgySimples.modeloPedido -eq $modeloSimplesEsperado -and $nivelAgySimples.esforcoSelecionado -eq $esforcoSimplesEsperado) "agy simples usa $modeloSimplesEsperado"
Remove-Item -LiteralPath (Join-Path $scriptsMock 'agy-inferencia.txt') -ErrorAction SilentlyContinue
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'agy-trava-tardia', $utf8)
$saidaAgyTrava = Join-Path $raizTeste 'executor agy travado tarde.md'
$erroTravaAgy = Join-Path $raizTeste 'executor agy travado tarde.err'
$preferenciaTrava = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor agy -Modelo claude-opus-5-5 -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaAgyTrava -Conjuntos nenhuma 2>$erroTravaAgy | Out-Null
  $codigoAgyTrava = $LASTEXITCODE
} finally { $ErrorActionPreference = $preferenciaTrava }
Confere ($codigoAgyTrava -eq 3 -and -not (Test-Path -LiteralPath (Join-Path $scriptsMock 'agy-inferencia.txt'))) 'trava tardia agy nao executa modelo'
Confere (@(Get-ChildItem (Join-Path $scriptsMock 'dupla/agy-fazer') -Directory).Count -eq 0) 'trava tardia limpa casa do executor'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'perfil-mock/.local/share/dupla/fontes.json'), '{"versao":1,"bloqueadas":[]}', $utf8)
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'agy-exit3', $utf8)
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor agy -Modelo claude-opus-5-5 -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaAgyTrava -Conjuntos nenhuma | Out-Null
Confere ($LASTEXITCODE -eq 1) 'exit3 arbitrario do agy continua falha de processo'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'agy-nu', $utf8)
$openrouterMock = @'
param($Pasta,$Entrada,$Saida,$Modelos,$Papel,$Esforco)
[IO.File]::WriteAllText($Saida, 'STATUS: TRAVADO' + [Environment]::NewLine + 'RESUMO: fonte travada no filho, mock offline')
[IO.File]::WriteAllText("$Saida.fonte.json", '{"fonte":"openrouter","motivo":"fonte-travada"}')
exit 3
'@
[IO.File]::WriteAllText((Join-Path $scriptsMock 'openrouter.ps1'), $openrouterMock, $utf8)
$saidaRouterMock = Join-Path $raizTeste 'executor router travado no filho.md'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor openrouter -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaRouterMock -Conjuntos nenhuma | Out-Null
Confere ($LASTEXITCODE -eq 3 -and [IO.File]::ReadAllText($saidaRouterMock).Contains('STATUS: TRAVADO')) 'despachar preserva codigo 3 e parcial do filho OpenRouter'
$claudeFalhaMock = "@echo off`r`necho falha sintetica sem cota 1>&2`r`nexit /b 3`r`n"
[IO.File]::WriteAllText((Join-Path $scriptsMock 'claude.cmd'), $claudeFalhaMock, $utf8)
$saidaClaudeFalhaMock = Join-Path $raizTeste 'claude falha de processo.md'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'revisar.ps1') -Autor gpt -Revisor claude -Nivel L1 -TentativaUnica -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $saidaClaudeFalhaMock | Out-Null
Confere ($LASTEXITCODE -eq 1) 'exit3 arbitrario do Claude revisor continua falha de processo'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'claude.cmd'), $claudeMock, $utf8)
$saidaAgyEsforco = Join-Path $raizTeste 'executor agy esforco.md'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor agy -Modelo claude-opus-5-5 -Esforco high -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaAgyEsforco -Conjuntos nenhuma | Out-Null
Confere ($LASTEXITCODE -eq 3 -and -not (Test-Path -LiteralPath "$saidaAgyEsforco.nivel.json") -and -not (Test-Path -LiteralPath (Join-Path $scriptsMock 'agy-inferencia.txt'))) 'entrada normal agy recusa ID nu com esforco exigido antes da inferencia'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'executor-copia', $utf8)
$erroCopiaExecutor = (& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'despachar.ps1') -Executor opencode -Pasta $repoDiffTeste -Tarefa $pacoteTeste -Saida $saidaMock -Conjuntos nenhuma -SoTrava) -join "`n"
Confere ($LASTEXITCODE -eq 1 -and $erroCopiaExecutor.Contains('nao deu para copiar o plugin segredos') -and -not (Test-Path -LiteralPath "$saidaMock.cmd")) 'executor para em erro nao terminante de copia do plugin antes de inferencia'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'isolamento', $utf8)
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'revisar.ps1') -Autor claude -Revisor gpt -Nivel L1 -TentativaUnica -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $saidaMock | Out-Null
Confere ($LASTEXITCODE -eq 3 -and -not (Test-Path -LiteralPath $saidaMock)) 'falha ambiental do OpenCode sai indisponivel antes de inferencia'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'revisar.ps1') -Autor gpt -Revisor gemini -Nivel L1 -TentativaUnica -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $saidaMock | Out-Null
Confere ($LASTEXITCODE -eq 3 -and -not (Test-Path -LiteralPath $saidaMock)) 'agy sem deny sai indisponivel antes de inferencia'
# O coordenador pode usar outra familia quando o isolamento da primeira esta indisponivel.
$chamadas.Clear()
$codigoTeste = Invoke-RevisaoComReserva -Rotas @('gpt','gemini') -Saida $saidaMock -Executar {
  param($familiaTeste,$arquivoTeste)
  $chamadas.Add($familiaTeste)
  if ($familiaTeste -eq 'gpt') {
    & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'revisar.ps1') -Autor claude -Revisor gpt -Nivel L1 -TentativaUnica -Pasta $repoDiffTeste -Pacote $pacoteTeste -Saida $arquivoTeste | Out-Null
    return $LASTEXITCODE
  }
  [IO.File]::WriteAllText($arquivoTeste,$parecerValido,$utf8); return 0
}
Confere ($codigoTeste -eq 0 -and ($chamadas -join ',') -eq 'gpt,gemini') 'isolamento indisponivel nao interrompe reserva elegivel'
# Camada GPT extra desativada pela politica (gptExtra=false): sem -Forcar sai 0 sem chamar nada.
$saidaDispensada = Join-Path $raizTeste 'gpt-review dispensado.md'
$textoDispensado = (& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'gpt-review.ps1') -Autor claude -Pasta $repoDiffTeste -Saida $saidaDispensada) -join "`n"
Confere ($LASTEXITCODE -eq 0 -and $textoDispensado.Contains('dispensado: camada GPT extra desativada') -and -not (Test-Path -LiteralPath "$saidaDispensada.rota.json") -and -not (Test-Path -LiteralPath $saidaDispensada)) 'camada GPT extra desativada sai 0 sem chamar modelo nem gravar rota'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'cota', $utf8)
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'gpt-review.ps1') -Forcar -Autor claude -Pasta $repoDiffTeste -Saida $saidaMock | Out-Null
$rotaMock = [IO.File]::ReadAllText("$saidaMock.rota.json") | ConvertFrom-Json
Confere ($LASTEXITCODE -eq 3 -and $rotaMock.tentativas.Count -eq 1 -and $rotaMock.tentativas[0].familia -eq 'gpt') 'camada GPT esgotada fica pendente sem trocar de familia'
[IO.File]::WriteAllText((Join-Path $scriptsMock 'modo.txt'), 'sucesso', $utf8)
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'gpt-review.ps1') -Forcar -Autor claude -Pasta $repoDiffTeste -Saida $saidaMock | Out-Null
$rotaMock = [IO.File]::ReadAllText("$saidaMock.rota.json") | ConvertFrom-Json
$nivelMock = [IO.File]::ReadAllText("$saidaMock.nivel.json") | ConvertFrom-Json
Confere ($LASTEXITCODE -eq 0 -and $rotaMock.familia -eq 'gpt' -and $nivelMock.esforcoPedido -eq $P.revisao.L2 -and (Test-ParecerRevisao ([IO.File]::ReadAllText($saidaMock)))) 'camada GPT executa L2 do diff original e exige parecer completo'
& $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsMock 'gpt-review.ps1') -Forcar -Autor claude -Alto -Commit $commitPublicoTeste -Pasta $repoDiffTeste -Saida $saidaMock | Out-Null
$nivelMock = [IO.File]::ReadAllText("$saidaMock.nivel.json") | ConvertFrom-Json
Confere ($LASTEXITCODE -eq 0 -and $nivelMock.esforcoPedido -eq $P.revisao.L2 -and $nivelMock.esforcoSelecionado -eq $P.revisao.L2 -and [IO.File]::ReadAllText("$saidaMock.diff.md").Contains('Nivel L2')) '-Alto em commit publico L1 chega ao ramo real com o piso L2 no nivel.json'
foreach ($cenario in @(
  @{nivel='L1';topo=$false;esforco=$P.revisao.L1}, @{nivel='L2';topo=$false;esforco=$P.revisao.L2}, @{nivel='L0';topo=$true;esforco=$P.revisao.L2}
)) {
  $argsFable = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $scriptsMock 'revisar.ps1'),
    '-Autor','gpt','-Revisor','claude','-Nivel',$cenario.nivel,'-TentativaUnica','-Pasta',$repoDiffTeste,'-Pacote',$pacoteTeste,'-Saida',$saidaMock)
  if ($cenario.topo) { $argsFable += '-Topo' }
  $textoFable = (& $shellTeste @argsFable) -join "`n"
  $nivelMock = [IO.File]::ReadAllText("$saidaMock.nivel.json") | ConvertFrom-Json
  $argsAplicados = [IO.File]::ReadAllText((Join-Path $scriptsMock 'claude.args'))
  # Sem o acento na comparação: o chcp 65001 do .cmd muda a página do console compartilhado e, rodando pelo
  # Git Bash, o pai decodifica a saída do filho com a página antiga ("esfor├ºo").
  Confere ($LASTEXITCODE -eq 0 -and $textoFable -match "esfor\S+ $($cenario.esforco)," -and $nivelMock.esforcoPedido -eq $cenario.esforco -and $argsAplicados.Contains("--effort $($cenario.esforco)")) "ramo Fable aplica esforco $($cenario.esforco) em $($cenario.nivel), Topo $($cenario.topo)"
}

# A montagem real da casa precisa parar com erro de cmdlet nao terminante, mesmo que
# o chamador use Continue. Plugin e perfis deste processo sao fixtures, nunca os do usuário.
$testeCasa = @'
param([string]$Scripts,[string]$Raiz,[string]$Modo)
$ErrorActionPreference = 'Continue'
. (Join-Path $Scripts 'opencode-comum.ps1')
$env:LOCALAPPDATA = Join-Path $Raiz ('ambiente-' + $Modo)
$env:USERPROFILE = Join-Path $Raiz ('perfil-[literal]-' + $Modo)
$env:HOME = $env:USERPROFILE
$pluginTeste = Join-Path $env:USERPROFILE '.config\opencode\plugins'
[IO.Directory]::CreateDirectory($pluginTeste) | Out-Null
[IO.File]::WriteAllText((Join-Path $pluginTeste 'segredos.ts'),'// plugin sintetico')
function Copy-Item {
  [CmdletBinding()]
  param([Parameter(Position=0)]$Path,[string]$LiteralPath,[Parameter(Position=1)]$Destination)
  $script:copiaFoiChamada = $true
  if ($Modo -eq 'copia') { Write-Error 'erro de copia sintetico'; return }
  $origemPlugin = if ($LiteralPath) { $LiteralPath } else { $Path }
  Microsoft.PowerShell.Management\Copy-Item -LiteralPath $origemPlugin -Destination $Destination
  $script:pluginFoiCopiado = Test-Path -LiteralPath (Join-Path $Destination 'segredos.ts')
  if ($Modo -eq 'gravacao') {
    $casaParcial = Split-Path ($Destination.TrimEnd('\')) -Parent
    Microsoft.PowerShell.Management\New-Item -ItemType Directory -Path (Join-Path $casaParcial 'opencode.json') | Out-Null
  }
}
function New-Item {
  [CmdletBinding()]
  param([string]$ItemType,[switch]$Force,[Parameter(Position=0)][string]$Path)
  if ($Modo -eq 'diretorio') {
    Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Force:$Force -Path $Path | Out-Null
    Write-Error 'erro de diretorio sintetico'; return
  }
  Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Force:$Force -Path $Path
}
$parou = $false
$raizCasasTeste = Join-Path $env:LOCALAPPDATA 'dupla\teste-casa'
Microsoft.PowerShell.Management\New-Item -ItemType Directory -Force $raizCasasTeste | Out-Null
$arquivoIrmao = Join-Path $raizCasasTeste 'preservar.txt'
[IO.File]::WriteAllText($arquivoIrmao, 'arquivo irmao preservado')
try { New-CasaOpenCodeLeitura 'openai/gpt-6-astra' 'openai/gpt-6-luna' 'teste-casa' | Out-Null }
catch { $parou = $true }
if (-not $parou) { exit 1 }
if ($Modo -ne 'diretorio' -and -not $script:copiaFoiChamada) { exit 1 }
if ($Modo -eq 'gravacao' -and -not $script:pluginFoiCopiado) { exit 1 }
if (@(Get-ChildItem -LiteralPath $raizCasasTeste -Force).Count -ne 1 -or [IO.File]::ReadAllText($arquivoIrmao) -ne 'arquivo irmao preservado') { exit 1 }
exit 0
'@
[IO.File]::WriteAllText((Join-Path $raizTeste 'testar casa.ps1'), $testeCasa, $utf8)
foreach ($modoCasa in 'diretorio','copia','gravacao') {
  & $shellTeste -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raizTeste 'testar casa.ps1') -Scripts $PSScriptRoot -Raiz $raizTeste -Modo $modoCasa | Out-Null
  Confere ($LASTEXITCODE -eq 0) "casa real limpa so a propria pasta apos falha de $modoCasa"
}

# O caminho só foi criado por este teste e fica dentro da pasta temporária verificada.
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$tempAlvo = [IO.Path]::GetFullPath($raizTeste)
if (-not $tempAlvo.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Pasta de teste fora da Temp' }
Remove-Item -LiteralPath $tempAlvo -Recurse -Force
Write-Output "$script:casos casos offline OK"
