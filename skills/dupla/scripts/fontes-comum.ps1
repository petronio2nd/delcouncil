# Chave global: ausencia inicial sem marcador libera; ausencia gerenciada/invalida bloqueia.
# Fontes sao canais de cobranca, nao familias. Nao ha vencimento nem liberacao automatica.
function Get-IdsFontes { @('claude-max', 'chatgpt', 'anthropic-api', 'antigravity', 'openrouter') }

function Test-CaminhoAbsolutoFontes([string]$Caminho) {
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { return $Caminho.Replace('\', '/') -match '^(?:[a-zA-Z]:/|//[^/]+/[^/]+(?:/|$))' }
  return $Caminho.StartsWith('/')
}

function Get-CasaFontes {
  $casaFontes = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
  if (-not $casaFontes -or -not (Test-CaminhoAbsolutoFontes $casaFontes)) { throw 'Home do usuario ausente ou relativo; consumo bloqueado.' }
  [IO.Path]::GetFullPath($casaFontes)
}

function Get-ArquivoFontes([string]$Arquivo = '') {
  if ($Arquivo) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Arquivo) }
  [IO.Path]::GetFullPath((Join-Path (Get-CasaFontes) '.local/share/dupla/fontes.json'))
}

function Test-ArquivoFontesAusente([string]$Caminho) {
  try { $null = [IO.File]::GetAttributes($Caminho); return $false }
  catch [IO.FileNotFoundException] { return $true }
  catch [IO.DirectoryNotFoundException] { return $true }
}

function Get-BloqueiosLegadosFontes {
  $baseLegado = Join-Path (Get-CasaFontes) 'AppData/Local'
  $candidatos = @((Join-Path $baseLegado 'dupla/fontes.json'))
  if ($env:LOCALAPPDATA) {
    if (-not (Test-CaminhoAbsolutoFontes $env:LOCALAPPDATA)) { throw 'LOCALAPPDATA legado relativo.' }
    $candidatos += Join-Path $env:LOCALAPPDATA 'dupla/fontes.json'
  }
  $pacotes = @()
  try { $pacotes = @([IO.Directory]::GetDirectories((Join-Path $baseLegado 'Packages'))) }
  catch [IO.DirectoryNotFoundException] { }
  foreach ($pacote in $pacotes) {
    if ([IO.Path]::GetFileName($pacote) -imatch '^Claude_') { $candidatos += Join-Path $pacote 'LocalCache/Local/dupla/fontes.json' }
  }
  $uniao = @()
  foreach ($legado in @($candidatos | ForEach-Object { [IO.Path]::GetFullPath($_) } | Select-Object -Unique)) {
    $estadoLegado = Get-EstadoFontes -Arquivo $legado
    if (-not $estadoLegado.valido) { throw 'Estado legado invalido ou ilegivel; migracao bloqueada.' }
    $uniao += $estadoLegado.bloqueadas
  }
  @(Get-IdsFontes) | Where-Object { $uniao -ccontains $_ }
}

function Get-AvisoFonte([string]$Fonte) {
  $nome = switch -CaseSensitive ($Fonte) {
    'claude-max' { 'Assinatura Claude' }; 'chatgpt' { 'Assinatura ChatGPT' }
    'anthropic-api' { 'API Anthropic' }; 'antigravity' { 'Antigravity' }; 'openrouter' { 'OpenRouter' }
    default { 'Fonte desconhecida' }
  }
  "$([char]0x26a0)$([char]0xfe0f) $nome travada por voc$([char]0xea)."
}

function Get-EstadoFontes([string]$Arquivo = '', [switch]$Inicial) {
  # -Inicial e interno: somente o writer que ganhou CreateNew do marcador pode usa-lo.
  $caminho = ''
  $ids = @(Get-IdsFontes)
  $bloqueadas = @(); $valido = $true; $motivo = ''; $avisos = @()
  try {
    $caminho = Get-ArquivoFontes $Arquivo
    $ausente = $false
    try {
      $leitura = [IO.File]::Open($caminho, 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      try {
        $leitor = New-Object IO.StreamReader($leitura, (New-Object Text.UTF8Encoding($false, $true)), $false)
        try { $texto = $leitor.ReadToEnd(); if ($texto.Length -gt 0 -and $texto[0] -eq [char]0xfeff) { $texto = $texto.Substring(1) } } finally { $leitor.Dispose() }
      } finally { $leitura.Dispose() }
    }
    catch [IO.FileNotFoundException] { $ausente = $true }
    catch [IO.DirectoryNotFoundException] { $ausente = $true }
    if ($ausente) {
      if (-not $Inicial) {
        # Ausencia so e inicial quando a ausencia do marcador tambem foi comprovada.
        # Marcador ocupado/ilegivel e erro; nunca usar File.Exists que mascara permissao.
        try {
          $marcador = [IO.File]::Open("$caminho.lock", 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
          $marcador.Dispose()
          throw 'Estado gerenciado ausente; consumo bloqueado.'
        } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
      }
      $iniciais = if (-not $Arquivo -and -not $Inicial) { @(Get-BloqueiosLegadosFontes) } else { @() }
      $texto = @{ versao = 1; bloqueadas = @($iniciais) } | ConvertTo-Json -Compress
    }
    # ConvertFrom-Json varia por shell (comentarios, virgula final, array unitario).
    # Gramatica pequena e estrita: objeto com numero e array de strings, duas propriedades.
    # Nomes/versao/IDs continuam validados pelo objeto logo abaixo; escapes JSON sao aceitos.
    $w = '[ \t\r\n]*'
    $str = '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"'
    $num = '-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?'
    $arr = '\[' + $w + '(?:' + $str + '(?:' + $w + ',' + $w + $str + ')*)?' + $w + '\]'
    $propNum = $str + $w + ':' + $w + $num
    $propArr = $str + $w + ':' + $w + $arr
    $gramatica = '\A' + $w + '\{' + $w + '(?:' + $propNum + $w + ',' + $w + $propArr + '|' + $propArr + $w + ',' + $w + $propNum + ')' + $w + '\}' + $w + '\z'
    if ($texto -cnotmatch $gramatica) { throw 'Estado deve ser JSON estrito com objeto de duas propriedades.' }
    $d = ConvertFrom-Json -InputObject $texto -ErrorAction Stop
    if ($null -eq $d -or $d -isnot [pscustomobject] -or
        @($d.PSObject.Properties.Name).Count -ne 2 -or
        @($d.PSObject.Properties.Name) -cnotcontains 'versao' -or
        @($d.PSObject.Properties.Name) -cnotcontains 'bloqueadas' -or
        ($d.versao -isnot [int] -and $d.versao -isnot [long] -and $d.versao -isnot [double] -and $d.versao -isnot [decimal]) -or $d.versao -ne 1 -or
        $d.bloqueadas -isnot [array]) { throw 'Formato invalido.' }
    foreach ($id in $d.bloqueadas) {
      if ($id -isnot [string] -or $ids -cnotcontains $id) { throw 'Fonte desconhecida.' }
    }
    $bloqueadas = @($d.bloqueadas | Select-Object -Unique)
    $avisos = @($bloqueadas | ForEach-Object { Get-AvisoFonte $_ })
  } catch {
    $valido = $false; $motivo = 'estado-invalido'; $bloqueadas = $ids
    $avisos = @("$([char]0x26a0)$([char]0xfe0f) Estado das fontes invalido ou ilegivel; consumo bloqueado. Corrija o arquivo de estado antes de continuar.")
  }
  [pscustomobject]@{ versao = 1; bloqueadas = @($bloqueadas); valido = $valido; arquivo = $caminho; motivo = $motivo; avisos = @($avisos) }
}

function Write-AvisoFonte([string]$Mensagem) {
  # UTF-8 nos bytes de stderr sem alterar Console.OutputEncoding do chamador dot-source.
  $bytesAviso = (New-Object Text.UTF8Encoding($false)).GetBytes($Mensagem + [Environment]::NewLine)
  $stderrFonte = [Console]::OpenStandardError()
  $stderrFonte.Write($bytesAviso, 0, $bytesAviso.Length)
  $stderrFonte.Flush()
}

function Test-FonteLiberada([string]$Fonte, [string]$Arquivo = '', [switch]$Silencioso, $Estado = $null) {
  if ($null -eq $Estado) { $Estado = Get-EstadoFontes $Arquivo }
  $mensagem = if (-not $estado.valido) { $estado.avisos[0] }
    elseif (@(Get-IdsFontes) -cnotcontains $Fonte) { 'Fonte de consumo desconhecida; consumo bloqueado.' }
    elseif ($estado.bloqueadas -ccontains $Fonte) { Get-AvisoFonte $Fonte }
  if ($mensagem) { if (-not $Silencioso) { Write-AvisoFonte $mensagem }; return $false }
  return $true
}

function Get-FonteOpenCode([string]$Modelo) {
  if ($Modelo -imatch '^openai/') { return 'chatgpt' }
  if ($Modelo -imatch '^anthropic/') { return 'anthropic-api' }
  if ($Modelo -imatch '^google/antigravity-') { return 'antigravity' }
  return 'desconhecida'
}

function Test-FonteConsumo([string]$Fonte, [string]$Saida = '') {
  if (@(Get-IdsFontes) -cnotcontains $Fonte) { throw (New-Object ArgumentException 'Fonte de consumo desconhecida; corrija o argumento.') }
  if ($Saida) { $Saida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Saida) }
  $estado = Get-EstadoFontes
  $liberada = Test-FonteLiberada $Fonte -Estado $estado
  if ($Saida) {
    try {
      if ($liberada) { if ([IO.File]::Exists("$Saida.fonte.json")) { [IO.File]::Delete("$Saida.fonte.json") } }
      else {
        $motivo = if ($estado.valido) { 'fonte-travada' } else { 'estado-invalido' }
        $registro = [ordered]@{ fonte = $Fonte; motivo = $motivo }
        [IO.File]::WriteAllText("$Saida.fonte.json", ($registro | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
      }
    } catch { try { Write-AvisoFonte 'Registro auxiliar da fonte indisponivel; decisao de consumo preservada.' } catch { } }
  }
  return $liberada
}

function Set-EstadoFonte([ValidateSet('travar', 'liberar')][string]$Acao,
    [ValidateSet('claude-max', 'chatgpt', 'anthropic-api', 'antigravity', 'openrouter')][string]$Fonte,
    [string]$Arquivo = '') {
  if (@(Get-IdsFontes) -cnotcontains $Fonte) { throw 'Fonte desconhecida.' }
  $caminho = Get-ArquivoFontes $Arquivo
  $pastaFontes = Split-Path -Parent $caminho
  [void][IO.Directory]::CreateDirectory($pastaFontes)
  # FileShare.None serializa processos; marcador persistente impede liberar estado perdido.
  $limite = [DateTime]::UtcNow.AddSeconds(10); $travaFontes = $null; $temporario = $null; $criouLock = $false
  try {
    while (-not $travaFontes) {
      try { $travaFontes = [IO.File]::Open("$caminho.lock", 'CreateNew', 'ReadWrite', 'None'); $criouLock = $true }
      catch [IO.IOException] {
        try { $travaFontes = [IO.File]::Open("$caminho.lock", 'Open', 'ReadWrite', 'None') }
        catch [IO.IOException] { if ([DateTime]::UtcNow -ge $limite) { throw 'Estado ocupado; nenhuma fonte alterada.' }; Start-Sleep -Milliseconds 50 }
      }
    }
    $estado = Get-EstadoFontes $caminho -Inicial:$criouLock
    if (-not $estado.valido) { throw $estado.avisos[0] }
    $bloqueadas = @($estado.bloqueadas)
    # Importacao somente no primeiro estado canonico; -Arquivo permanece isolado.
    if (-not $Arquivo -and $criouLock -and (Test-ArquivoFontesAusente $caminho)) { $bloqueadas = @(Get-BloqueiosLegadosFontes) }
    if ($Acao -eq 'travar') { $bloqueadas = @(@($bloqueadas) + $Fonte | Select-Object -Unique) }
    else { $bloqueadas = @($bloqueadas | Where-Object { $_ -cne $Fonte }) }
    $dados = [ordered]@{ versao = 1; bloqueadas = @($bloqueadas) }
    $temporario = Join-Path $pastaFontes ('.fontes-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($temporario, ($dados | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
    $destinoAusente = $false
    try { $null = [IO.File]::GetAttributes($caminho) }
    catch [IO.FileNotFoundException] { $destinoAusente = $true }
    catch [IO.DirectoryNotFoundException] { $destinoAusente = $true }
    if ($destinoAusente) {
      if (-not $criouLock) { throw 'Estado gerenciado desapareceu; nenhuma fonte alterada.' }
      [IO.File]::Move($temporario, $caminho)
    } else { [IO.File]::Replace($temporario, $caminho, [NullString]::Value) }
    Get-EstadoFontes $caminho
  } finally {
    if ($temporario -and [IO.File]::Exists($temporario)) { [IO.File]::Delete($temporario) }
    if ($travaFontes) { $travaFontes.Dispose() }
  }
}
