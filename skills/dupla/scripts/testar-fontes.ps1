# Somente arquivos isolados e processos locais. Nenhuma chamada real a modelos ou rede.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'fontes-comum.ps1')
$casos = 0
function Confere($valor, [string]$nome) {
  if (-not $valor) { throw "FALHOU: $nome" }
  $script:casos++
}
$utf8 = New-Object Text.UTF8Encoding($false)
$raizFontes = Join-Path ([IO.Path]::GetTempPath()) ('dupla-fontes-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($raizFontes)
$shellFontes = (Get-Process -Id $PID).Path
$cliFontes = Join-Path $PSScriptRoot 'fontes.ps1'
function Invoke-BytesFontes([string]$Argumentos) {
  $infoBytes = New-Object Diagnostics.ProcessStartInfo
  $infoBytes.FileName = $shellFontes
  $infoBytes.Arguments = '-NoProfile -ExecutionPolicy Bypass ' + $Argumentos
  $infoBytes.UseShellExecute = $false; $infoBytes.CreateNoWindow = $true
  $infoBytes.RedirectStandardOutput = $true; $infoBytes.RedirectStandardError = $true
  $infoBytes.StandardOutputEncoding = New-Object Text.UTF8Encoding($false, $true)
  $infoBytes.StandardErrorEncoding = New-Object Text.UTF8Encoding($false, $true)
  $processoBytes = [Diagnostics.Process]::Start($infoBytes)
  try {
    $textoBytes = $processoBytes.StandardOutput.ReadToEnd()
    $erroBytes = $processoBytes.StandardError.ReadToEnd()
    $processoBytes.WaitForExit()
    [pscustomobject]@{ codigo = $processoBytes.ExitCode; stdout = $textoBytes; stderr = $erroBytes }
  } finally { $processoBytes.Dispose() }
}
$arquivoFontes = Join-Path $raizFontes 'estado.json'
$localAnterior = $env:LOCALAPPDATA
$perfilAnterior = $env:USERPROFILE
$homeEnvAnterior = $env:HOME
$tempAnterior = $env:TEMP
$cotasAnterior = $env:DUPLA_COTAS
try {
  $env:LOCALAPPDATA = $raizFontes
  $env:USERPROFILE = $raizFontes
  $env:HOME = $raizFontes
  $env:TEMP = $raizFontes
  $env:DUPLA_COTAS = Join-Path $raizFontes 'cotas.jsonl'
  Confere ((Get-ArquivoFontes) -eq ([IO.Path]::GetFullPath((Join-Path $raizFontes '.local/share/dupla/fontes.json')))) 'caminho global'
  $env:USERPROFILE = ''
  Confere ((Get-ArquivoFontes) -eq ([IO.Path]::GetFullPath((Join-Path $env:HOME '.local/share/dupla/fontes.json')))) 'fallback HOME'
  $env:USERPROFILE = $raizFontes
  $estado = Get-EstadoFontes $arquivoFontes
  Confere ($estado.valido -and $estado.bloqueadas.Count -eq 0) 'ausente libera'
  Confere (-not (Test-Path -LiteralPath $arquivoFontes)) 'leitura nao cria estado'
  $arquivoEncoding = Join-Path $raizFontes 'encoding.json'
  $jsonEncoding = '{"versao":1,"bloqueadas":[]}'
  $utf8Encoding = New-Object Text.UTF8Encoding($false, $true)
  [IO.File]::WriteAllBytes($arquivoEncoding, ([byte[]](0xef,0xbb,0xbf) + $utf8Encoding.GetBytes($jsonEncoding)))
  Confere ((Get-EstadoFontes $arquivoEncoding).valido) 'UTF8 com BOM unico aceito'
  [IO.File]::WriteAllBytes($arquivoEncoding, ([byte[]](0xef,0xbb,0xbf,0xef,0xbb,0xbf) + $utf8Encoding.GetBytes($jsonEncoding)))
  Confere (-not (Get-EstadoFontes $arquivoEncoding).valido) 'BOM UTF8 repetido rejeitado'
  foreach ($codificacao in @([Text.Encoding]::Unicode, [Text.Encoding]::BigEndianUnicode, [Text.Encoding]::UTF32, (New-Object Text.UTF32Encoding($true, $true, $true)))) {
    [IO.File]::WriteAllBytes($arquivoEncoding, ($codificacao.GetPreamble() + $codificacao.GetBytes($jsonEncoding)))
    Confere (-not (Get-EstadoFontes $arquivoEncoding).valido) "encoding $($codificacao.WebName) rejeitado"
  }
  [IO.File]::WriteAllBytes($arquivoEncoding, ([byte[]](0xff) + $utf8Encoding.GetBytes($jsonEncoding)))
  Confere (-not (Get-EstadoFontes $arquivoEncoding).valido) 'bytes UTF8 invalidos rejeitados'
  $json = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File $cliFontes -Arquivo $arquivoFontes -Json
  Confere ($LASTEXITCODE -eq 0 -and ($json | ConvertFrom-Json).valido) 'CLI stdout e JSON puro'
  $estado = Set-EstadoFonte travar claude-max $arquivoFontes
  Confere ($estado.valido -and $estado.bloqueadas.Count -eq 1) 'singleton preserva array'
  Confere (Test-Path -LiteralPath "$arquivoFontes.lock") 'primeiro writer cria marcador persistente'
  $pausaEstado = Join-Path $raizFontes 'publicacao-pausada.json'
  $markerPausa = [IO.File]::Open("$pausaEstado.lock", 'CreateNew', 'ReadWrite', 'None')
  try { Confere (-not (Get-EstadoFontes $pausaEstado).valido) 'reader bloqueia durante primeira publicacao com marcador ocupado' }
  finally { $markerPausa.Dispose() }
  Confere (-not (Get-EstadoFontes $pausaEstado).valido) 'marcador abandonado sem estado bloqueia'
  $recusouReinicio = $false
  try { $null = Set-EstadoFonte liberar claude-max $pausaEstado } catch { $recusouReinicio = $true }
  Confere ($recusouReinicio -and -not (Test-Path -LiteralPath $pausaEstado)) 'writer existente nao inicializa ausencia gerenciada'
  $perdaEstado = Join-Path $raizFontes 'estado-perdido.json'
  $null = Set-EstadoFonte travar claude-max $perdaEstado
  [IO.File]::Move($perdaEstado, "$perdaEstado.salvo")
  $rPerda = Invoke-BytesFontes ('-File "{0}" -Arquivo "{1}" -Json' -f $cliFontes, $perdaEstado)
  Confere ($rPerda.codigo -eq 3 -and -not ($rPerda.stdout | ConvertFrom-Json).valido) 'reader em outro processo bloqueia ausencia apos configuracao'
  $recusouReinicio = $false
  try { $null = Set-EstadoFonte travar chatgpt $perdaEstado } catch { $recusouReinicio = $true }
  Confere ($recusouReinicio -and -not (Test-Path -LiteralPath $perdaEstado)) 'writer nao reseta travas quando estado desaparece'
  [IO.File]::Move("$perdaEstado.salvo", $perdaEstado)
  Confere ((Get-EstadoFontes $perdaEstado).bloqueadas -contains 'claude-max') 'estado restaurado preserva trava previa'
  Confere ($estado.avisos[0] -ceq ('⚠️ Assinatura Claude travada por você.')) 'aviso exato'
  $rBytes = Invoke-BytesFontes ('-File "{0}" -Arquivo "{1}" -Json' -f $cliFontes, $arquivoFontes)
  Confere ($rBytes.codigo -eq 0 -and ($rBytes.stdout | ConvertFrom-Json).avisos[0] -ceq '⚠️ Assinatura Claude travada por você.' -and -not $rBytes.stderr) 'CLI JSON real usa bytes UTF8'
  foreach ($id in 'chatgpt', 'anthropic-api', 'antigravity', 'openrouter') {
    Confere (Test-FonteLiberada $id $arquivoFontes -Silencioso) "Claude nao bloqueia $id"
  }
  $null = Set-EstadoFonte travar claude-max $arquivoFontes
  Confere ((Get-EstadoFontes $arquivoFontes).bloqueadas.Count -eq 1) 'travar idempotente'
  $null = Set-EstadoFonte travar anthropic-api $arquivoFontes
  $estado = Set-EstadoFonte liberar claude-max $arquivoFontes
  Confere ($estado.bloqueadas.Count -eq 1 -and $estado.bloqueadas[0] -ceq 'anthropic-api') 'liberar preserva outras travas'
  foreach ($valor in '{', 'null', '[]', '[{"versao":1,"bloqueadas":[]}]', '{}', '{"versao":"1","bloqueadas":[]}', '{"versao":true,"bloqueadas":[]}',
      '{"versao":2,"bloqueadas":[]}', '{"versao":1,"bloqueadas":null}', '{"versao":1,"bloqueadas":"chatgpt"}',
      '{"versao":1,"bloqueadas":[null]}', '{"versao":1,"bloqueadas":[1]}', '{"versao":1,"bloqueadas":["CLAUDE-MAX"]}',
      '{"versao":1,"bloqueadas":["inexistente"]}', '{"versao":1,"bloqueadas":[],"vence":"ontem"}',
      '{/*comentario*/"versao":1,"bloqueadas":[]}', '{"versao":1,"bloqueadas":[],}',
      '{"versao":+1,"bloqueadas":[]}', '{"versao":01,"bloqueadas":[]}', '{"versao":.1,"bloqueadas":[]}',
      '{"versao":1,"bloqueadas":["chatgpt",]}') {
    [IO.File]::WriteAllText($arquivoFontes, $valor, $utf8)
    $estado = Get-EstadoFontes $arquivoFontes
    Confere (-not $estado.valido -and $estado.bloqueadas.Count -eq 5) "invalido bloqueia: $valor"
    $falhou = $false
    try { $null = Set-EstadoFonte liberar claude-max $arquivoFontes } catch { $falhou = $true }
    Confere ($falhou -and [IO.File]::ReadAllText($arquivoFontes) -ceq $valor) 'mutacao nao sobrescreve invalido'
  }
  foreach ($versao in '1.0', '1e0') {
    [IO.File]::WriteAllText($arquivoFontes, ('{"versao":' + $versao + ',"bloqueadas":[]}'), $utf8)
    Confere ((Get-EstadoFontes $arquivoFontes).valido) 'versao numerica 1 aceita como no JS'
  }
  [IO.File]::WriteAllText($arquivoFontes, '{"bloqueadas":["claude\u002dmax"],"versao":1}', $utf8)
  Confere ((Get-EstadoFontes $arquivoFontes).valido) 'ordem inversa e escapes JSON validos'
  [IO.File]::WriteAllText($arquivoFontes, '{"versao":1,"bloqueadas":[]}', $utf8)
  $travaLeitura = [IO.File]::Open($arquivoFontes, 'Open', 'ReadWrite', 'None')
  try { Confere (-not (Get-EstadoFontes $arquivoFontes).valido) 'ilegivel bloqueia tudo' } finally { $travaLeitura.Dispose() }
  $procFontes = @()
  $arquivoConcorrente = Join-Path $raizFontes 'primeiros-writers.json'
  foreach ($id in @(Get-IdsFontes)) {
    $argumentos = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Acao travar -Fonte {1} -Arquivo "{2}" -Json' -f $cliFontes, $id, $arquivoConcorrente
    $procFontes += Start-Process -FilePath $shellFontes -ArgumentList $argumentos -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $raizFontes "$id.json") -RedirectStandardError (Join-Path $raizFontes "$id.err")
    $null = $procFontes[-1].Handle
  }
  foreach ($procFonte in $procFontes) { $procFonte.WaitForExit(); Confere ($procFonte.ExitCode -eq 0) 'mutacao concorrente concluiu' }
  Confere ((Get-EstadoFontes $arquivoConcorrente).bloqueadas.Count -eq 5) 'primeiros writers concorrentes preservam todas as travas'
  $arquivoGlobal = Get-ArquivoFontes
  [void][IO.Directory]::CreateDirectory((Split-Path -Parent $arquivoGlobal))
  [IO.File]::Copy($arquivoConcorrente, $arquivoGlobal)
  . (Join-Path $PSScriptRoot 'cota.ps1')
  Confere (-not (Update-CotaCodex)) 'refresh minimo Codex bloqueado antes do executavel'
  Confere (@(Get-CotaAgy 'EXECUTAVEL-NAO-EXISTE').Count -eq 0) 'agy nao consulta fonte travada'
  . (Join-Path $PSScriptRoot 'opencode-comum.ps1')
  Confere ((Get-FonteOpenCode 'anthropic/claude-opus-5') -ceq 'anthropic-api') 'Claude API separado'
  Confere ((Get-FonteOpenCode 'google/antigravity-claude-opus') -ceq 'antigravity') 'Claude Antigravity separado'
  $r = Invoke-OpenCodeRun 'NAO-EXISTE' $raizFontes $raizFontes 'openai/gpt-6-astra#high' '' '' (Join-Path $raizFontes 'oc.md') '' ''
  Confere ($r.codigo -eq 3) 'helper OpenCode barra chamada direta'
  $pacote = Join-Path $raizFontes 'pacote.md'; [IO.File]::WriteAllText($pacote, 'Pacote de teste offline.', $utf8)
  # PS5 transforma stderr nativo em NativeCommandError mesmo com redirecionamento.
  # Os avisos sao esperados; os asserts de exit/status continuam obrigatorios.
  $ErrorActionPreference = 'Continue'
  foreach ($familia in 'claude', 'gpt', 'gemini', 'openrouter') {
    $autor = if ($familia -eq 'claude') { 'gpt' } else { 'claude' }
    $saida = Join-Path $raizFontes "$familia.md"
    $null = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor $autor -Revisor $familia -Pasta $raizFontes -Pacote $pacote -Saida $saida -Nivel L1 -TentativaUnica 2>(Join-Path $raizFontes 'revisar.err')
    Confere ($LASTEXITCODE -eq 3) "revisar tentativa direta bloqueada $familia"
    Confere ((Get-Content "$saida.fonte.json" -Raw | ConvertFrom-Json).motivo -ceq 'fonte-travada') 'motivo registrado'
  }
  $saida = Join-Path $raizFontes 'reservas.md'
  $null = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'revisar.ps1') -Autor gpt -Pasta $raizFontes -Pacote $pacote -Saida $saida -Nivel L1 2>(Join-Path $raizFontes 'reservas.err')
  Confere ($LASTEXITCODE -eq 3) 'sem fonte elegivel retorna pendente'
  $rota = Get-Content "$saida.rota.json" -Raw | ConvertFrom-Json
  Confere ($rota.estado -eq 'pendente' -and @($rota.tentativas).Count -eq 2 -and @($rota.tentativas | Where-Object motivo -ne 'fonte-travada').Count -eq 0) 'reservas registram fonte-travada'
  foreach ($executor in 'agy', 'opencode', 'codex', 'openrouter') {
    $null = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'despachar.ps1') -Executor $executor -Pasta $raizFontes -Tarefa $pacote -Saida (Join-Path $raizFontes 'executor.md') 2>(Join-Path $raizFontes 'executor.err')
    Confere ($LASTEXITCODE -eq 3) "despacho bloqueado $executor"
  }
  $null = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'openrouter.ps1') -Pasta $raizFontes -Entrada $pacote -Saida (Join-Path $raizFontes 'or.md') -Modelos teste 2>(Join-Path $raizFontes 'openrouter.err')
  Confere ($LASTEXITCODE -eq 3) 'OpenRouter direto nao acessa chave nem rede'
  $painel = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'recursos.ps1')
  Confere ($LASTEXITCODE -eq 0 -and ($painel -join '') -match 'Assinatura Claude travada') 'painel exibe aviso'
  $fila = Get-Content (Join-Path $raizFontes 'dupla/_fila.json') -Raw | ConvertFrom-Json
  Confere ($fila.fila.Count -eq 0) 'fontes travadas excluidas da fila'
  $ErrorActionPreference = 'Stop'
  $wrapperAviso = Join-Path $raizFontes 'aviso-bytes.ps1'
  [IO.File]::WriteAllText($wrapperAviso, ('. "' + (Join-Path $PSScriptRoot 'fontes-comum.ps1') + '"' + "`n" + '$null = Test-FonteLiberada claude-max'), $utf8)
  $rBytes = Invoke-BytesFontes ('-File "{0}"' -f $wrapperAviso)
  Confere ($rBytes.codigo -eq 0 -and $rBytes.stderr.Trim() -ceq '⚠️ Assinatura Claude travada por você.') 'aviso helper real usa stderr UTF8'
  $desconhecida = $false
  try { $null = Test-FonteConsumo desconhecida (Join-Path $raizFontes 'desconhecida.md') } catch [ArgumentException] { $desconhecida = $true }
  Confere ($desconhecida -and -not (Test-Path (Join-Path $raizFontes 'desconhecida.md.fonte.json'))) 'fonte desconhecida e argumento sem sidecar de bloqueio'
  Confere ((Get-FonteOpenCode 'OPENAI/gpt-6.1-sol') -eq 'chatgpt') 'prefixo provedor case insensitive'
  $rBytes = Invoke-BytesFontes ('-File "{0}" -Executor opencode -Modelo outro/gpt-6.1-sol -Pasta "{1}" -Tarefa "{2}" -Saida "{3}"' -f (Join-Path $PSScriptRoot 'despachar.ps1'), $raizFontes, $pacote, (Join-Path $raizFontes 'provedor.md'))
  Confere ($rBytes.codigo -in 1,2) 'provedor nao suportado nao vira reserva codigo 3'
  $pastaRelativa = Join-Path $raizFontes 'saida-relativa'; [void][IO.Directory]::CreateDirectory($pastaRelativa)
  Push-Location $pastaRelativa
  try {
    $null = Test-FonteConsumo chatgpt 'relativo.md'
    Confere (Test-Path -LiteralPath (Join-Path $pastaRelativa 'relativo.md.fonte.json')) 'sidecar relativo segue PWD do PowerShell'
    $null = Set-EstadoFonte liberar chatgpt $arquivoGlobal
    Confere (Test-FonteConsumo chatgpt 'relativo.md') 'fonte liberada permite nova tentativa'
    Confere (-not (Test-Path -LiteralPath (Join-Path $pastaRelativa 'relativo.md.fonte.json'))) 'nova tentativa limpa sidecar antigo'
    $null = Set-EstadoFonte travar chatgpt $arquivoGlobal
  } finally { Pop-Location }
  $preferenciaIO = $ErrorActionPreference
  foreach ($modoIO in 'Continue', 'Stop') {
    $ErrorActionPreference = $modoIO
    Confere (-not (Test-FonteConsumo chatgpt (Join-Path $raizFontes 'pai-ausente/saida.md'))) "pai ausente preserva recusa com $modoIO"
    $saidaIO = Join-Path $raizFontes 'registro-ocupado.md'
    [IO.File]::WriteAllText("$saidaIO.fonte.json", '{}', $utf8)
    $ocupadoIO = [IO.File]::Open("$saidaIO.fonte.json", 'Open', 'ReadWrite', 'None')
    try {
      Confere (-not (Test-FonteConsumo chatgpt $saidaIO)) "write sidecar negado preserva recusa com $modoIO"
      $null = Set-EstadoFonte liberar chatgpt $arquivoGlobal
      Confere (Test-FonteConsumo chatgpt $saidaIO) "delete sidecar negado preserva decisao com $modoIO"
      $null = Set-EstadoFonte travar chatgpt $arquivoGlobal
    } finally { $ocupadoIO.Dispose() }
  }
  $ErrorActionPreference = $preferenciaIO
  $saidaModeloInvalido = Join-Path $raizFontes 'helper-modelo-invalido.md'
  $rModeloInvalido = Invoke-OpenCodeRun 'NAO-EXISTE' $raizFontes $raizFontes 'outro/modelo' '' '' $saidaModeloInvalido '' ''
  Confere ($rModeloInvalido.codigo -eq 2 -and $rModeloInvalido.corte -eq 'argumento' -and -not (Test-Path "$saidaModeloInvalido.cmd")) 'helper provedor invalido retorna contrato antes de efeitos'
  # Apenas os guards reais pos-Invoke do teste ao vivo; nenhuma preparacao/modelo e executado.
  $tokensLeitura = $null; $errosLeitura = $null
  $astLeitura = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'testar-trava-leitura.ps1'), [ref]$tokensLeitura, [ref]$errosLeitura)
  $guardsLeitura = @($astLeitura.FindAll({ param($no) $no -is [Management.Automation.Language.IfStatementAst] -and $no.Extent.Text -match '^if \(\$r.codigo -eq [23]\)' }, $true) | ForEach-Object { $_.Extent.Text })
  Confere ($guardsLeitura.Count -eq 2) 'guards reais do teste de leitura encontrados'
  $fixtureLeitura = Join-Path $raizFontes 'leitura-indisponivel.ps1'
  [IO.File]::WriteAllText($fixtureLeitura, ('$r = [pscustomobject]@{codigo=3}' + "`n" + ($guardsLeitura -join "`n") + "`nthrow 'SENTINELA: continuou avaliacao da trava.'"), $utf8)
  $rLeitura = Invoke-BytesFontes ('-File "{0}"' -f $fixtureLeitura)
  Confere ($rLeitura.codigo -eq 3 -and $rLeitura.stdout -match 'indisponivel' -and $rLeitura.stdout -notmatch 'FALHOU' -and $rLeitura.stderr -notmatch 'SENTINELA') 'teste leitura indisponivel nao gera falsas falhas'
  $tokensTravaOC = $null; $errosTravaOC = $null
  $astTravaOC = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'testar-trava-opencode.ps1'), [ref]$tokensTravaOC, [ref]$errosTravaOC)
  $guardsTravaOC = @($astTravaOC.FindAll({ param($no) $no -is [Management.Automation.Language.IfStatementAst] -and ($no.Extent.Text -match '^if \(\$LASTEXITCODE -eq 3\)' -or $no.Extent.Text -match '^if \(-not \(Test-FonteConsumo') }, $true))
  Confere ($guardsTravaOC.Count -eq 2) 'guards reais SoTrava e raw run encontrados'
  foreach ($guardOC in $guardsTravaOC) {
    $fixtureTravaOC = Join-Path $raizFontes 'guard-trava-opencode.ps1'
    $prefixoTravaOC = '. "' + (Join-Path $PSScriptRoot 'fontes-comum.ps1') + '"' + "`n" + '$LASTEXITCODE=3; $fonteTeste=''chatgpt''; $raiz=''' + $raizFontes.Replace("'", "''") + "'`n"
    [IO.File]::WriteAllText($fixtureTravaOC, ($prefixoTravaOC + $guardOC.Extent.Text + "`nthrow 'SENTINELA raw run nao deveria ser alcancado.'"), $utf8)
    $rTravaOC = Invoke-BytesFontes ('-File "{0}"' -f $fixtureTravaOC)
    Confere ($rTravaOC.codigo -eq 3 -and $rTravaOC.stdout -match 'indisponivel' -and $rTravaOC.stderr -notmatch 'SENTINELA') 'teste opencode para antes de parse ou consumo raw'
  }
  $funcEstado = (Get-Item Function:\Get-EstadoFontes).ScriptBlock
  $script:leiturasEstadoTeste = 0
  function Get-EstadoFontes {
    $script:leiturasEstadoTeste++
    if ($script:leiturasEstadoTeste -gt 1) { throw 'Segunda leitura indevida.' }
    [pscustomobject]@{ valido = $false; bloqueadas = @(Get-IdsFontes); avisos = @('Estado invalido simulado.') }
  }
  try {
    $saidaSnapshot = Join-Path $raizFontes 'snapshot.md'
    $null = Test-FonteConsumo chatgpt $saidaSnapshot
    $registroSnapshot = Get-Content "$saidaSnapshot.fonte.json" -Raw | ConvertFrom-Json
    Confere ($script:leiturasEstadoTeste -eq 1 -and $registroSnapshot.motivo -eq 'estado-invalido') 'decisao aviso e registro usam mesma leitura'
  } finally { Set-Item Function:\Get-EstadoFontes $funcEstado }
  # Funcoes reais do OpenRouter, mas transporte substituido por sentinela sem rede.
  $tokensRouter = $null; $errosRouter = $null
  $astRouter = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'openrouter.ps1'), [ref]$tokensRouter, [ref]$errosRouter)
  $funcoesRouter = @($astRouter.FindAll({ param($no) $no -is [Management.Automation.Language.FunctionDefinitionAst] -and $no.Name -in 'Parar','ArquivosGravados','Chamar' }, $true) | ForEach-Object { $_.Extent.Text })
  Confere ($funcoesRouter.Count -eq 3) 'funcoes reais OpenRouter encontradas'
  $parcialRouter = Join-Path $raizFontes 'router-parcial.md'
  $fixtureRouter = '. "' + (Join-Path $PSScriptRoot 'fontes-comum.ps1') + '"' + "`n" +
    '$Papel = ''fazer''; $gravados = [ordered]@{''mock.txt''=12}; $utf8 = New-Object Text.UTF8Encoding($false)' + "`n" +
    '$Saida = ''' + $parcialRouter.Replace("'", "''") + "'`n" +
    '$http = [pscustomobject]@{}; $http | Add-Member ScriptMethod SendAsync { throw ''SENTINELA consumo indevido'' }' + "`n" +
    ($funcoesRouter -join "`n") + "`nChamar 'mock'"
  $scriptRouter = Join-Path $raizFontes 'router-parcial.ps1'; [IO.File]::WriteAllText($scriptRouter, $fixtureRouter, (New-Object Text.UTF8Encoding($true)))
  $rBytes = Invoke-BytesFontes ('-File "{0}"' -f $scriptRouter)
  Confere ($rBytes.codigo -eq 3 -and $rBytes.stderr -notmatch 'SENTINELA') 'OpenRouter para antes de novo POST'
  $textoParcial = [IO.File]::ReadAllText($parcialRouter)
  Confere ($textoParcial -match 'mock.txt \(12 bytes\)' -and $textoParcial -match 'STATUS: TRAVADO') 'OpenRouter preserva relatorio parcial ao travar'
  $fixtureRouterIO = $fixtureRouter.Replace($parcialRouter, (Join-Path $raizFontes 'pai-ausente/router.md'))
  [IO.File]::WriteAllText($scriptRouter, $fixtureRouterIO, (New-Object Text.UTF8Encoding($true)))
  $rRouterIO = Invoke-BytesFontes ('-File "{0}"' -f $scriptRouter)
  Confere ($rRouterIO.codigo -eq 3 -and $rRouterIO.stderr -match 'relatorio parcial') 'OpenRouter preserva exit3 se relatorio parcial falha IO'
  $null = Set-EstadoFonte liberar antigravity $arquivoGlobal
  . (Join-Path $PSScriptRoot 'revisao-comum.ps1')
  $saidaMock = Join-Path $raizFontes 'mock-reserva.md'
  [IO.File]::WriteAllText("$saidaMock.fonte.json", '{"fonte":"claude-max","motivo":"fonte-travada"}', $utf8)
  $codigoMock = Invoke-RevisaoComReserva -Rotas @('claude', 'gemini') -Saida $saidaMock -Executar {
    param($familiaMock, $arquivoMock)
    $fonteMock = if ($familiaMock -eq 'claude') { 'claude-max' } else { 'antigravity' }
    if (-not (Test-FonteConsumo $fonteMock $arquivoMock)) { return 3 }
    [IO.File]::WriteAllText($arquivoMock, "## Veredito`naprovado - mock offline`n## Achados`nnenhum achado`n## Não conferido`nrede nao testada", $utf8)
    return 0
  }
  $rotaMock = Get-Content "$saidaMock.rota.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  Confere ($codigoMock -eq 0 -and $rotaMock.familia -eq 'gemini' -and $rotaMock.tentativas[0].motivo -eq 'fonte-travada') 'reserva autorizada continua apos fonte bloqueada (mock)'
  Confere (-not (Test-Path -LiteralPath "$saidaMock.fonte.json")) 'reserva com sucesso limpa sidecar top-level antigo'
  [IO.File]::WriteAllText($arquivoGlobal, '{', $utf8)
  $json = & $shellFontes -NoProfile -ExecutionPolicy Bypass -File $cliFontes -Json
  Confere ($LASTEXITCODE -eq 3 -and -not ($json | ConvertFrom-Json).valido) 'JSON invalido sinaliza sem poluir stdout'
  Confere (-not (Update-CotaCodex)) 'refresh tambem bloqueado com estado invalido'
  # Copia apenas o prefixo real de carregamento e troca todo o resto por sentinela:
  # mesmo se a regressao voltar, este teste nao contem nenhum ponto de consumo.
  $pastaSemHelper = Join-Path $raizFontes 'sem-helper'
  [void][IO.Directory]::CreateDirectory($pastaSemHelper)
  foreach ($nomeSemHelper in 'cota.ps1', 'opencode-comum.ps1', 'fontes.ps1', 'openrouter.ps1', 'revisar.ps1', 'despachar.ps1', 'recursos.ps1') {
    $fonteSemHelper = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $nomeSemHelper))
    $inicioSemHelper = if ($nomeSemHelper -in 'revisar.ps1', 'despachar.ps1', 'recursos.ps1') {
      $fimCarga = ". (Join-Path `$PSScriptRoot 'cota.ps1')"
      $fimIndice = $fonteSemHelper.IndexOf($fimCarga)
      Confere ($fimIndice -ge 0) "prefixo de carga encontrado $nomeSemHelper"
      $fonteSemHelper.Substring(0, $fimIndice + $fimCarga.Length)
    } else {
      $fimCarga = "catch { throw 'Controle de fontes indisponivel; consumo bloqueado.' }"
      $fimIndice = $fonteSemHelper.IndexOf($fimCarga)
      Confere ($fimIndice -ge 0) "prefixo de helper encontrado $nomeSemHelper"
      $fonteSemHelper.Substring(0, $fimIndice + $fimCarga.Length)
    }
    [IO.File]::WriteAllText((Join-Path $pastaSemHelper $nomeSemHelper), ($inicioSemHelper + "`nthrow 'SENTINELA: continuou sem helper.'"), (New-Object Text.UTF8Encoding($true)))
  }
  $ErrorActionPreference = 'Continue'
  foreach ($nomeSemHelper in 'cota.ps1', 'opencode-comum.ps1', 'fontes.ps1', 'openrouter.ps1', 'revisar.ps1', 'despachar.ps1', 'recursos.ps1') {
    $argsSemHelper = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $pastaSemHelper $nomeSemHelper))
    switch ($nomeSemHelper) {
      'fontes.ps1' { $argsSemHelper += '-Json' }
      'openrouter.ps1' { $argsSemHelper += @('-Pasta', $raizFontes, '-Entrada', $pacote, '-Saida', $saida, '-Modelos', 'mock') }
      'revisar.ps1' { $argsSemHelper += @('-Autor', 'gpt', '-Pasta', $raizFontes, '-Pacote', $pacote, '-Saida', $saida, '-Nivel', 'L1', '-TentativaUnica') }
      'despachar.ps1' { $argsSemHelper += @('-Pasta', $raizFontes, '-Tarefa', $pacote, '-Saida', $saida) }
    }
    $erroSemHelper = Join-Path $raizFontes 'sem-helper.err'
    $null = & $shellFontes @argsSemHelper 2>$erroSemHelper
    $codigoSemHelper = $LASTEXITCODE
    $mensagemSemHelper = [IO.File]::ReadAllText($erroSemHelper)
    Confere ($codigoSemHelper -ne 0 -and $mensagemSemHelper -match 'Controle de fontes indisponivel' -and $mensagemSemHelper -notmatch 'SENTINELA') "helper ausente aborta $nomeSemHelper"
  }
  $ErrorActionPreference = 'Stop'
  . (Join-Path $PSScriptRoot 'cota.ps1')
  . (Join-Path $PSScriptRoot 'opencode-comum.ps1')
  Confere ($ErrorActionPreference -eq 'Stop') 'libraries nao alteram preferencia do chamador'
  Write-Output "OK: $casos casos; PowerShell $($PSVersionTable.PSVersion); artefatos isolados $raizFontes"
} finally {
  $env:LOCALAPPDATA = $localAnterior
  $env:USERPROFILE = $perfilAnterior
  $env:HOME = $homeEnvAnterior
  $env:TEMP = $tempAnterior
  $env:DUPLA_COTAS = $cotasAnterior
}
