# Revisor, árbitro ou executor por um modelo do OpenRouter, num laço de agente.
# Chamado pelo revisar.ps1 ou pelo despachar.ps1 (-Executor openrouter).
# Uso: openrouter.ps1 -Pasta <projeto> -Entrada <entrada.md> -Saida <saida.md> -Modelos <id1,id2> -Papel <revisor|arbitro|fazer>
#
# Revisor e árbitro só têm três ferramentas de leitura. Fazer também grava e edita arquivos,
# sempre presos à pasta do projeto, sem rodar comando. Arquivos de segredo (.env, chaves,
# credenciais) e a pasta .git ficam de fora, porque o conteúdo sai do computador.
# A chave vem de OPENROUTER_API_KEY (do processo ou do usuário, gravada com setx). Nunca vai para o log.

param(
  [Parameter(Mandatory)][string]$Pasta,
  [Parameter(Mandatory)][string]$Entrada,
  [Parameter(Mandatory)][string]$Saida,
  [Parameter(Mandatory)][string]$Modelos,
  [ValidateSet('revisor', 'arbitro', 'fazer')][string]$Papel = 'revisor',
  [ValidateSet('low', 'medium', 'high', 'xhigh')][string]$Esforco = 'high',
  [ValidateRange(0, 2147483647)][int]$MaxPassos = 0,
  [ValidateRange(0, 9223372036854775807)][long]$MaxBytes = 300000,
  [ValidateRange(0, 1.7976931348623157E+308)][double]$MaxCusto = 2.0
)

try { . ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'fontes-comum.ps1') -ErrorAction Stop).Path) }
catch { throw 'Controle de fontes indisponivel; consumo bloqueado.' }
$Saida = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Saida)
if (-not (Test-FonteConsumo openrouter $Saida)) { exit 3 }
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8

