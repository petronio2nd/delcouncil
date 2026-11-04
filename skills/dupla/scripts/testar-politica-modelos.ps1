# Testes puros, sem modelos, rede, arquivos de segredo ou mudanca de sessao.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'politica-modelos.ps1')
. (Join-Path $PSScriptRoot 'revisao-comum.ps1')
. (Join-Path $PSScriptRoot 'opencode-comum.ps1')
$casosPolitica = 0
function ConferePolitica($Valor, $Esperado) {
  if ($Valor -ne $Esperado) { throw "Esperado $Esperado; obtido $Valor" }
  $script:casosPolitica++
}
foreach ($idTeste in 'haiku','openai/gpt-6-luna','gemini-4-flash-lite') { ConferePolitica (Get-CapacidadeModelo $idTeste) 'N1' }
foreach ($idTeste in 'sonnet','anthropic/claude-sonnet-4-6','openai/gpt-6.1-terra#low','gemini-4-flash-low') { ConferePolitica (Get-CapacidadeModelo $idTeste) 'N2' }
foreach ($idTeste in 'opus','openai/gpt-6.1-sol#high') { ConferePolitica (Get-CapacidadeModelo $idTeste) 'N3' }
# Revisores (Astra, Fable, Argon) tem a capacidade N3 da revisao, mas nao executam.
foreach ($idTeste in 'fable','openai/gpt-6-astra','gemini-4-argon-high') {
  ConferePolitica (Get-CapacidadeModelo $idTeste) 'N3'
  ConferePolitica (Test-SoRevisao $idTeste) $true
}
foreach ($idTeste in 'opus','openai/gpt-6.1-sol#high','openai/gpt-6.1-terra#low','haiku','gemini-4-flash-lite') { ConferePolitica (Test-SoRevisao $idTeste) $false }
foreach ($nTeste in 'N1','N2','N3') {
  ConferePolitica (Get-EsforcoModelo $nTeste) (@{N1='low';N2='low';N3='medium'}[$nTeste])
  ConferePolitica (Get-EsforcoModelo $nTeste -Escalar) (@{N1='medium';N2='medium';N3='high'}[$nTeste])
}
# Mesmo piso de revisao e arbitragem para qualquer familia: L1 low, L2 ou escalado medium.
foreach ($familiaTeste in 'gpt','claude','gemini','') {
  foreach ($papelTeste in 'revisor','arbitro') {
    ConferePolitica (Get-EsforcoModelo N3 -Papel $papelTeste -Risco L1 -Familia $familiaTeste) 'low'
    ConferePolitica (Get-EsforcoModelo N3 -Papel $papelTeste -Risco L2 -Familia $familiaTeste) 'medium'
    ConferePolitica (Get-EsforcoModelo N3 -Papel $papelTeste -Risco L0 -Escalar -Familia $familiaTeste) 'medium'
  }
}
foreach ($acaoTeste in @(
  { Assert-CapacidadeModelo 'openai/gpt-6.1-terra#low' N3 },
  { Assert-CapacidadeModelo 'gemini-4-flash-lite' N2 },
  { Get-CapacidadeModelo 'gemini-3.1-pro-high' },
  { Get-CapacidadeModelo 'modelo-desconhecido' },
  { Get-EsforcoModelo N2 -Papel revisor }
)) {
  $falhouTeste = $false
  try { & $acaoTeste | Out-Null } catch { $falhouTeste = $true }
  ConferePolitica $falhouTeste $true
}
ConferePolitica (Assert-CapacidadeModelo 'fable' N2) 'N3'
ConferePolitica (Test-ParecerRevisao "## Veredito`naprovado`n## Achados`n-`n## Não conferido`n-") $false
ConferePolitica (Test-ParecerRevisao "## Arbitragem`n1 em disputa`n## Decisões`n1. ponto fica com: autor`n## Fora da pauta`nnada" arbitro) $false
$parecerMemoria = "## Veredito`naprovado`n## Achados`nnenhum achado`n## Não conferido`nrede externa"
ConferePolitica (Test-AceiteParecer $parecerMemoria '' 0) $true
ConferePolitica (Test-AceiteParecer $parecerMemoria 'RESOURCE_EXHAUSTED' 0) $false
ConferePolitica (Test-AceiteParecer $parecerMemoria 'Error: policy_violation' 0) $false
ConferePolitica (Test-AceiteParecer $parecerMemoria '' 1) $false
foreach ($nomeTeste in '.env', 'pasta/.env.local', 'credentials.json', 'sub/id_ed25519', 'arquivo.pem', 'pasta/service.json', 'recovery-key.txt') {
  ConferePolitica (Test-NomeSensivelDiff $nomeTeste) $true
}
ConferePolitica (Test-NomeSensivelDiff 'scripts/revisar.ps1') $false
$cercaAberta = $parecerMemoria + "`n" + '```text'
ConferePolitica (Test-AceiteParecer $cercaAberta 'RESOURCE_EXHAUSTED' 0) $false
ConferePolitica (Test-AceiteParecer $cercaAberta 'Error: policy_violation' 0) $false
$exemploVeredito = '```text' + "`n## Veredito`naprovado`n" + '```' + "`n" + ($parecerMemoria -replace 'aprovado','refazer')
ConferePolitica (Get-VereditoRevisao $exemploVeredito) 'refazer'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#high' 'openai/gpt-6.1-terra#high' N3) 'divergente'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#high' 'openai/gpt-6.1-sol#high' N3) 'confirmado'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#high' 'anthropic/claude-opus-5-5#high' N3) 'divergente'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#xhigh' 'openai/gpt-6-astra#medium' N3) 'divergente'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#high' 'openai/gpt-6-astra#high' N3) 'confirmado'
ConferePolitica (Get-ValidacaoModeloObservado 'openai/gpt-6-astra#high' 'openai/gpt-6-astra' N3) 'esforco-nao-informado'
ConferePolitica (Get-ValidacaoModeloObservado 'fable#high' 'não informado' N3) 'nao-informado'
ConferePolitica (Test-NomeSensivelDiff 'pasta/app-credentials.json') $true
ConferePolitica (Test-NomeSensivelDiff 'local-secrets.json') $true
ConferePolitica (Test-AceiteParecer ($parecerMemoria + "`ncontent_filter e o caso que o codigo trata") '' 0) $true
ConferePolitica (Test-AceiteParecer ($parecerMemoria + "`nError: policy_violation") '' 0) $false
ConferePolitica (Test-AceiteParecer ($parecerMemoria + "`n" + '```text' + "`nError: policy_violation`n" + '```') '' 0) $true
ConferePolitica (Select-VarianteAgy 'gemini-4-argon-high' 'xhigh' @('gemini-4-argon-high')) 'gemini-4-argon-high'
ConferePolitica (Select-VarianteAgy 'claude-opus-5-5-high' 'medium' @('claude-opus-5-5-high')) 'claude-opus-5-5-high'
# Flash-Lite nao tem variante de esforco no catalogo: so atende o piso low.
ConferePolitica (Select-VarianteAgy 'gemini-4-flash-lite' 'low' @('gemini-4-flash-lite')) 'gemini-4-flash-lite'
ConferePolitica (Select-VarianteAgy 'gemini-4-flash-low' 'low' @('gemini-4-flash-lite','gemini-4-flash-low','gemini-4-flash-medium')) 'gemini-4-flash-low'
foreach ($acaoTeste in @(
  { Get-CapacidadeModelo 'openai/gpt-6-pro' },
  { Get-CapacidadeModelo 'anthropic/claude-sol-6' },
  { Select-VarianteAgy 'claude-opus-5-5-high' 'xhigh' @('claude-opus-5-5-high') },
  { Select-VarianteAgy 'claude-opus-5-5-low' 'high' @('claude-opus-5-5-low') },
  { Select-VarianteAgy 'gemini-4-flash-lite' 'medium' @('gemini-4-flash-lite') }
)) {
  $falhouTeste = $false
  try { & $acaoTeste | Out-Null } catch { $falhouTeste = $true }
  ConferePolitica $falhouTeste $true
}
# Excecoes publicas e nomes de codigo nao podem desaparecer do anexo nem subir o risco.
foreach ($nomeTeste in '.env.example', 'sub/.env.sample', 'sub/.env.template', '.env.dist', 'sub/id_ed25519.pub', 'chave.pub', 'test_credentials_parser.py',
    'config.env.ts', 'docker.env.example', 'app.env.sample') {
  ConferePolitica (Test-NomeSensivelDiff $nomeTeste) $false
}
foreach ($nomeTeste in 'credentials_backup.json', 'sub/credentials-dev.json', 'sub/app-credentials.json', 'sub/.env.production', '.env.production.env.example', 'credentials-backup.env.example',
    'app-credentials-prod.json', 'gcp-credentials-dev.json', 'aws_credentials_backup', 'sub/app.env', 'config/local.env', 'docker.env',
    'gcp-credentials-prod.json5', 'aws-credentials-prod.tfvars', 'svc-credentials-dev.jsonl', 'app-credentials.enc', 'app-credentials-prod.json.old', 'credentialsBackup.env.example',
    'db-credentials-dump.sql', 'user-credentials-dump.log', 'backup-credentials-prod.zip', 'app-credentials-dev.xlsx') {
  ConferePolitica (Test-NomeSensivelDiff $nomeTeste) $true
}
foreach ($nomeTeste in 'service.env.local', 'service.env.production', 'service.env.json', 'service.env.bak',
    'appCredentials.json', 'awscredentials', 'set-credentials.sh', 'aws-credentials.ps1',
    'server-credentials2.json', 'server_credentials2_backup.log', 'secrets.env.example', 'server.key.env.example',
    'appCredentials.env.example', 'id_rsa.env.example') {
  ConferePolitica (Test-NomeSensivelDiff $nomeTeste) $true
}
foreach ($nomeTeste in 'app.env', 'config/local.env', '.env-config/readme.md', 'prod/.env.example', 'deploy/id_teste.pub') {
  $dadosRisco = [pscustomobject]@{ numstat=@("1`t0`t$nomeTeste"); origem='fixture sem leitura' }
  ConferePolitica (Get-NivelDiff -Recorte $dadosRisco).nivel 'L2'
}
foreach ($nomeTeste in '.env.example', 'sub/.env.sample', 'sub/id_teste.pub', 'test_credentials_parser.py', 'docker.env.example', 'app.env.sample') {
  $dadosRisco = [pscustomobject]@{ numstat=@("1`t0`t$nomeTeste"); origem='fixture publica' }
  ConferePolitica (Get-NivelDiff -Recorte $dadosRisco).nivel 'L1'
}
$catalogoExecutor = @('openai/gpt-6-luna', 'openai/gpt-6.1-terra', 'openai/gpt-6.1-sol', 'openai/gpt-6-astra',
  'anthropic/claude-opus-5-4', 'anthropic/claude-opus-5-5', 'anthropic/claude-fable-5-5')
