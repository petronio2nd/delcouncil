try { . ((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'fontes-comum.ps1') -ErrorAction Stop).Path) }
catch { throw 'Controle de fontes indisponivel; consumo bloqueado.' }
# Cotas lidas sem gastar nada, para o revisar.ps1 e o despachar.ps1 (dot-source: . .\cota.ps1).
#   Get-CotaChatGPT    : janelas da assinatura do ChatGPT (5 h e semanal), a mesma do GPT pelo OpenCode e do Codex:
#                        primeiro o cota-chatgpt.json que o plugin gêmeo do OpenCode grava; velho (6 h) ou ausente,
#                        o retrato do Codex (Get-CotaCodex). Cada janela diz a fonte (plugin ou codex).
#   Get-CotaCodex      : janelas do Codex (5 h e semanal), pelo último retrato de rate_limits em ~\.codex\sessions
#   Get-CotaAgy <agy>  : limites do agy, pelo /usage (comando de barra no -p não gasta cota nem cria conversa)
#   Test-CotaCodexNoLog <log> : o codex exec parou por cota no meio

function Get-CotaChatGPT {
  # Formato do plugin: { at: ISO, headers: {...}, primary: { used_percent, resets_at: ISO|null }, secondary: {...} },
  # primary a janela de 5 h, secondary a semanal. Devolve o formato de Get-CotaCodex (janela, usada, volta, aberta)
  # mais fonte. Janela sem used_percent é pulada; sem resets_at, conta como aberta e sem hora de volta.
  # Retrato com mais de 6 h: só a janela em 100% que ainda não reiniciou continua valendo (a porcentagem não
  # desce antes do reset; gpt-review de 2026-10-24), com fonte "plugin (velho)"; o resto vem do Codex.
  $arquivo = "$env:USERPROFILE\.local\share\dupla\cota-chatgpt.json"
  $agora = [DateTimeOffset]::Now
  $vistas = @()
  if (Test-Path -LiteralPath $arquivo) {
    try {
      $d = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json
      $velho = ($agora - [DateTimeOffset]::Parse($d.at)).TotalHours -gt 6
      foreach ($j in @(@{ n = '5 h'; w = $d.primary }, @{ n = 'semanal'; w = $d.secondary })) {
        if (-not $j.w -or $null -eq $j.w.used_percent) { continue }
        $volta = $null; $aberta = $true
        if ($j.w.resets_at) { try { $r = [DateTimeOffset]::Parse($j.w.resets_at); $volta = $r.LocalDateTime; $aberta = $r -gt $agora } catch { } }
        # Retrato velho (> 6 h) ainda vale enquanto a janela não zerou: o uso só sobe até o reset, e trocar
        # por um retrato do Codex mais antigo baixaria o uso conhecido e religaria o topo (Astra, 2026-10-24).
        # Sem reset conhecido, o velho sai.
        if ($velho -and -not ($aberta -and $volta)) { continue }
        $vistas += $j.n
        # medido: quando o percentual foi lido de fato (o retrato velho continua valendo e não é de agora).
        [pscustomobject]@{ janela = $j.n; usada = [double]$j.w.used_percent; volta = $volta; aberta = $aberta; fonte = $(if ($velho) { 'plugin (velho)' } else { 'plugin' }); medido = [DateTimeOffset]::Parse($d.at) }
      }
    } catch { }
  }
  # Janela que o plugin não trouxe (ou retrato velho): o retrato do Codex completa. Retrato do Codex com
  # mais de 1 h (ou nenhum): pede um fresco (Update-CotaCodex, 7 s), porque o Codex não roda mais sozinho.
  if ($vistas.Count -lt 2) {
    $ultimo = Get-ChildItem "$env:USERPROFILE\.codex\sessions" -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $fresco = $ultimo -and ($agora - [DateTimeOffset]$ultimo.LastWriteTime).TotalHours -le 1
    foreach ($j in @(Get-CotaCodex -Atualizar:(-not $fresco))) {
      if ($vistas -notcontains $j.janela) { $j | Add-Member -NotePropertyName fonte -NotePropertyValue $(if ($fresco) { 'codex' } else { 'codex (retrato novo)' }) -PassThru }
    }
  }
}

