# Seleção e aceite da revisão; não chama provedores ao carregar este arquivo.
function Test-ExemploAmbienteDiff([string]$Nome) {
  $arquivo = ($Nome -split '[\\/]')[-1]
  if ($arquivo -imatch '^\.env\.(?:example|sample|template|dist)$') { return $true }
  if ($arquivo -inotmatch '\.env\.(?:example|sample|template|dist)$') { return $false }
  $prefixo = $arquivo -ireplace '\.env\.(?:example|sample|template|dist)$', ''
  # A extensao de exemplo nao torna publico um prefixo que ja identifica segredo.
  -not (Test-NomeSensivelDiff $prefixo) -and $prefixo -inotmatch '(?:^|[._-])secrets?(?:[._-]|$)'
}

function Test-NomeSensivelDiff([string]$Nome) {
  # Exemplos de ambiente e chaves publicas podem ir ao anexo. Nao confundir codigo que
  # menciona credentials no nome com o arquivo de credenciais propriamente dito.
  if ($Nome -imatch '\.pub$' -or (Test-ExemploAmbienteDiff $Nome)) { return $false }
  $arquivo = ($Nome -split '[\\/]')[-1]
  # Preserva o historico *credentials antes de ponto/fim, mesmo em arquivos de fonte.
  if ($arquivo -imatch '^credentials|credentials(?:\.|$)') { return $true }
  $fonteConhecida = $arquivo -imatch '\.(?:py|ps1|psm1|psd1|[cm]?js|jsx|ts|tsx|cs|go|rs|rb|php|java|kt|swift|[ch]|cpp|hpp|sh|bat|cmd|lua|vue|svelte)$'
  if ($arquivo -imatch '\.env(?:\.|$)' -and -not $fonteConhecida) { return $true }
  # Marcador delimitado em arquivo nao-codigo e conservador: nao depende do formato
  # de dados nem perde backups/extensoes novas. Testes e fontes seguem revisaveis.
  if ($arquivo -imatch '(?:^|[._-])credentials\d*(?:[._-]|$)' -and -not $fonteConhecida) { return $true }
  $Nome -match '(?i)(^|[\\/])(?:\.env[^\\/]*|[^\\/]*\.env|id_[^\\/]*|[^\\/]*\.(?:pem|key|p12|pfx|kdbx|ppk)|[^\\/]*recovery.key[^\\/]*|[^\\/]*secrets?\.[^\\/]*|\.claude\.json|mcp_config\.json|service\.json)$'
}

function Test-AceiteParecer([string]$Texto, [string]$Log, [int]$Codigo, [string]$Papel = 'revisor') {
  $Codigo -eq 0 -and (Test-ParecerRevisao $Texto $Papel) -and
    -not (Test-RecusaSegurancaProvedor $Texto -ExigirPrefixo:(Test-ParecerRevisao $Texto $Papel)) -and -not (Test-RecusaSegurancaProvedor $Log) -and
    -not (Test-RespostaLimiteProvedor $Texto) -and -not (Test-RespostaLimiteProvedor $Log)
}

function Get-VereditoRevisao([string]$Texto) {
  [regex]::Match(((Get-TextoSemCercas $Texto) -replace '\*\*', ''), '(?im)^##\s+Veredito\s*\n\s*(aprovado com correções|aprovado|não comprovado|refazer)\b').Groups[1].Value
}

function Get-TextoSemCercas([string]$Texto) {
  $cerca = ''; $linhas = foreach ($l in ($Texto -split '\r?\n')) {
    if ($l -match '^\s*(`{3,}|~{3,})') {
      $marca = $Matches[1].Substring(0, 3)
      if (-not $cerca) { $cerca = $marca } elseif ($marca -eq $cerca) { $cerca = '' }
      continue
    }
    if (-not $cerca) { $l }
  }
  $linhas -join "`n"
}

