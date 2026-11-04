# Painel das fontes de modelo do usuário: o que resta de cada uma e quando volta, sem gastar cota nem crédito.
# Uso: powershell -ExecutionPolicy Bypass -File recursos.ps1 [-SemAgy]
#   ChatGPT    : janelas de 5 h e semanal da assinatura (GPT pelo OpenCode; antes, o Codex), pelo cota-chatgpt.json
#                do plugin gêmeo do OpenCode ou, sem ele, pelo último retrato do Codex (Get-CotaChatGPT, cota.ps1)
#   agy        : limites de cada grupo, pelo /usage (cota.ps1; leva uns segundos; -SemAgy pula)
#   API        : gasto do ciclo do crédito do Max (dia 20 ao 19) no provedor anthropic pelo banco do OpenCode
#                (opencode_custo.py ciclo), contra os US$ 100; o Console da Anthropic é a conta oficial
#   OpenRouter : uso e limite da chave pelo GET /api/v1/key (não cobra; a chave nunca aparece)
#   Claude Max : o painel não lê; a sessão chama o get_usage do app (orquestrador, seção 4)
#   Perfil     : o perfil de gasto em vigor (perfil.ps1), na linha depois da fila
# Sai sempre com 0; fonte que não deu para ler aparece como "não lido", com o motivo.
# Cada leitura também vai, só com números, para o histórico em %LOCALAPPDATA%\dupla\cotas.jsonl (fim do script).

param([switch]$SemAgy)

. (Join-Path $PSScriptRoot 'cota.ps1')
$linhas = New-Object Collections.ArrayList
$agora = Get-Date
# Folga = % que resta − % da janela que ainda falta até o reset. Positiva: sobra que se perde no reset,
# então essa fonte vai antes na fila (orquestrador, seção 4). A janela sai do rótulo do limite.
function Janela($limite) {
  switch -Regex ([string]$limite) {
    '5 h|Five Hour' { [TimeSpan]::FromHours(5); break }
    'seman|Weekly|weekly' { [TimeSpan]::FromDays(7); break }
    'mês|monthly' { [TimeSpan]::FromDays(30); break }
    default { $null }
  }
}
function Folga($usado, $voltaDt, $dur) {
  if ($null -eq $usado -or -not ($voltaDt -is [DateTime]) -or -not $dur) { return $null }
  $falta = [Math]::Min(100, [Math]::Max(0, 100 * ($voltaDt - $agora).TotalMinutes / $dur.TotalMinutes))
  [Math]::Round((100 - $usado) - $falta)
}
# $real = $false: a volta é estimada (janela que já reiniciou), e a linha não conta como janela no histórico.
function Linha($fonte, $limite, $usado, $volta, $obs = '', $voltaDt = $null, $real = $true) {
  $dur = Janela $limite
  # Mês do calendário: a janela é o mês que termina no reset (28 a 31 dias), não 30 fixos.
  if ($dur -and $dur.TotalDays -eq 30 -and $voltaDt -is [DateTime]) { $dur = $voltaDt - $voltaDt.AddMonths(-1) }
  $f = Folga $usado $voltaDt $dur
  [void]$linhas.Add([pscustomobject]@{
    fonte = $fonte; limite = $limite
    usado = $(if ($null -ne $usado) { '{0:N0}%' -f $usado } else { '?' })
    resta = $(if ($null -ne $usado) { '{0:N0}%' -f [Math]::Max(0, 100 - $usado) } else { '?' })
    folga = $(if ($null -ne $f) { '{0:+0;-0;0}' -f $f } else { '?' })
    volta = $volta; obs = $obs; n = $f; dur = $dur; livre = $(if ($null -ne $usado) { 100 - $usado })
    pct = $usado; voltaDt = $(if ($real -and $voltaDt -is [DateTime]) { $voltaDt })
  })
}

# Bloqueio sempre aparece, sem consultar modelo, credencial ou cota da fonte.
function FonteNoPainel([string]$id, [string]$rotulo) {
  $estado = Get-EstadoFontes
  if (Test-FonteLiberada $id -Silencioso -Estado $estado) { return $true }
  $aviso = if ($estado.valido) { Get-AvisoFonte $id } else { $estado.avisos[0] }
  Linha $rotulo '-' $null '-' $aviso
  return $false
}
# Claude Max: só pelo app.
if (FonteNoPainel claude-max 'Claude Max') { Linha 'Claude Max' '5 h e semanal' $null '?' 'leia pelo get_usage do app' }