function Update-CotaCodex {
  if (-not (Test-FonteLiberada chatgpt)) { return $false }
  # Pede ao Codex CLI (instalado, mas fora de uso como harness) um retrato fresco dos limites: uma chamada
  # mínima ao Luna em low (7 s, 5 tokens de saída, entrada em cache) grava o rate_limits na sessão nova.
  # É o único jeito de ler o percentual da assinatura do ChatGPT sem o Codex rodando (o app não guarda em
  # disco; o backend ainda não manda nos cabeçalhos que o plugin gêmeo lê). usuário, 2026-10-24: "só o percentual".
  $cx = Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $cx) { $cx = (Get-Command codex -ErrorAction SilentlyContinue).Source }
  if (-not $cx) { return $false }
  $pasta = "$env:TEMP\dupla\cota-codex"; New-Item -ItemType Directory -Force $pasta | Out-Null
  if (-not (Test-FonteLiberada chatgpt)) { return $false }
  $null = & $cx exec -m gpt-6-luna -c model_reasoning_effort=low -s read-only --skip-git-repo-check -C $pasta 'responda so: ok' 2>&1
  $LASTEXITCODE -eq 0
}

function Get-CotaCodex([switch]$Atualizar) {
  # Cada sessão do Codex grava o último retrato dos limites (rate_limits, limit_id codex). A janela se
  # reconhece pelo window_minutes (300 = 5 h, 10080 = semanal), não pela posição: em 2026-10-24 o
  # retrato veio com a semanal em primary e secondary nulo. Sem retrato, não devolve nada (quem chama
  # segue sem a checagem). Vence o retrato com o timestamp mais novo, não o arquivo mexido por último:
  # uma sessão velha retomada tem data de arquivo nova e retrato antigo (revisão do Codex, 2026-10-18).
  # -Atualizar: pede um retrato fresco antes (Update-CotaCodex).
  if ($Atualizar) { $null = Update-CotaCodex }
  $agora = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $limites = $null; $quando = [DateTimeOffset]::MinValue
  $rolls = Get-ChildItem "$env:USERPROFILE\.codex\sessions" -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 5
  foreach ($r in $rolls) {
    $m = Select-String -LiteralPath $r.FullName -Pattern '"limit_id":"codex"' -SimpleMatch -ErrorAction SilentlyContinue | Select-Object -Last 1
    if (-not $m) { continue }
    try {
      $e = $m.Line | ConvertFrom-Json
      $t = [DateTimeOffset]::Parse($e.timestamp)
      if ($e.payload.rate_limits -and $t -gt $quando) { $limites = $e.payload.rate_limits; $quando = $t }
    } catch { }
  }
  if (-not $limites) { return }
  foreach ($j in @(@{ n = '5 h'; w = $limites.primary }, @{ n = 'semanal'; w = $limites.secondary })) {
    if (-not $j.w) { continue }
    $nome = $j.n
    if ($j.w.window_minutes) { $nome = if ([int]$j.w.window_minutes -ge 1440) { 'semanal' } else { '5 h' } }
    [pscustomobject]@{
      janela = $nome
      usada  = [double]$j.w.used_percent
      volta  = [DateTimeOffset]::FromUnixTimeSeconds([long]$j.w.resets_at).LocalDateTime
      # Janela já reiniciada: o retrato é velho e a porcentagem não vale mais.
      aberta = [long]$j.w.resets_at -gt $agora
      medido = $quando
    }
  }
}

function Get-CotaAgy([string]$agy) {
  if (-not (Test-FonteLiberada antigravity)) { return }
  # Linhas do /usage: "<grupo><TAB><nome><TAB><N>%<TAB><volta ISO>", com o que RESTA, não o usado.
  # Grupos vistos em 2026-10-18: "Gemini Models" (5 h e semanal), "Claude and GPT models" e "Gemini 4 Argon".
  & $agy -p '/usage' 2>$null | ForEach-Object {
    $c = $_ -split "`t"
    if ($c.Count -ge 4 -and $c[2] -match '^(\d+(?:\.\d+)?)%$') {
      $resta = [double]$Matches[1]
      $volta = $null
      try { $volta = ([DateTimeOffset]::Parse($c[3])).LocalDateTime } catch { }
      [pscustomobject]@{ grupo = $c[0]; nome = $c[1]; resta = $resta; volta = $volta }
    }
  }
}

function Test-CotaCodexNoLog([string]$log) {
  # O log do codex exec traz o prompt, o pacote e a saída dos comandos dele, que podem citar os mesmos
  # textos. O erro de cota encerra a execução: só as últimas linhas, e só linha de erro do próprio Codex.
  if (-not (Test-Path -LiteralPath $log)) { return $false }
  [bool](Get-Content -LiteralPath $log -Tail 20 -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^\s*(\S+\s+)?(ERROR|error)\b.*(hit your usage limit|usage_limit_exceeded|usage_limit_reached|usage limit reached)' })
}

function Format-Volta($d) { if ($d) { $d.ToString('dd/MM HH:mm') } else { '?' } }