function Test-RespostaLimiteProvedor([string]$Texto) {
  # Mensagem do provedor na resposta, inclusive quando o processo sai com zero.
  (Get-TextoSemCercas $Texto) -match '(?im)^\s*(?:(?:error|erro(?: do OpenCode)?)\s*:\s*(?:[\w.]+:\s*)?)?(?:you.ve hit your (?:usage )?limit|you.ve reached your (?:usage )?limit|usage.limit.(?:reached|exceeded)|RESOURCE_EXHAUSTED\b|insufficient_quota\b|credit balance is too low\b)'
}

function Test-LimiteExecutor([string]$Texto, [int]$Codigo) {
  $temRelatorio = $Texto -match '(?im)^STATUS:\s*(FEITO COM RESSALVA|FEITO|TRAVADO|FALTA CONTEXTO)\s*\r?\nRESUMO:\s*\S[^\r\n]*\s*\z'
  (Test-RespostaLimiteProvedor $Texto) -and ($Codigo -ne 0 -or -not $temRelatorio)
}

function Test-RecusaSegurancaProvedor([string]$Texto, [switch]$ExigirPrefixo) {
  # Só mensagem de erro/recusa, não uma menção ao controle no código que foi lido.
  if ($ExigirPrefixo) { $Texto = (((Get-TextoSemCercas $Texto) -split '\r?\n') | Where-Object { $_ -match '(?i)^\s*(?:error|erro(?: do OpenCode)?)\s*:' }) -join "`n" }
  (Get-TextoSemCercas $Texto) -match '(?im)^\s*(?:(?:error|erro(?: do OpenCode)?)\s*:\s*[^\r\n]{0,160})?(?:blocked by (?:a )?safety|content_filter\b|safety_policy\b|policy_violation\b|automatic approval review[^\r\n]{0,80}reject|revisão automática[^\r\n]{0,80}rejeit)'
}

function Get-RotasRevisao {
  param([string]$Autor, [string]$Revisor = '', [string]$Papel = 'revisor',
    [string]$Revisou = '', [switch]$SemReserva)
  if ($Autor -eq 'codex') { $Autor = 'gpt' }
  if ($Revisor -eq 'codex') { $Revisor = 'gpt' }
  if ($Revisou -eq 'codex') { $Revisou = 'gpt' }
  # Claude -> Astra, reserva Argon (usuário, 2026-11-07).
  $preferidas = @{ claude = @('gpt', 'gemini'); gpt = @('gemini', 'claude'); gemini = @('gpt', 'claude') }
  if (-not $preferidas.ContainsKey($Autor)) { throw 'Informe a família real do autor.' }
  if ($Papel -eq 'arbitro') {
    if (-not $Revisou -or $Revisou -eq $Autor) { throw 'Árbitro exige -Revisou com a família que realmente revisou (veja <Saida>.rota.json).' }
    $terceira = @('claude', 'gpt', 'gemini') | Where-Object { $_ -ne $Autor -and $_ -ne $Revisou }
    if ($Revisor -and $Revisor -notin $terceira -and $Revisor -ne 'openrouter') { throw 'Árbitro precisa ser da terceira família.' }
    if ($Revisor -eq 'openrouter') { return 'openrouter' }
    return $terceira
  }
  if ($Revisor -eq $Autor) { throw 'Autor e revisor da mesma família não contam como revisão cruzada.' }
  # OpenRouter só entra por escolha explícita; nunca é reserva automática paga.
  if ($Revisor -eq 'openrouter') { return 'openrouter' }
  if ($Revisor -and $Revisor -notin @('claude', 'gpt', 'gemini')) { throw 'Revisor inválido.' }
  $rotas = @()
  if ($Revisor) { $rotas += $Revisor }
  $rotas += $preferidas[$Autor]
  $rotas = @($rotas | Select-Object -Unique)
  if ($SemReserva) { return $rotas[0] }
  $rotas
}