if (FonteNoPainel chatgpt 'ChatGPT (OpenCode/Codex)') {
# ChatGPT (a janela do GPT pelo OpenCode e do Codex)
$chatgpt = @(Get-CotaChatGPT)
if (-not $chatgpt.Count) { Linha 'ChatGPT (OpenCode/Codex)' '-' $null '?' 'não lido: sem cota-chatgpt.json do plugin nem retrato do Codex' }
foreach ($j in $chatgpt) {
  $fonte = if ($j.fonte -eq 'plugin') { 'fonte: plugin gêmeo do OpenCode' } else { 'fonte: retrato do Codex (plugin sem arquivo ou com mais de 6 h)' }
  if ($j.aberta) {
    Linha 'ChatGPT (OpenCode/Codex)' $j.janela $j.usada (Format-Volta $j.volta) $fonte $j.volta
    # O retrato pode ser de horas atrás: o histórico guarda quando o percentual foi medido.
    if ($j.medido -is [DateTimeOffset]) { $linhas[-1] | Add-Member -NotePropertyName medido -NotePropertyValue $j.medido }
  }
  # Janela já reiniciada: conta como cheia e recém-aberta (folga 0), para não sumir da fila.
  else { Linha 'ChatGPT (OpenCode/Codex)' $j.janela 0 '-' "reiniciou em $(Format-Volta $j.volta) (retrato velho); $fonte" $(if (Janela $j.janela) { $agora.Add((Janela $j.janela)) }) $false }
}

}

if (FonteNoPainel antigravity 'agy') {
# agy
if ($SemAgy) { Linha 'agy' '-' $null '?' 'pulado (-SemAgy)' }
else {
  $agy = "$env:LOCALAPPDATA\agy\bin\agy.exe"
  if (-not (Test-Path $agy)) { $agy = (Get-Command agy -ErrorAction SilentlyContinue).Source }
  $grupos = @(if ($agy) { Get-CotaAgy $agy })
  if (-not $grupos.Count) { Linha 'agy' '-' $null '?' 'não lido: agy ausente ou /usage vazio' }
  foreach ($g in $grupos) {
    $obs = if ($g.grupo -match 'Argon') { 'árbitro; executor só com mais de 30%' } else { '' }
    Linha "agy $($g.grupo)" $g.nome (100 - $g.resta) (Format-Volta $g.volta) $obs $g.volta
  }
}

}

if (FonteNoPainel anthropic-api 'API Anthropic (opencode)') {
# API da Anthropic pelo OpenCode
$py = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (-not (Test-Path $py)) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
$ciclo = $null
if ($py) { try { $ciclo = & $py -I -X utf8 (Join-Path $PSScriptRoot 'opencode_custo.py') ciclo 2>$null | ConvertFrom-Json } catch { } }
$credito = 100  # o mesmo teto do despachar.ps1
if ($ciclo) {
  # Ciclo do crédito do Max (dia 20 ao 19, em UTC), não o mês do calendário: o "Gasto" de Limites de gastos
  # no Console zera no dia 1º e não diz o saldo; o saldo é o de Créditos promocionais.
  $voltaDt = [DateTimeOffset]::FromUnixTimeSeconds($ciclo.fim_ts).LocalDateTime
  $desde = [DateTimeOffset]::FromUnixTimeSeconds($ciclo.inicio_ts).UtcDateTime.ToString('dd/MM')
  Linha 'API Anthropic (opencode)' "US$ $credito/mês" (100 * $ciclo.custo / $credito) (Format-Volta $voltaDt) ('US$ {0:N2} gastos em {1} sessões desde {2}; sem rollover; o saldo oficial está em Créditos promocionais no Console' -f $ciclo.custo, $ciclo.sessoes, $desde) $voltaDt
} else { Linha 'API Anthropic (opencode)' "US$ $credito/mês" $null '?' 'não lido: banco do OpenCode ou python ausente' }

}

