import type { EngineInterface } from 'claude-code'
import { lerFontesGlobais, invalidas, comandoFontes, textoFontes, statAusente, localizarCliFontes } from './fontes'

async function lerArquivoClaude($: EngineInterface, path: string): Promise<string> {
  try { return await $.fs.read(path) }
  catch {
    // fs.read só promete rejeitar; fs.stat documenta ENOENT para ausência.
    try { await $.fs.stat(path) }
    catch (e) {
      if (statAusente(e)) throw Object.assign(new Error('ENOENT arquivo de fontes'), { code: 'ENOENT' })
      throw new Error('Falha ao verificar arquivo de fontes; ausência não comprovada')
    }
    throw new Error('Arquivo existe, mas a leitura falhou')
  }
}
export async function lerFontesClaude($: EngineInterface) {
  try {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    return await lerFontesGlobais(home, await $.env.get('LOCALAPPDATA'), path => lerArquivoClaude($, path), async path => {
      // Stat normaliza ausência; listagem negada ou quebrada nunca equivale a vazia.
      try { await $.fs.stat(path) }
      catch (e) {
        if (statAusente(e)) throw Object.assign(new Error('ENOENT Packages'), { code: 'ENOENT' })
        throw new Error('Não foi possível conferir legados MSIX')
      }
      return (await $.fs.list(path)).filter(e => e.kind === 'dir' || e.isLink).map(e => e.name)
    })
  } catch { return invalidas() }
}
export async function executarFontesClaude($: EngineInterface, args: string) {
  const { acao, fonte } = comandoFontes(args)
  if (acao !== 'listar') {
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    if (!home) throw new Error('Pasta do usuário indisponível; use fontes.ps1 no terminal.')
    const script = await localizarCliFontes(home, path => $.fs.stat(path))
    const r = await $.process.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Acao', acao, '-Fonte', fonte!], { timeoutMs: 15000 })
    if (r.exitCode !== 0) throw new Error(`fontes.ps1 falhou (${r.exitCode}): ${r.stderr || r.stdout}`)
  }
  return textoFontes(await lerFontesClaude($))
}