ConferePolitica (Get-ModeloExecutorOpenCode $catalogoExecutor N1) 'openai/gpt-6-luna'
$modeloN1Reserva = Get-ModeloExecutorOpenCode @('openai/gpt-6.1-terra','anthropic/claude-haiku-4-5') N1
ConferePolitica $modeloN1Reserva 'openai/gpt-6.1-terra'
ConferePolitica (Get-EsforcoModelo (Get-CapacidadeModelo $modeloN1Reserva)) 'low'
ConferePolitica (Get-ModeloExecutorOpenCode $catalogoExecutor N2) 'openai/gpt-6.1-terra'
ConferePolitica (Get-ModeloExecutorOpenCode @('openai/gpt-6.1-sol','anthropic/claude-sonnet-4-6') N2) 'openai/gpt-6.1-sol'
ConferePolitica (Get-ModeloExecutorOpenCode $catalogoExecutor N3) 'openai/gpt-6.1-sol'
ConferePolitica (Get-ModeloExecutorOpenCode @('openai/gpt-6-astra','openai/gpt-6.1-terra','anthropic/claude-opus-5-5') N3) 'anthropic/claude-opus-5-5'
foreach ($acaoTeste in @(
  { Get-ModeloExecutorOpenCode @('openai/gpt-6-astra','anthropic/claude-fable-5-5') N3 },
  { Get-ModeloExecutorOpenCode @('openai/gpt-6.1-terra') N3 },
  { Get-ModeloExecutorOpenCode @('anthropic/claude-sonnet-4-6') N2 },
  { Select-VarianteAgy 'claude-opus-5-5' 'high' @('claude-opus-5-5') },
  { Select-VarianteAgy 'claude-opus-5-5-high' 'xhigh' @('claude-opus-5-5') -PermitirSemSufixo }
)) {
  $falhouTeste = $false
  try { & $acaoTeste | Out-Null } catch { $falhouTeste = $true }
  ConferePolitica $falhouTeste $true
}
ConferePolitica (Select-VarianteAgy 'claude-opus-5-5' 'high' @('claude-opus-5-5') -PermitirSemSufixo) 'claude-opus-5-5'
ConferePolitica (Select-VarianteAgy 'claude-opus-5-5' 'high' @('claude-opus-5-5','claude-opus-5-5-xhigh') -PermitirSemSufixo) 'claude-opus-5-5-xhigh'
$argumentoInvalido = $false
try { Select-VarianteAgy 'claude-opus-5-5' 'max' @() -PermitirSemSufixo | Out-Null }
catch [ArgumentException] { $argumentoInvalido = $true }
ConferePolitica $argumentoInvalido $true
$rotaTemporaria = Join-Path ([IO.Path]::GetTempPath()) ('dupla-politica-' + [guid]::NewGuid())
try {
  Write-RotaModelo $rotaTemporaria 'claude-opus-5-5' 'high' N3 executor 'nao-informado'
  $registroTeste = [IO.File]::ReadAllText("$rotaTemporaria.nivel.json") | ConvertFrom-Json
  ConferePolitica $registroTeste.esforcoPedido 'high'
  ConferePolitica $registroTeste.esforcoSelecionado 'nao-informado'
} finally { Remove-Item -LiteralPath "$rotaTemporaria.nivel.json" -ErrorAction SilentlyContinue }
Write-Output "$casosPolitica casos de politica OK"