if (FonteNoPainel openrouter 'OpenRouter') {
# OpenRouter: só os números; o rótulo da chave traz um pedaço dela e não é mostrado.
$chave = $env:OPENROUTER_API_KEY
if (-not $chave) { $chave = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY', 'User') }
if (-not $chave) { Linha 'OpenRouter' '-' $null '?' 'não lido: sem OPENROUTER_API_KEY' }
else {
  try {
    $d = (Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/key' -Headers @{ Authorization = "Bearer $chave" } -TimeoutSec 15).data
    # O gasto do mesmo período do limite; o OpenRouter zera em UTC.
    $campo = @{ daily = 'usage_daily'; weekly = 'usage_weekly'; monthly = 'usage_monthly' }[[string]$d.limit_reset]
    $gasto = if ($campo -and $null -ne $d.$campo) { [double]$d.$campo } else { [double]$d.usage }
    if ($null -ne $d.limit -and [double]$d.limit -eq 0) { Linha 'OpenRouter' 'US$ 0,00' 100 '-' 'limite zero: a chave não gasta nada' }
    elseif ($null -ne $d.limit) {
      $periodo = if ($d.limit_reset) { $d.limit_reset } else { 'total' }
      $agoraUtc = [DateTime]::UtcNow
      $voltaUtc = switch ([string]$d.limit_reset) {
        'daily' { $agoraUtc.Date.AddDays(1) }
        'weekly' { $agoraUtc.Date.AddDays(((8 - [int]$agoraUtc.DayOfWeek) % 7) + $(if ($agoraUtc.DayOfWeek -eq 'Monday') { 7 } else { 0 })) }
        'monthly' { [DateTime]::SpecifyKind((New-Object DateTime($agoraUtc.Year, $agoraUtc.Month, 1)), 'Utc').AddMonths(1) }
        default { $null }
      }
      $volta = if ($voltaUtc) { $voltaUtc.ToLocalTime().ToString('dd/MM HH:mm') } else { '?' }
      Linha 'OpenRouter' ('US$ {0:N2} ({1})' -f [double]$d.limit, $periodo) (100 * $gasto / [double]$d.limit) $volta ('US$ {0:N2} gastos' -f $gasto) $(if ($voltaUtc) { $voltaUtc.ToLocalTime() })
    } else {
      $noMes = if ($null -ne $d.usage_monthly) { 'US$ {0:N2} gastos no mês' -f [double]$d.usage_monthly } else { 'US$ {0:N2} gastos no total' -f [double]$d.usage }
      Linha 'OpenRouter' 'sem limite' $null '-' "$noMes; paga por chamada"
    }
    if ($d.expires_at) { $linhas[-1].obs += "; chave vence $(([DateTimeOffset]::Parse($d.expires_at)).LocalDateTime.ToString('dd/MM/yyyy'))" }
  } catch { Linha 'OpenRouter' '-' $null '?' "não lido: $($_.Exception.Message -replace [regex]::Escape($chave), '***')" }
}
$chave = $null

}

$linhas | Select-Object fonte, limite, usado, resta, folga, volta, obs | Format-Table -AutoSize -Wrap | Out-String -Width 220
# A fila: cada fonte pela folga da janela mais longa (é nela que a sobra se perde), da maior para a menor.
# A janela de 5 h não ordena, só trava: com menos de 10% livres, a fonte vai para o fim até ela voltar.
# A trava olha toda janela de 5 h com uso conhecido, mesmo sem reset; só entra na fila quem tem uma janela
# longa com folga calculada.
$fila = $linhas | Group-Object fonte | ForEach-Object {
  $longa = $_.Group | Where-Object { $null -ne $_.n -and $_.dur -and $_.dur.TotalHours -gt 5 } |
    Sort-Object { $_.dur.TotalMinutes } -Descending | Select-Object -First 1
  if (-not $longa) { return }
  $trava = @($_.Group | Where-Object { $_.dur -and $_.dur.TotalHours -le 5 -and $null -ne $_.livre -and $_.livre -lt 10 }).Count -gt 0
  [pscustomobject]@{ fonte = $_.Name; folga = $longa.folga; n = $longa.n; trava = $trava }
} | Sort-Object @{ e = { $_.trava } }, @{ e = { $_.n }; Descending = $true }
if ($fila) { 'Fila pela folga: ' + (($fila | ForEach-Object { '{0} ({1}{2})' -f $_.fonte, $_.folga, $(if ($_.trava) { ', 5 h no fim' }) }) -join ' > ') }
# O perfil de gasto em vigor (perfil.ps1), que a sessão aplica ao despachar (orquestrador, seção 4).
$perfil = try { & (Join-Path $PSScriptRoot 'perfil.ps1') -Ler } catch { $null }
if ($perfil) { $perfil.texto }
# A mesma fila em %TEMP%\dupla\_fila.json, para o painel orquestra mostrar sem rodar o agy. Falha aqui não
# muda o painel de texto acima.
try {
  $base = Join-Path $env:TEMP 'dupla'
  New-Item -ItemType Directory -Force $base | Out-Null
  $dados = [ordered]@{
    lidoEm = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); semAgy = [bool]$SemAgy
    fila = @($fila | ForEach-Object { [ordered]@{ fonte = $_.fonte; folga = [int]$_.n; trava = [bool]$_.trava } })
    perfil = $(if ($perfil) { $perfil.perfil } else { 'base' })
    perfilAte = $(if ($perfil -and $perfil.ate -is [DateTime]) { ([DateTimeOffset]$perfil.ate).ToUnixTimeMilliseconds() } else { $null })
  }
  [IO.File]::WriteAllText((Join-Path $base '_fila.json'), ($dados | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding($false)))
} catch { }
# Histórico: um retrato por leitura em %LOCALAPPDATA%\dupla\cotas.jsonl (DUPLA_COTAS troca o caminho), só fonte,
# limite e números, para o painel orquestra mostrar quanto de cada janela se perdeu no reset. Fora do %TEMP%,
# que a limpeza do Windows esvazia. Passou de 2 MB: fica só o que tem menos de 180 dias. Falha aqui também não
# muda o painel de texto.
try {
  $hist = if ($env:DUPLA_COTAS) { $env:DUPLA_COTAS } else { Join-Path $env:LOCALAPPDATA 'dupla\cotas.jsonl' }
  New-Item -ItemType Directory -Force (Split-Path $hist) | Out-Null
  # Vazio vira null explícito: o "nada" de um if sem else sai como {} no ConvertTo-Json do PowerShell 5.1.
  # fuso em minutos (Brasília = -180): o painel não sabe o fuso do Windows e formata as datas por ele.
  $retrato = [ordered]@{
    em = [DateTimeOffset]::Now.ToUnixTimeMilliseconds(); semAgy = [bool]$SemAgy
    fuso = [int][DateTimeOffset]::Now.Offset.TotalMinutes
    fontes = @($linhas | ForEach-Object { [ordered]@{
      fonte = $_.fonte; limite = [string]$_.limite
      usado = $(if ($null -ne $_.pct) { [Math]::Round([double]$_.pct, 1) } else { $null })
      volta = $(if ($_.voltaDt -is [DateTime]) { ([DateTimeOffset]$_.voltaDt).ToUnixTimeMilliseconds() } else { $null })
      horas = $(if ($_.dur) { [Math]::Round($_.dur.TotalHours, 2) } else { $null })
      folga = $(if ($null -ne $_.n) { [int]$_.n } else { $null })
      medido = $(if ($_.medido -is [DateTimeOffset]) { $_.medido.ToUnixTimeMilliseconds() } else { $null })
    } })
  }
  $utf8 = New-Object Text.UTF8Encoding($false)
  # Várias sessões podem rodar o script ao mesmo tempo: acrescentar e cortar ficam sob a mesma trava.
  $trava = New-Object Threading.Mutex($false, 'Local\dupla-cotas')
  $comTrava = $false
  try {
    try { $comTrava = $trava.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $comTrava = $true }
    if ($comTrava) {
      # Gravação anterior cortada sem a quebra de linha: começa numa linha nova, senão as duas se perdem.
      $antes = ''
      if ((Test-Path -LiteralPath $hist) -and (Get-Item -LiteralPath $hist).Length -gt 0) {
        $fs = [IO.File]::OpenRead($hist)
        try { [void]$fs.Seek(-1, 'End'); if ($fs.ReadByte() -ne 10) { $antes = "`n" } } finally { $fs.Dispose() }
      }
      [IO.File]::AppendAllText($hist, $antes + ($retrato | ConvertTo-Json -Depth 4 -Compress) + "`n", $utf8)
      if ((Get-Item -LiteralPath $hist).Length -gt 2MB) {
        $corte = [DateTimeOffset]::Now.AddDays(-180).ToUnixTimeMilliseconds()
        $ficam = [IO.File]::ReadAllLines($hist, $utf8) | Where-Object { $_ -match '^\{"em":(\d+)' -and [int64]$Matches[1] -ge $corte }
        [IO.File]::WriteAllLines($hist, [string[]]@($ficam), $utf8)
      }
    }
  } finally { if ($comTrava) { $trava.ReleaseMutex() }; $trava.Dispose() }
} catch { }
