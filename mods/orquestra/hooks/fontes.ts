// Contrato comum com dupla/scripts/fontes.ps1. Este módulo nunca escreve o estado.
export const FONTES = ['claude-max', 'chatgpt', 'anthropic-api', 'antigravity', 'openrouter'] as const
export type Fonte = typeof FONTES[number]
export type Fontes = { versao: 1; bloqueadas: Fonte[]; valido: boolean; motivo?: string }
export const NOMES: Record<Fonte, string> = { 'claude-max': 'Assinatura Claude', chatgpt: 'Assinatura ChatGPT', 'anthropic-api': 'API Anthropic', antigravity: 'Antigravity', openrouter: 'OpenRouter' }
export const livres = (): Fontes => ({ versao: 1, bloqueadas: [], valido: true })
export const invalidas = (): Fontes => ({ versao: 1, bloqueadas: [...FONTES], valido: false, motivo: '⚠️ Estado das fontes inválido ou ilegível. Consumo bloqueado até corrigir fontes.json.' })
// Mesma gramática léxica de fontes-comum.ps1: exatamente número + array, em qualquer ordem.
const W = String.raw`[ \t\r\n]*`, STR = String.raw`"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"`
const NUM = String.raw`-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?`
const ARR = String.raw`\[${W}(?:${STR}(?:${W},${W}${STR})*)?${W}\]`
const PN = `${STR}${W}:${W}${NUM}`, PA = `${STR}${W}:${W}${ARR}`
const GRAMATICA = new RegExp(String.raw`^${W}\{${W}(?:${PN}${W},${W}${PA}|${PA}${W},${W}${PN})${W}\}${W}$`)
export function analisarFontes(texto: string): Fontes {
  try {
    texto = texto.replace(/^\uFEFF/, '')
    if (!GRAMATICA.test(texto)) return invalidas()
    const x = JSON.parse(texto)
    if (!x || typeof x !== 'object' || Array.isArray(x) || x.versao !== 1 ||
      Object.keys(x).sort().join(',') !== 'bloqueadas,versao' || !Array.isArray(x.bloqueadas) ||
      x.bloqueadas.some((v: unknown) => typeof v !== 'string' || !(FONTES as readonly string[]).includes(v))) return invalidas()
    return { versao: 1, bloqueadas: [...new Set<Fonte>(x.bloqueadas)], valido: true }
  } catch { return invalidas() }
}
function leituraAusente(e: unknown): boolean {
  const erro = e as { code?: unknown; message?: unknown } | null
  if (erro?.code !== undefined) return erro.code === 'ENOENT'
  return typeof erro?.message === 'string' && !/\b(?:EACCES|EPERM|EIO|ENOTDIR)\b/.test(erro.message) && /^ENOENT\b/.test(erro.message)
}
export async function lerFontes(leitor: () => Promise<string>, lerMarcador?: () => Promise<unknown>): Promise<Fontes> {
  try { return analisarFontes(await leitor()) }
  catch (e) {
    if (!leituraAusente(e)) return invalidas()
    if (!lerMarcador) return livres() // somente consumidores puros sem persistência
    try { await lerMarcador(); return invalidas() }
    catch (marcador) { return leituraAusente(marcador) ? livres() : invalidas() }
  }
}
export function fonteModelo(modelo?: { providerID?: string; id?: string }): Fonte | undefined {
  if (modelo?.providerID === 'openai') return 'chatgpt'
  if (modelo?.providerID === 'anthropic') return 'anthropic-api'
  if (modelo?.providerID === 'openrouter') return 'openrouter'
  if (modelo?.providerID === 'google' && modelo.id?.startsWith('antigravity-')) return 'antigravity'
  return undefined
}
export function impedimento(fontes: Fontes, fonte?: Fonte): string | undefined {
  if (!fontes.valido) return fontes.motivo
  if (fonte && fontes.bloqueadas.includes(fonte)) return `⚠️ ${NOMES[fonte]} travada por você.`
  if (!fonte && fontes.bloqueadas.length) return '⚠️ Fonte de consumo desconhecida com travas ativas. Nenhuma requisição enviada; não é seguro presumir a assinatura.'
}
export function avisosFontes(fontes: Fontes): string {
  return fontes.valido ? fontes.bloqueadas.map(f => impedimento(fontes, f)).join('\n') : fontes.motivo!
}
export function textoFontes(fontes: Fontes): string {
  return [avisosFontes(fontes), 'Fontes globais · sem vencimento; só o usuário libera.',
    ...FONTES.map(f => `${fontes.bloqueadas.includes(f) ? '🔒 desligada' : '🟢 ligada'} · ${NOMES[f]} · ${f}`)].filter(Boolean).join('\n')
}
export function comandoFontes(args: string): { acao: 'listar' | 'travar' | 'liberar'; fonte?: Fonte } {
  const partes = args.trim().split(/\s+/).filter(Boolean)
  if (!partes.length || (partes.length === 1 && partes[0] === 'listar')) return { acao: 'listar' }
  const acao = partes[0] === 'ligar' || partes[0] === 'liberar' ? 'liberar'
    : partes[0] === 'desligar' || partes[0] === 'travar' ? 'travar' : undefined
  if (partes.length !== 2 || !acao || !(FONTES as readonly string[]).includes(partes[1])) throw new Error('Use fontes [listar | desligar <id> | ligar <id>]. IDs: ' + FONTES.join(', '))
  return { acao, fonte: partes[1] as Fonte }
}

