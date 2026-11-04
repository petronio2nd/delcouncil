# Perfil de gasto da orquestração (orquestrador, seção 4): base, economia ou qualidade, com validade.
# Uso: powershell -ExecutionPolicy Bypass -File perfil.ps1                       mostra o perfil em vigor
#      powershell -ExecutionPolicy Bypass -File perfil.ps1 qualidade [-Ate <quando>]   troca o perfil
#      powershell -ExecutionPolicy Bypass -File perfil.ps1 base                  volta ao padrão agora
#   -Ate: hoje (o padrão, até 23:59), amanha (até 23:59 de amanhã), 18:00 (hoje), 30/10 ou "30/10 18:00".
#   -Ler: devolve o objeto (perfil, ate, vencido, texto) em vez da linha de texto; o recursos.ps1 usa.
# Grava em %LOCALAPPDATA%\dupla\perfil.json (DUPLA_PERFIL troca o caminho). Sem arquivo, com arquivo vencido
# ou ilegível, o perfil é base: a troca sempre volta sozinha, ninguém precisa lembrar de desligar.

param(
  [ValidateSet('base', 'economia', 'qualidade')][string]$Perfil,
  [string]$Ate = 'hoje',
  [switch]$Ler
)

$arq = if ($env:DUPLA_PERFIL) { $env:DUPLA_PERFIL } else { Join-Path $env:LOCALAPPDATA 'dupla\perfil.json' }
$br = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')
$agora = Get-Date

function Validade([string]$quando) {
  $fim = { param($d) $d.Date.AddDays(1).AddSeconds(-1) }
  switch -Regex ($quando.Trim().ToLower()) {
    '^hoje$' { return & $fim $agora }
    '^amanh(a|ã)$' { return & $fim $agora.AddDays(1) }
  }
  # Os formatos vão como [string[]] e o estilo tipado: sem isso o PowerShell escolhe outra sobrecarga e
  # toda leitura falha.
  $t = [DateTime]::MinValue
  $ws = [Globalization.DateTimeStyles]::AllowWhiteSpaces
  if ([DateTime]::TryParseExact($quando, [string[]]@('HH:mm', 'H:mm'), $br, $ws, [ref]$t)) {
    return $agora.Date.Add($t.TimeOfDay)
  }
  if ([DateTime]::TryParseExact($quando, [string[]]@('dd/MM HH:mm', 'd/M HH:mm', 'dd/MM/yyyy HH:mm'), $br, $ws, [ref]$t)) {
    return $t
  }
  if ([DateTime]::TryParseExact($quando, [string[]]@('dd/MM', 'd/M', 'dd/MM/yyyy'), $br, $ws, [ref]$t)) {
    return & $fim $t
  }
  throw "-Ate '$quando' não reconhecido: use hoje, amanha, 18:00, 30/10 ou ""30/10 18:00""."
}

function Atual {
  $p = [pscustomobject]@{ perfil = 'base'; ate = $null; vencido = $null; definidoEm = $null }
  if (-not (Test-Path -LiteralPath $arq)) { return $p }
  # Tudo no try, conversão das datas inclusive: JSON válido com data torta também é arquivo ilegível.
  try {
    $j = Get-Content -LiteralPath $arq -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.perfil -notin @('economia', 'qualidade') -or -not $j.ate) { return $p }
    $ate = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$j.ate).LocalDateTime
    if ($ate -lt $agora) { $p.vencido = "$($j.perfil) venceu em $($ate.ToString('dd/MM HH:mm'))"; return $p }
    $definido = try { [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$j.definidoEm).LocalDateTime } catch { $null }
    $p.perfil = $j.perfil; $p.ate = $ate; if ($j.definidoEm) { $p.definidoEm = $definido }
  } catch { }
  $p
}

function Texto($p) {
  if ($p.perfil -eq 'base') {
    'Perfil: base (padrão)' + $(if ($p.vencido) { "; $($p.vencido)" })
  } else {
    "Perfil: $($p.perfil) até $($p.ate.ToString('dd/MM HH:mm')), depois volta ao base" +
      $(if ($p.definidoEm) { " (trocado em $($p.definidoEm.ToString('dd/MM HH:mm')))" })
  }
}

if ($Perfil -eq 'base') {
  if (Test-Path -LiteralPath $arq) { Remove-Item -LiteralPath $arq -Force }
} elseif ($Perfil) {
  $ateDt = Validade $Ate
  if ($ateDt -le $agora) { throw "-Ate $($ateDt.ToString('dd/MM HH:mm')) já passou." }
  New-Item -ItemType Directory -Force (Split-Path $arq) | Out-Null
  $dados = [ordered]@{
    perfil = $Perfil
    ate = ([DateTimeOffset]$ateDt).ToUnixTimeMilliseconds()
    definidoEm = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  }
  [IO.File]::WriteAllText($arq, ($dados | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
}

$p = Atual
if ($Ler) { $p | Add-Member -NotePropertyName texto -NotePropertyValue (Texto $p) -PassThru } else { Texto $p }