function Test-ParecerRevisao {
  param([string]$Texto, [string]$Papel = 'revisor')
  # Um exemplo cercado por ``` não é um parecer emitido pelo revisor.
  $textoFora = (Get-TextoSemCercas $Texto) -replace '\*\*', ''
  $secoes = if ($Papel -eq 'arbitro') { @('Arbitragem', 'Decisões', 'Fora da pauta') } else { @('Veredito', 'Achados', 'Não conferido') }
  foreach ($secao in $secoes) {
    $trecho = [regex]::Match($textoFora, ('(?ims)^##\s+' + [regex]::Escape($secao) + '\s*\n(.*?)(?=^##\s|\z)'))
    if (-not $trecho.Success -or [regex]::Matches($trecho.Groups[1].Value, '\p{L}').Count -lt 4) { return $false }
  }
  if ($Papel -eq 'arbitro') {
    $decisoes = [regex]::Matches($textoFora, '(?ims)^\d+[.)]\s+[^\n]+fica com:\s*(?:autor|revisor|usuário)\b.*?(?=^\d+[.)]\s|^##\s|\z)')
    if (-not $decisoes.Count) { return $false }
    foreach ($decisao in $decisoes) {
      if ($decisao.Value -notmatch '(?im)^\s*Por qu[eê]:\s*[^\r\n]*\p{L}[^\r\n]*\p{L}[^\r\n]*\p{L}') { return $false }
    }
    return $textoFora -match '(?im)^##\s+Arbitragem\s*$' -and
      $textoFora -match '(?im)^##\s+Decisões\s*$' -and
      $textoFora -match '(?im)^##\s+Fora da pauta\s*$' -and
      $textoFora -match '(?im)^\d+[.)]\s+.+fica com:\s*(autor|revisor|usuário)\b'
  }
  $veredito = '(?im)^##\s+Veredito\s*\n\s*(aprovado com correções|aprovado|não comprovado|refazer)\b[^\n]*'
  return $textoFora -match $veredito -and
    $textoFora -match '(?im)^##\s+Achados\s*\n\s*[^#\s]' -and
    $textoFora -match '(?im)^##\s+Não conferido\s*\n\s*[^#\s]'
}

