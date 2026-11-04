import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, rmdirSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { analisarFontes } from '../orquestra/hooks/fontes.ts'

const script = join(homedir(), '.agents', 'skills', 'dupla', 'scripts', 'fontes.ps1')
const motivoSkip = process.platform !== 'win32' ? 'Integração opcional: exige Windows PowerShell' : !existsSync(script) ? 'Integração opcional: fontes.ps1 externo não instalado' : false
test('CLI PowerShell real e reader TS compartilham o contrato em arquivo temporário', { skip: motivoSkip }, () => {
  const pasta = mkdtempSync(join(tmpdir(), 'fontes-cli-isolado-'))
  const arquivo = join(pasta, 'fontes.json')
  const cli = (...args: string[]) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Arquivo', arquivo, '-Json', ...args], { encoding: 'utf8', windowsHide: true }))
  try {
    assert.deepEqual(cli().bloqueadas, [])
    assert.deepEqual(cli('-Acao', 'travar', '-Fonte', 'claude-max').bloqueadas, ['claude-max'])
    assert.deepEqual(analisarFontes(readFileSync(arquivo, 'utf8')).bloqueadas, ['claude-max'])
    assert.deepEqual(cli('-Acao', 'liberar', '-Fonte', 'claude-max').bloqueadas, [])
    assert.deepEqual(analisarFontes(readFileSync(arquivo, 'utf8')), { versao: 1, bloqueadas: [], valido: true })
  } finally { rmSync(arquivo, { force: true }); rmSync(arquivo + '.lock', { force: true }); rmdirSync(pasta) }
})
