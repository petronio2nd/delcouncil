# Liga as skills do delcouncil nas pastas dos agentes e confere o ambiente.
# Nao altera settings.json, opencode.json nem arquivos de instrucoes: imprime os passos.
# Exemplos:
#   .\instalar.ps1                       # Claude Code + pasta comum ~/.agents
#   .\instalar.ps1 -Cliente codex        # tambem ~/.codex/skills
#   .\instalar.ps1 -Copiar               # copia em vez de junction
#   .\instalar.ps1 -SomenteVerificar     # nao liga nada
#   .\instalar.ps1 -Casa C:\temp\casa    # instala em outra "home" (teste)
param(
  [ValidateSet('claude', 'codex', 'todos')][string]$Cliente = 'claude',
  [switch]$Copiar,
  [switch]$SomenteVerificar,
  [string]$Casa = ''
)
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$skills = @('orquestrador', 'dupla', 'revisor')
if (-not $Casa) { $Casa = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME } }
if (-not $Casa -or -not [IO.Path]::IsPathRooted($Casa)) { throw 'Nao achei uma pasta home absoluta. Use -Casa <pasta>.' }

function Escreve([string]$marca, [string]$texto) { Write-Output ('{0} {1}' -f $marca, $texto) }

Write-Output '== Pre-requisitos'
$ps = $PSVersionTable.PSVersion
if ($ps.Major -lt 5) { throw "PowerShell $ps e antigo; use 5.1 ou mais novo." }
Escreve '[ok]' "PowerShell $ps (testado no 5.1; o 7 nao foi testado)"
foreach ($c in @(
  @{ n = 'git'; obrig = $true; para = 'clonar e revisar o diff' },
  @{ n = 'claude'; obrig = $false; para = 'Claude Code' },
  @{ n = 'opencode'; obrig = $false; para = 'executor/revisor de outras familias (ou opencode-cli.exe do app)' },
  @{ n = 'agy'; obrig = $false; para = 'Gemini pelo Antigravity' },
  @{ n = 'node'; obrig = $false; para = 'testes dos mods' }
)) {
  if (Get-Command $c.n -ErrorAction SilentlyContinue) { Escreve '[ok]' ('{0}: encontrado' -f $c.n) }
  elseif ($c.obrig) { throw ('{0} e obrigatorio ({1}).' -f $c.n, $c.para) }
  else { Escreve '[--]' ('{0}: nao encontrado ({1}); opcional' -f $c.n, $c.para) }
}

$destinos = @((Join-Path $Casa '.agents\skills'), (Join-Path $Casa '.claude\skills'))
if ($Cliente -in 'codex', 'todos') { $destinos += (Join-Path $Casa '.codex\skills') }

Write-Output ''
Write-Output '== Skills'
foreach ($pastaDestino in $destinos) {
  foreach ($s in $skills) {
    $origem = Join-Path $raiz "skills\$s"
    $alvo = Join-Path $pastaDestino $s
    if (-not (Test-Path -LiteralPath $origem)) { throw "Origem ausente: $origem" }
    if (Test-Path -LiteralPath $alvo) {
      $item = Get-Item -LiteralPath $alvo -Force
      $aponta = ''
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $aponta = ($item.Target | Select-Object -First 1) }
      if ($aponta -and ((Resolve-Path -LiteralPath $aponta).Path -eq (Resolve-Path -LiteralPath $origem).Path)) { Escreve '[ok]' "$alvo ja aponta para este repositorio" }
      else { Escreve '[!!]' "$alvo ja existe e nao e deste repositorio; nao sobrescrevi" }
      continue
    }
    if ($SomenteVerificar) { Escreve '[--]' "$alvo nao existe (faltaria ligar)"; continue }
    New-Item -ItemType Directory -Force -Path $pastaDestino | Out-Null
    if ($Copiar) { Copy-Item -LiteralPath $origem -Destination $alvo -Recurse; Escreve '[ok]' "copiado: $alvo" }
    else { New-Item -ItemType Junction -Path $alvo -Target $origem | Out-Null; Escreve '[ok]' "ligado: $alvo -> $origem" }
  }
}

Write-Output ''
Write-Output '== Trava de fontes'
$fontes = Join-Path $raiz 'skills\dupla\scripts\fontes.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $fontes
if ($LASTEXITCODE -ne 0) { Escreve '[!!]' 'fontes.ps1 saiu com erro; consumo fica BLOQUEADO ate o estado ser corrigido pelo proprio comando.' }
else { Escreve '[ok]' 'fontes.ps1 responde (as fontes aparecem acima)' }

Write-Output ''
Write-Output '== Proximos passos (manuais, nada disto foi alterado)'
Write-Output "1. Ajuste as familias de modelos em: $(Join-Path $raiz 'skills\orquestrador\politica-modelos.json')"
Write-Output '2. Claude Code - mod orquestra: acrescente ao CLAUDE_CODE_PLUGIN_DIRS do ~/.claude/settings.json (separador ;):'
Write-Output "     $(Join-Path $raiz 'mods\orquestra')"
Write-Output '   Opcionais (jeito de conversar e medidores): status-nome, responder, session-band ou medidor, portugues, segredos, aguardar,'
Write-Output "     na mesma pasta $(Join-Path $raiz 'mods'); o hook de nome da sessao esta em docs\instalacao.md (secao 4.1)."
Write-Output '3. OpenCode - plugin gemeo: acrescente em "plugins" do ~/.config/opencode/opencode.json:'
Write-Output "     $((Join-Path $raiz 'mods\gemeo') -replace '\\', '/')"
Write-Output '4. Cole o que fizer sentido de exemplos\instrucoes-globais.md no seu CLAUDE.md / AGENTS.md.'
Write-Output '5. Rode as suites de docs\instalacao.md (secao 6) e abra uma sessao nova do agente.'
