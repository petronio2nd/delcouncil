import { readFile, stat, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { lerFontesGlobais, fonteModelo, impedimento, comandoFontes, textoFontes, localizarCliFontes } from '../orquestra/hooks/fontes.ts'

export function lerFontesOpenCode() {
  return lerFontesGlobais(process.env.USERPROFILE || process.env.HOME, process.env.LOCALAPPDATA,
    path => readFile(path, 'utf8'), async path => (await readdir(path, { withFileTypes: true }))
      .filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name), process.platform === 'win32')
}
export async function conferirFonte(modelo?: { providerID?: string; id?: string }) {
  const aviso = impedimento(await lerFontesOpenCode(), fonteModelo(modelo))
  if (aviso) throw new Error(aviso)
}
export async function executarFontes(args: string) {
  const { acao, fonte } = comandoFontes(args)
  if (acao !== 'listar') {
    const home = process.env.USERPROFILE || process.env.HOME
    if (!home) throw new Error('Pasta do usuário indisponível')
    const script = await localizarCliFontes(home, path => stat(path))
    await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Acao', acao, '-Fonte', fonte!],
      { windowsHide: true, timeout: 15000 }, (e, out, err) => e ? reject(new Error(`fontes.ps1 falhou: ${err || out || e.message}`)) : resolve())
    })
  }
  return textoFontes(await lerFontesOpenCode())
}

// session.get pode omitir a seleção herdada. A guarda obrigatória em model.request/
// HTTP/WS decide com o Model.Ref real antes da inferência; objeto desconhecido não passa.
export async function conferirFontePrevia(modelo?: { providerID?: string; id?: string }) {
  if (modelo !== undefined && modelo !== null) await conferirFonte(modelo)
}