const FONTES_DA_FILA = new Map<string, Fonte>([
  ['ChatGPT (OpenCode/Codex)', 'chatgpt'], ['API Anthropic (opencode)', 'anthropic-api'],
  ['Claude Max', 'claude-max'], ['ChatGPT', 'chatgpt'], ['Claude API', 'anthropic-api'],
  ['API Anthropic', 'anthropic-api'], ['Antigravity Claude/GPT', 'antigravity'],
  ['Antigravity Gemini', 'antigravity'], ['OpenRouter', 'openrouter'],
])
export function fonteDaFila(rotulo: string): Fonte | undefined {
  if (/^agy\b/i.test(rotulo)) return 'antigravity'
  return FONTES_DA_FILA.get(rotulo) ?? ((FONTES as readonly string[]).includes(rotulo) ? rotulo as Fonte : undefined)
}

// Somente no contexto de fs.stat: wrapper exato e errno, nunca busca solta por ENOENT.
export function statAusente(erro: unknown): boolean {
  const e = erro as { code?: unknown; errno?: unknown; message?: unknown } | null
  if (e?.code !== undefined) return e.code === 'ENOENT'
  if (e?.errno !== undefined && e.errno !== -2 && e.errno !== -4058) return e.errno === 'ENOENT'
  return typeof e?.message === 'string' && !/\b(?:EACCES|EPERM|EIO|ENOTDIR)\b/.test(e.message) && /^(?:fs\.stat failed: )?ENOENT(?::|\s|$)/.test(e.message)
}
export function caminhoAbsolutoFontes(home: string, windows = true): boolean {
  const p = home.split(String.fromCharCode(92)).join('/')
  return windows ? /^[a-z]:[/]|^[/][/][^/]+[/][^/]+(?:[/]|$)/i.test(p) : p.startsWith('/')
}
export async function localizarCliFontes(home: string, stat: (path: string) => Promise<unknown>): Promise<string> {
  if (!caminhoAbsolutoFontes(home)) throw new Error('Pasta do usuário precisa ser absoluta')
  for (const base of ['.agents', '.claude']) {
    const path = `${home}/${base}/skills/dupla/scripts/fontes.ps1`
    try { await stat(path); return path }
    catch (e) { if (!statAusente(e)) throw e }
  }
  throw new Error('fontes.ps1 não encontrado em .agents/skills nem .claude/skills')
}


// O canônico independe do LOCALAPPDATA virtualizado pelo MSIX. Leitura nunca migra/grava.
export async function lerFontesGlobais(home: string | undefined, local: string | undefined,
  ler: (path: string) => Promise<string>, listarPacotes: (path: string) => Promise<string[]>, windows = true): Promise<Fontes> {
  const normalizar = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/[/]+$/, '')
  const absoluto = (p: string) => caminhoAbsolutoFontes(p, windows)
  const raiz = normalizar(home || '')
  if (!absoluto(raiz)) return invalidas()
  const canonical = `${raiz}/.local/share/dupla/fontes.json`
  try { return analisarFontes(await ler(canonical)) }
  catch (e) { if (!leituraAusente(e)) return invalidas() }
  try { await ler(`${canonical}.lock`); return invalidas() }
  catch (e) { if (!leituraAusente(e)) return invalidas() }
  const packages = `${raiz}/AppData/Local/Packages`
  let nomes: string[]
  try { nomes = await listarPacotes(packages) }
  catch (e) { if (!leituraAusente(e)) return invalidas(); nomes = [] }
  if (local && !absoluto(normalizar(local))) return invalidas()
  const caminhos = [`${raiz}/AppData/Local/dupla/fontes.json`,
    ...(local ? [`${normalizar(local)}/dupla/fontes.json`] : []),
    ...nomes.filter(n => /^Claude_[^/]+$/i.test(n) && !n.includes(String.fromCharCode(92))).map(n => `${packages}/${n}/LocalCache/Local/dupla/fontes.json`)]
  const bloqueadas = new Set<Fonte>(), vistos = new Set<string>()
  for (const path of caminhos) {
    const chave = windows ? path.toLowerCase() : path
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const estado = await lerFontes(() => ler(path), () => ler(`${path}.lock`))
    if (!estado.valido) return invalidas()
    for (const fonte of estado.bloqueadas) bloqueadas.add(fonte)
  }
  return { versao: 1, bloqueadas: FONTES.filter(f => bloqueadas.has(f)), valido: true }
}