function Invoke-RevisaoComReserva {
  param([string[]]$Rotas, [string]$Saida, [string]$Papel = 'revisor',
    [string]$PacoteSha256 = '',
    [Parameter(Mandatory)][scriptblock]$Executar)
  $utf8 = New-Object Text.UTF8Encoding($false)
  # Resultado antigo nunca pode passar por aprovação desta chamada.
  foreach ($sufixo in @('', '.modelo', '.log', '.rota.json', '.nivel.json', '.fonte.json')) {
    Remove-Item -LiteralPath "$Saida$sufixo" -ErrorAction SilentlyContinue
  }
  $tentativas = @(); $familiaFinal = $null; $codigoFinal = 3
  foreach ($familia in $Rotas) {
    $numero = $tentativas.Count + 1
    $arquivo = "$Saida.tentativa-$numero-$familia.md"
    foreach ($sufixo in @('', '.modelo', '.log', '.nivel.json', '.fonte.json')) { Remove-Item -LiteralPath "$arquivo$sufixo" -ErrorAction SilentlyContinue }
    Write-Host "revisão: tentativa $numero, família $familia, papel $Papel"
    try { $codigo = & $Executar $familia $arquivo } catch { Write-Host $_.Exception.Message; $codigo = 1 }
    $parecer = if (Test-Path -LiteralPath $arquivo) { [IO.File]::ReadAllText($arquivo) } else { '' }
    $logTentativa = if (Test-Path -LiteralPath "$arquivo.log") { [IO.File]::ReadAllText("$arquivo.log") } else { '' }
    if ((Test-RecusaSegurancaProvedor $parecer -ExigirPrefixo:(Test-ParecerRevisao $parecer $Papel)) -or (Test-RecusaSegurancaProvedor $logTentativa)) { $codigo = 2 }
    $completo = Test-AceiteParecer $parecer $logTentativa $codigo $Papel
    $fonteRecusada = if (Test-Path -LiteralPath "$arquivo.fonte.json") { Get-Content -LiteralPath "$arquivo.fonte.json" -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $motivo = if ($codigo -eq 3 -and $fonteRecusada.motivo -in 'fonte-travada', 'estado-invalido') { $fonteRecusada.motivo } elseif ($completo) { 'completo' } elseif ($codigo -eq 2) { 'seguranca-ou-argumento' }
      elseif ((Test-RespostaLimiteProvedor $parecer) -or (Test-RespostaLimiteProvedor $logTentativa)) { 'limite' }
      elseif ($codigo -eq 3) { 'indisponivel' } elseif ($codigo -ne 0) { 'processo' }
      elseif (-not $parecer.Trim()) { 'vazio' } else { 'formato' }
    $tentativas += [ordered]@{ familia = $familia; codigo = $codigo; motivo = $motivo; parecerCompleto = $completo; arquivo = $arquivo }
    if ($completo) {
      Copy-Item -LiteralPath $arquivo -Destination $Saida
      foreach ($sufixo in '.modelo', '.log', '.nivel.json') {
        if (Test-Path -LiteralPath "$arquivo$sufixo") { Copy-Item -LiteralPath "$arquivo$sufixo" -Destination "$Saida$sufixo" }
      }
      $familiaFinal = $familia; $codigoFinal = 0
      break
    }
    # Argumento inválido ou trava de segurança não autorizam trocar de provedor para contornar.
    if ($codigo -eq 2) { $codigoFinal = 2; break }
    Write-Host "sem parecer completo de $familia ($motivo, código $codigo); tentando a próxima família elegível"
  }
  $vereditoFinal = if ($codigoFinal -eq 0 -and $Papel -eq 'revisor') {
    Get-VereditoRevisao $parecer
  } else { $null }
  $registro = [ordered]@{ estado = $(if ($codigoFinal -eq 0) { 'revisado' } else { 'pendente' });
    chamada = [guid]::NewGuid().ToString(); pacoteSha256 = $PacoteSha256; veredito = $vereditoFinal;
    etapaLiberada = $false; avaliacao = 'A autora deve julgar os achados e conferir os testes antes de liberar a etapa.';
    familia = $familiaFinal; papel = $Papel; tentativas = $tentativas }
  [IO.File]::WriteAllText("$Saida.rota.json", ($registro | ConvertTo-Json -Depth 5), $utf8)
  if ($codigoFinal -ne 0) {
    Write-Host 'REVISÃO PENDENTE: nenhuma aprovação emitida. Preserve o trabalho; não libere a etapa que exige revisão.'
  }
  $codigoFinal
}


function Resolve-CommitDiff([string]$Ref) {
  # So um commit, nunca blob (HEAD:caminho) nem opcao passada ao show.
  try {
    $oidEntrada = @(git rev-parse --verify --end-of-options $Ref 2>$null)
    if ($LASTEXITCODE -ne 0 -or $oidEntrada.Count -ne 1 -or $oidEntrada[0] -notmatch '^[0-9a-f]{40,64}$') { throw 'referencia invalida' }
    # O sufixo vai no OID resolvido: em HEAD:caminho^{commit} ele poderia ser parte
    # literal do nome do arquivo, sem assegurar que o objeto fosse um commit.
    $oidDiff = @(git rev-parse --verify --end-of-options "$($oidEntrada[0])^{commit}" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $oidDiff.Count -ne 1 -or $oidDiff[0] -notmatch '^[0-9a-f]{40,64}$') { throw 'nao e commit' }
    $oidDiff[0]
  } catch { throw (New-Object ArgumentException "Referencia de commit invalida: $Ref") }
}

# Uma unica coleta de escopo para anexo e risco. Sem -ComPatch, nunca le patch
# nem conteudo de segredo rastreado; os novos nao sensiveis sao lidos so uma vez.
function Invoke-GitRecorte([string[]]$Argumentos) {
  $ErrorActionPreference = 'Continue'
  $textoGit = @(& git @Argumentos 2>$null)
  if ($LASTEXITCODE -ne 0) { throw "git $($Argumentos -join ' ') falhou" }
  $textoGit
}

function Get-RecorteDiff([string]$Pasta, [string]$Ref = '', [string]$Base = '',
    [switch]$SemUltimoCommit, [switch]$ComPatch, [switch]$CommitUnico) {
  Push-Location -LiteralPath $Pasta -ErrorAction Stop
  try {
    try { $dentroGit = @(Invoke-GitRecorte @('rev-parse','--is-inside-work-tree')) }
    catch { throw (New-Object ArgumentException "pasta sem git: $Pasta") }
    if ($dentroGit.Count -ne 1 -or $dentroGit[0].Trim() -ine 'true') { throw (New-Object ArgumentException "pasta nao e arvore de trabalho Git: $Pasta") }
    $fontes = @(); $oidHead = ''; $num = @(); $patch = @(); $novos = @()
    if ($Ref) {
      if ($Ref -match '\.\.' -and -not $CommitUnico) {
        $intervalo = [regex]::Match($Ref, '^(.*?)(\.\.\.?)(.*)$')
        if (-not $intervalo.Success) { throw (New-Object ArgumentException 'intervalo de commits invalido') }
        $inicio = if ($intervalo.Groups[1].Value) { $intervalo.Groups[1].Value } else { 'HEAD' }
        $fim = if ($intervalo.Groups[3].Value) { $intervalo.Groups[3].Value } else { 'HEAD' }
        $oidInicio = Resolve-CommitDiff $inicio
        $oidFim = Resolve-CommitDiff $fim
        if ($intervalo.Groups[2].Value -eq '...') {
          try { $null = Invoke-GitRecorte @('merge-base',$oidInicio,$oidFim) }
          catch { throw (New-Object ArgumentException "intervalo sem ancestral comum: $Ref") }
        }
        $fontes += ,@('diff',"$oidInicio$($intervalo.Groups[2].Value)$oidFim")
      }
      else { $oidCommit = Resolve-CommitDiff $Ref; $fontes += ,@('show','--format=','--diff-merges=first-parent','--root',$oidCommit) }
      $origem = "diff de $Ref"; $alvo = "commit $Ref"
    } else {
      try { $oidHead = (Invoke-GitRecorte @('rev-parse','--verify','-q','HEAD') | Select-Object -First 1) } catch { }
      $baseOid = if ($oidHead) { $oidHead } else { '4b825dc642cb6eb9a060e54bf8d69288fbee4904' }
      if ($Base) {
        try {
          $baseRef = Resolve-CommitDiff $Base
          $baseOid = Invoke-GitRecorte @('merge-base',$baseRef,$oidHead)
        } catch { throw (New-Object ArgumentException "base invalida ou sem ancestral comum: $Base") }
      }
      $fontes += ,@('diff',$baseOid)
      $fontes += ,@('diff','--cached',$baseOid)
      $origem = if ($Base) { "diff contra $Base" } else { 'diff nao commitado' }
      $alvo = if ($Base) { "contra $Base" } else { 'nao commitado' }
    }
    $arvore = @{}; $indiceFonte = 0
    $soma = { param($s) $t = 0; foreach ($i in 0,1) { if ($s[$i] -match '^\d+$') { $t += [int]$s[$i] } }; $t }
    foreach ($fonte in $fontes) {
      $estatisticas = @(Invoke-GitRecorte (@('-c','core.quotePath=false') + $fonte + @('--no-renames','--numstat')))
      # max(staged, arvore), por caminho: nao duplica linhas preparadas e mantidas.
      foreach ($n in $estatisticas) {
        $c = $n -split "`t", 3; if ($c.Count -lt 3) { continue }
        if (-not $arvore.ContainsKey($c[2]) -or (& $soma $c) -gt (& $soma ($arvore[$c[2]] -split "`t",3))) { $arvore[$c[2]] = $n }
      }
      if ($ComPatch) {
        # Patch preserva renames: se um dos nomes e sensivel, a secao inteira sai.
        $parte = @(Invoke-GitRecorte (@('-c','core.quotePath=false') + $fonte + @('--patch')))
        if ($indiceFonte -gt 0 -and $parte.Count) { $patch += @('', '# --- preparado para commit (git diff --cached) ---', '') }
        $patch += $parte
      }
      $indiceFonte++
    }
    $num = @($arvore.Values)
    if (-not $Ref) {
      foreach ($n in @(Invoke-GitRecorte @('-c','core.quotePath=false','ls-files','--others','--exclude-standard'))) {
        $sensivel = Test-NomeSensivelDiff $n; $conteudo = @(); $linhas = 0
        if (-not $sensivel) {
          try {
            if ($ComPatch) { $conteudo = @(Get-Content -LiteralPath $n -Encoding UTF8 -ErrorAction Stop); $linhas = $conteudo.Count }
            else {
              $caminhoNovo = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($n)
              $leitor = [IO.File]::OpenText($caminhoNovo)
              try { while ($null -ne $leitor.ReadLine()) { $linhas++ } } finally { $leitor.Dispose() }
            }
          }
          catch { $conteudo = @('(binario ou ilegivel)') }
        }
        $num += "$linhas`t0`t$n"
        $novos += [pscustomobject]@{ caminho=$n; sensivel=$sensivel; linhas=$linhas; conteudo=$(if ($ComPatch) { $conteudo } else { @() }) }
      }
      if (-not $num.Count -and -not $SemUltimoCommit -and $oidHead) {
        $ultimo = Get-RecorteDiff $Pasta $oidHead -ComPatch:$ComPatch -SemUltimoCommit
        $ultimo.origem = 'arvore limpa, ultimo commit'
        return $ultimo
      }
    }
    [pscustomobject]@{ numstat=@($num); patch=@($patch); novos=@($novos); origem=$origem; alvo=$alvo }
  } finally { Pop-Location }
}

# Aceita os dados ja coletados pela camada GPT; classificar nao rele seu conteudo.
function Get-NivelDiff([string]$pasta, [string]$ref, [string]$Base = '', [switch]$SemUltimoCommit, $Recorte = $null) {
  if (-not $Recorte) {
    try { $Recorte = Get-RecorteDiff $pasta $ref -Base $Base -SemUltimoCommit:$SemUltimoCommit }
    catch [ArgumentException] {
      if (-not $ref -and -not $Base -and $_.Exception.Message -like 'pasta sem git:*') {
        return [pscustomobject]@{ nivel='L1'; motivo=$_.Exception.Message }
      }
      throw
    }
    catch { return [pscustomobject]@{ nivel='L2'; motivo="medicao indisponivel: $($_.Exception.Message)" } }
  }
  $num = @($Recorte.numstat); $origem = $Recorte.origem
  $linhas = 0; $caminhos = @()
  foreach ($n in $num) {
    $c = $n -split "`t", 3
    if ($c.Count -lt 3) { continue }
    $caminhos += $c[2]
    foreach ($i in 0, 1) { if ($c[$i] -match '^\d+$') { $linhas += [int]$c[$i] } }
  }
  if (-not $caminhos.Count) { return [pscustomobject]@{ nivel = 'L1'; motivo = "$origem vazio" } }
  if (@($caminhos | Where-Object { Test-NomeSensivelDiff $_ }).Count) { return [pscustomobject]@{ nivel = 'L2'; motivo = "$origem toca nome sensivel (conteudo nao lido)" } }
  $risco = 'migra|migration|secret|segredo|prod|deploy|delete|apagar|pagamento|banco|\.sql|ofx'
  $perigosos = @($caminhos | Where-Object {
    # Excecoes so retiram o basename publico da regra .env; diretorios e outros
    # termos de risco (prod, deploy, secret etc.) continuam classificados.
    $semExemplo = if ($_ -imatch '\.pub$' -or (Test-ExemploAmbienteDiff $_)) { $_ -replace '[^\\/]+$', '' } else { $_ }
    $_ -imatch $risco -or $semExemplo -imatch '\.env'
  })
  if ($perigosos.Count) { return [pscustomobject]@{ nivel = 'L2'; motivo = "$origem toca caminho de risco ($($perigosos[0]))" } }
  if ($linhas -gt 400) { return [pscustomobject]@{ nivel = 'L2'; motivo = "$origem com $linhas linhas (mais de 400)" } }
  $soTexto = -not ($caminhos | Where-Object { $_ -notmatch '\.(md|txt)$' })
  if ($soTexto -and $linhas -lt 30) { return [pscustomobject]@{ nivel = 'L0'; motivo = "$origem só .md/.txt, $linhas linhas" } }
  [pscustomobject]@{ nivel = 'L1'; motivo = "$origem com $linhas linhas em $($caminhos.Count) arquivo(s)" }
}