$chave = $env:OPENROUTER_API_KEY
if (-not $chave) { $chave = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User') }
if (-not $chave) { [Console]::Error.WriteLine('OPENROUTER_API_KEY não definida (setx OPENROUTER_API_KEY "<chave>")'); exit 1 }

$raiz = (Resolve-Path $Pasta).Path.TrimEnd('\')
$segredo = '(?i)(^|\\)(\.git(\\|$)|\.env[^\\]*$|[^\\]*\.(pem|key|pfx|p12|kdbx)$|id_(rsa|ed25519)[^\\]*$|[^\\]*(credential|secret|token)[^\\]*$)'
$pulaPastas = '(?i)\\(\.git|node_modules|\.venv|venv|__pycache__|dist|build)(\\|$)'
if ($MaxPassos -eq 0) { $MaxPassos = if ($Papel -eq 'fazer') { 60 } else { 30 } }
$maxTexto = 60000
$bytesGravados = 0L
$gravados = [ordered]@{}

function Caminho([string]$p) {
  if (-not $p) { $p = '.' }
  $cheio = if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $raiz $p }
  $cheio = [IO.Path]::GetFullPath($cheio).TrimEnd('\')
  if ($cheio -ne $raiz -and -not $cheio.StartsWith($raiz + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "fora da pasta do projeto: $p"
  }
  $rel = if ($cheio -eq $raiz) { '' } else { $cheio.Substring($raiz.Length + 1) }
  if ($rel -match $segredo) { throw "arquivo bloqueado (segredo ou .git): $p" }
  $cheio
}

function ArquivosGravados {
  if (-not $gravados.Count) { return 'nenhum' }
  ($gravados.GetEnumerator() | ForEach-Object { "$($_.Key) ($($_.Value) bytes)" }) -join ', '
}

function Parar([string]$motivo, [int]$codigo = 1) {
  [Console]::Error.WriteLine($motivo)
  if ($Papel -eq 'fazer' -and $gravados.Count) {
    [Console]::Error.WriteLine("Arquivos gravados: $(ArquivosGravados)")
  }
  if ($Papel -eq 'fazer' -and $codigo -eq 3) {
    $parcial = "# Execucao interrompida`n`nArquivos gravados: $(ArquivosGravados)`n`nSTATUS: TRAVADO`nRESUMO: $motivo`n"
    try { [IO.File]::WriteAllText($Saida, $parcial, $utf8) }
    catch { [Console]::Error.WriteLine('Nao foi possivel gravar o relatorio parcial; bloqueio preservado.') }
  }
  exit $codigo
}

function CaminhoEscrita([string]$p) {
  if ($Papel -ne 'fazer') { throw 'escrita permitida apenas no papel fazer' }
  if (-not $p) { throw 'path obrigatorio para escrita' }
  $f = Caminho $p
  $rel = $f.Substring($raiz.Length).TrimStart('\')
  if (('\' + $rel) -match $pulaPastas) { throw "pasta bloqueada para escrita: $rel" }
  # Recusa streams NTFS e nomes que o Windows trata como outro caminho.
  foreach ($parte in ($rel -split '\\')) {
    if ($parte.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
      $parte -match '[. ]$' -or $parte -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])($|\.)') {
      throw 'nome de arquivo invalido para escrita'
    }
  }
  # Inclui o destino e a raiz; verifica antes de criar qualquer pasta.
  $atual = $f
  while ($true) {
    $item = $null
    try { $item = Get-Item -LiteralPath $atual -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { }
    if ($item) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'escrita bloqueada em junction/symlink' }
      if ($atual -eq $f -and $item.PSIsContainer) { throw 'destino de escrita e uma pasta' }
      if ($atual -ne $f -and -not $item.PSIsContainer) { throw 'pasta-mae de escrita e um arquivo' }
    }
    if ($atual -eq $raiz) { break }
    $atual = [IO.Path]::GetDirectoryName($atual)
  }
  $f
}

function GravarArquivo([string]$p, [string]$conteudo, [string]$ferramenta) {
  $f = CaminhoEscrita $p
  $bom = $false
  if ([IO.File]::Exists($f)) {
    $leitor = [IO.File]::OpenRead($f)
    try { $bom = $leitor.ReadByte() -eq 239 -and $leitor.ReadByte() -eq 187 -and $leitor.ReadByte() -eq 191 }
    finally { $leitor.Dispose() }
  } else { $bom = [IO.Path]::GetExtension($f) -eq '.ps1' }
  $codificacao = New-Object System.Text.UTF8Encoding($bom)
  $bytes = [long]$codificacao.GetByteCount($conteudo) + $codificacao.GetPreamble().Length
  if ($bytes -gt 200000) { Parar "parou: arquivo excede o teto de 200000 bytes ($bytes bytes)" }
  if ($bytes -gt $MaxBytes - $script:bytesGravados) {
    Parar "parou: MaxBytes $MaxBytes excedido ($script:bytesGravados bytes ja gravados; tentativa de $bytes bytes)"
  }
  [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($f))
  # Confere de novo depois de criar as pastas.
  [void](CaminhoEscrita $p)
  [IO.File]::WriteAllText($f, $conteudo, $codificacao)
  $script:bytesGravados += $bytes
  $rel = $f.Substring($raiz.Length + 1)
  $script:gravados[$rel] = $bytes
  [Console]::Error.WriteLine("passo ${passo}: $ferramenta $rel ($bytes bytes)")
  "gravado: $rel ($bytes bytes)"
}

function EditarArquivo($a) {
  $f = CaminhoEscrita $a.path
  if (-not [IO.File]::Exists($f)) { throw 'arquivo nao existe para edicao' }
  if ([string]::IsNullOrEmpty($a.old_string)) { throw 'old_string deve ser um trecho nao vazio' }
  $texto = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
  $antigo = [string]$a.old_string
  $pos = $texto.IndexOf($antigo, [StringComparison]::Ordinal)
  if ($pos -lt 0) { throw 'old_string nao encontrado' }
  if ($texto.IndexOf($antigo, $pos + 1, [StringComparison]::Ordinal) -ge 0) { throw 'old_string aparece mais de uma vez' }
  $novo = $texto.Substring(0, $pos) + $a.new_string + $texto.Substring($pos + $antigo.Length)
  GravarArquivo $a.path $novo 'edit_file'
}

function Corta([string]$t) {
  if ($t.Length -gt $maxTexto) { $t.Substring(0, $maxTexto) + "`n[cortado em $maxTexto caracteres]" } else { $t }
}

function LerArquivo($a) {
  $f = Caminho $a.path
  if (-not (Test-Path $f -PathType Leaf)) { throw "arquivo não existe: $($a.path)" }
  $linhas = [IO.File]::ReadAllLines($f, [Text.Encoding]::UTF8)
  $ini = [Math]::Max(1, [int]$(if ($a.start_line) { $a.start_line } else { 1 }))
  $qtd = [int]$(if ($a.max_lines) { $a.max_lines } else { 800 })
  $fim = [Math]::Min($linhas.Count, $ini + $qtd - 1)
  $sb = New-Object System.Text.StringBuilder
  for ($i = $ini; $i -le $fim; $i++) { [void]$sb.AppendLine("$i`t$($linhas[$i - 1])") }
  if ($fim -lt $linhas.Count) { [void]$sb.AppendLine("[linhas $ini-$fim de $($linhas.Count); peça start_line=$($fim + 1) para continuar]") }
  Corta $sb.ToString()
}

function ListarPasta($a) {
  $d = Caminho $a.path
  if (-not (Test-Path $d -PathType Container)) { throw "pasta não existe: $($a.path)" }
  $itens = Get-ChildItem -LiteralPath $d -Force | ForEach-Object {
    if ($_.PSIsContainer) { "$($_.Name)\" } else { "$($_.Name)  ($($_.Length) bytes)" }
  }
  Corta (($itens | Select-Object -First 500) -join "`n")
}

function Buscar($a) {
  $d = Caminho $a.path
  $filtro = if ($a.glob) { $a.glob } else { '*' }
  $achados = @(Get-ChildItem -LiteralPath $d -Recurse -File -Filter $filtro -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $pulaPastas -and $_.Length -lt 2MB -and
      $_.FullName.Substring($raiz.Length).TrimStart('\') -notmatch $segredo } |
    Select-String -Pattern $a.pattern -Encoding UTF8 -ErrorAction SilentlyContinue |
    Select-Object -First 100 | ForEach-Object {
      $l = $_.Line.Trim(); if ($l.Length -gt 300) { $l = $l.Substring(0, 300) + '…' }
      "$($_.Path.Substring($raiz.Length + 1)):$($_.LineNumber): $l"
    })
  if (-not $achados.Count) { return 'nenhum resultado' }
  Corta ($achados -join "`n")
}

$ferramentas = @(
  @{ type = 'function'; function = @{ name = 'read_file'; description = 'Lê um arquivo de texto do projeto, com número de linha. Caminho relativo à pasta do projeto.'
      parameters = @{ type = 'object'; required = @('path'); properties = @{
          path = @{ type = 'string' }; start_line = @{ type = 'integer' }; max_lines = @{ type = 'integer' } } } } },
  @{ type = 'function'; function = @{ name = 'list_dir'; description = 'Lista o conteúdo de uma pasta do projeto ("." é a raiz).'
      parameters = @{ type = 'object'; required = @('path'); properties = @{ path = @{ type = 'string' } } } } },
  @{ type = 'function'; function = @{ name = 'grep'; description = 'Busca uma expressão regular nos arquivos do projeto (até 100 resultados, arquivo:linha: texto).'
      parameters = @{ type = 'object'; required = @('pattern'); properties = @{
          pattern = @{ type = 'string' }; path = @{ type = 'string' }; glob = @{ type = 'string'; description = 'filtro de nome, ex.: *.ps1' } } } } }
)

if ($Papel -eq 'fazer') {
  $ferramentas += @(
    @{ type = 'function'; function = @{ name = 'write_file'; description = 'Cria ou sobrescreve um arquivo UTF-8 dentro do projeto (ate 200000 bytes). Cria as pastas que faltarem.'
        parameters = @{ type = 'object'; required = @('path', 'content'); properties = @{
            path = @{ type = 'string' }; content = @{ type = 'string' } } } } },
    @{ type = 'function'; function = @{ name = 'edit_file'; description = 'Troca um trecho exato e unico de um arquivo do projeto. Erro se nao existir ou houver mais de uma ocorrencia.'
        parameters = @{ type = 'object'; required = @('path', 'old_string', 'new_string'); properties = @{
            path = @{ type = 'string' }; old_string = @{ type = 'string' }; new_string = @{ type = 'string' } } } } }
  )
}

$skillMaisPacote = [IO.File]::ReadAllText($Entrada, [Text.Encoding]::UTF8)
$papelTxt = if ($Papel -eq 'arbitro') { 'no papel de árbitro, e responda só no formato da seção Papel de árbitro' } else { 'e responda só no formato de saída da skill' }
$mensagens = New-Object System.Collections.ArrayList
if ($Papel -eq 'fazer') {
  [void]$mensagens.Add(@{ role = 'system'; content = "Voce e o executor de uma tarefa no projeto em $raiz. Use read_file, list_dir e grep para ler e write_file e edit_file para gravar, somente dentro dessa pasta. Nao ha como rodar comando; nao diga que rodou testes. Respeite os limites da tarefa. Termine com o relatorio que a tarefa pede, em portugues do Brasil, listando os arquivos gravados." })
  [void]$mensagens.Add(@{ role = 'user'; content = "Execute a tarefa abaixo no projeto em $raiz, respeitando seu escopo. Leia com read_file, list_dir e grep; grave somente dentro dessa pasta com write_file e edit_file. Nao ha ferramenta de comando; nao afirme ter rodado testes. Termine com o relatorio pedido, em portugues do Brasil, e liste os arquivos gravados.`n`n$skillMaisPacote" })
} else {
  [void]$mensagens.Add(@{ role = 'system'; content = "Você é o revisor da dupla, só leitura. A pasta do projeto é $raiz; use as ferramentas read_file, list_dir e grep para conferir a evidência no projeto antes de decidir. Responda em português do Brasil." })
  [void]$mensagens.Add(@{ role = 'user'; content = "Siga a skill abaixo, $papelTxt. Depois da skill vem o pacote.`n`n$skillMaisPacote" })
}

$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromMinutes(10)

function Chamar([string]$modelo) {
  if (-not (Test-FonteConsumo openrouter $Saida)) { Parar 'Fonte de consumo indisponivel; preserve o trabalho e use somente reserva autorizada.' 3 }
  $corpo = @{ model = $modelo; messages = $mensagens; tools = $ferramentas; reasoning = @{ effort = $Esforco }
    usage = @{ include = $true }; provider = @{ data_collection = 'deny' } } | ConvertTo-Json -Depth 30 -Compress
  $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, 'https://openrouter.ai/api/v1/chat/completions')
  $req.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $chave)
  $req.Headers.Add('X-Title', 'dupla-arbitro')
  $req.Content = New-Object System.Net.Http.StringContent($corpo, [Text.Encoding]::UTF8, 'application/json')
  $resp = $http.SendAsync($req).GetAwaiter().GetResult()
  $txt = [Text.Encoding]::UTF8.GetString($resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult())
  if (-not $resp.IsSuccessStatusCode) { throw "HTTP $([int]$resp.StatusCode): $txt" }
  $r = $txt | ConvertFrom-Json
  if ($r.error) { throw "erro do OpenRouter: $($r.error.message)" }
  $r
}

# O primeiro modelo da lista que responder fica até o fim; os outros são reserva só para a primeira chamada.
$lista = @($Modelos -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$modelo = $null
$custo = 0.0
for ($passo = 1; $passo -le $maxPassos; $passo++) {
  if (-not $modelo) {
    foreach ($m in $lista) {
      try { $r = Chamar $m; $modelo = $m; break }
      catch { [Console]::Error.WriteLine("modelo $m falhou: $($_.Exception.Message)") }
    }
    if (-not $modelo) { [Console]::Error.WriteLine('nenhum modelo respondeu'); exit 1 }
    [Console]::Error.WriteLine("modelo: $modelo")
  } else {
    try { $r = Chamar $modelo } catch { [Console]::Error.WriteLine("passo ${passo}: $($_.Exception.Message)"); exit 1 }
  }
  if ($r.usage.cost) { $custo += [double]$r.usage.cost }
  if ($Papel -eq 'fazer' -and $custo -gt $MaxCusto) {
    Parar ('parou: MaxCusto US$ {0} excedido; custo US$ {1:N4}' -f $MaxCusto, $custo)
  }
  $msg = $r.choices[0].message
  $chamadas = @($msg.tool_calls | Where-Object { $_ })
  if (-not $chamadas.Count) {
    if (-not $msg.content) { [Console]::Error.WriteLine("resposta vazia (finish_reason: $($r.choices[0].finish_reason))"); exit 1 }
    $relatorio = $msg.content
    if ($Papel -eq 'fazer') {
      $modeloResposta = if ($r.model) { $r.model } else { $modelo }
      $custoTexto = $custo.ToString('F4', [Globalization.CultureInfo]::InvariantCulture)
      $relatorio += "`n`n---`nExecutor: openrouter $modeloResposta, esforco $Esforco; $passo passos; custo US`$ $custoTexto`nArquivos gravados: $(ArquivosGravados)"
      if ($custo -gt 0.50) { $relatorio += "`nATENCAO: custo acima de US`$ 0,50" }
    }
    [IO.File]::WriteAllText($Saida, $relatorio, $utf8)
    [Console]::Error.WriteLine(('fim em {0} passos; custo US$ {1:N4}' -f $passo, $custo))
    exit 0
  }
  [void]$mensagens.Add(@{ role = 'assistant'; content = $msg.content; tool_calls = $chamadas })
  foreach ($c in $chamadas) {
    $nome = $c.function.name
    $escrita = $nome -in @('write_file', 'edit_file')
    $argumentosLidos = $false
    try {
      $a = if ($c.function.arguments) { $c.function.arguments | ConvertFrom-Json } else { New-Object psobject }
      $argumentosLidos = $true
      $res = switch ($nome) {
        'read_file' { LerArquivo $a }
        'list_dir' { ListarPasta $a }
        'grep' { Buscar $a }
        'write_file' {
          if ($Papel -ne 'fazer') { throw 'write_file indisponivel neste papel' }
          if ($a.path -isnot [string] -or $a.content -isnot [string]) { throw 'path e content devem ser strings' }
          GravarArquivo $a.path $a.content 'write_file'
        }
        'edit_file' {
          if ($Papel -ne 'fazer') { throw 'edit_file indisponivel neste papel' }
          if ($a.path -isnot [string] -or $a.old_string -isnot [string] -or $a.new_string -isnot [string]) {
            throw 'path, old_string e new_string devem ser strings'
          }
          EditarArquivo $a
        }
        default { throw "ferramenta desconhecida: $nome" }
      }
    } catch {
      $res = if ($escrita -and -not $argumentosLidos) { 'erro: argumentos de escrita invalidos' } else { "erro: $($_.Exception.Message)" }
      if ($escrita) { [Console]::Error.WriteLine("passo ${passo}: $nome recusado") }
    }
    if (-not $escrita) { [Console]::Error.WriteLine("passo ${passo}: $nome $($c.function.arguments)") }
    [void]$mensagens.Add(@{ role = 'tool'; tool_call_id = $c.id; content = [string]$res })
  }
}
Parar "parou: passou de $maxPassos passos sem resposta final"
