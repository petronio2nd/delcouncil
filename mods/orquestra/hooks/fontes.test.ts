import { expect, mock, test } from 'claude-code/testing'
import { analisarFontes, lerFontes, fonteModelo, impedimento, comandoFontes, fonteDaFila, localizarCliFontes, caminhoAbsolutoFontes, statAusente } from './fontes'
import { lerFontesClaude } from './fontes-claude'
import { register } from './register'
import { registrarRota } from './rota-claude'

const livre = '{"versao":1,"bloqueadas":[]}'
const travado = '{"versao":1,"bloqueadas":["claude-max"]}'

test('fontes: JSON estrito, BOM, duplicados, ausente versus ilegível', async () => {
  expect(analisarFontes('\uFEFF' + livre).valido).toBe(true)
  expect(analisarFontes('{"versao":1.0,"bloqueadas":["chatgpt","chatgpt"]}').bloqueadas).toEqual(['chatgpt'])
  for (const x of ['null', '[]', '{}', '{', '{"versao":"1","bloqueadas":[]}', '{"versao":1,"bloqueadas":"chatgpt"}', '{"versao":1,"bloqueadas":["x"]}', '{"versao":1,"bloqueadas":[null]}', '{"versao":1,"bloqueadas":[],"ate":"amanha"}']) expect(analisarFontes(x).valido).toBe(false)
  expect((await lerFontes(async () => { throw Object.assign(new Error('ausente'), { code: 'ENOENT' }) })).valido).toBe(true)
  expect((await lerFontes(async () => { throw Object.assign(new Error('negado'), { code: 'EACCES' }) })).valido).toBe(false)
  expect(impedimento(analisarFontes(travado), 'claude-max')).toBe('⚠️ Assinatura Claude travada por você.')
  expect(impedimento(analisarFontes(travado), fonteModelo({ providerID: 'anthropic', id: 'claude' }))).toBeUndefined()
  expect(impedimento(analisarFontes(travado), fonteModelo({ providerID: 'google', id: 'gemini' }))).toMatch('desconhecida')
  expect(comandoFontes('ligar claude-max')).toEqual({ acao: 'liberar', fonte: 'claude-max' })
})

test('Claude: trava antes do bypass de subagente e sem rota; relê continuações e estado inválido', async () => {
  let texto = travado
  const handlers: Record<string, any> = {}
  registrarRota(((evento: string, ...args: any[]) => { handlers[evento] = args.at(-1) }) as any, {})
  const $: any = { env: { get: async () => 'C:/fake' }, fs: { read: async () => texto } }
  let enviados = 0
  const next = async function* () { enviados++; return {} }
  for (const agentId of [undefined, 'filha', 'neta']) {
    const stream = handlers['turn.step']($, { turnId: 'continuacao', index: 2, agentId }, next)
    expect((await stream.next()).value.text).toBe('⚠️ Assinatura Claude travada por você.')
    await stream.next()
  }
  expect(enviados).toBe(0)
  texto = livre
  for await (const _ of handlers['turn.step']($, { agentId: 'filha' }, next)) {}
  expect(enviados).toBe(1)
  texto = '{}'
  const stream = handlers['turn.step']($, { agentId: 'filha' }, next)
  expect((await stream.next()).value.text).toMatch('inválido ou ilegível')
  await stream.next()
  expect(enviados).toBe(1)
})

test('fontes: painel desktop/terminal e botão liberam por CLI local sem inferência', async ($, on) => {
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/fake', LOCALAPPDATA: 'C:/fake/local' })
  let texto = travado
  on('fs.read', () => ({ value: texto }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const comandos: any[] = []
  on('process.run', (_$, e) => {
    comandos.push(e.argv)
    texto = livre
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  const listado = await $.command.run({ command: 'orquestra', args: 'fontes' })
  expect(listado.text).toMatch('Assinatura Claude travada por você')
  const tentativaPlugin = await $.command.run({ command: 'orquestra', args: 'fontes ligar claude-max' })
  expect(tentativaPlugin.text).toMatch('Só o usuário')
  expect(comandos.length).toBe(0)
  for (const surface of ['desktop', 'terminal'] as const) {
    texto = travado
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, component: 'Pane', requestId: 'orquestra-fontes', props: { title: 'Fontes', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
    expect((await ui.find({ key: 'fonte:claude-max' }))?.text).toBe('Ligar Assinatura Claude')
    await ui.press({ key: 'fonte:claude-max' })
    expect(comandos.at(-1)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/fake/.agents/skills/dupla/scripts/fontes.ps1', '-Acao', 'liberar', '-Fonte', 'claude-max'])
    expect(texto).toBe(livre)
    await ui.unmount()
  }
})


test('ações herdadas do prototype são recusadas com instrução de uso', () => {
  for (const nome of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    let erro = ''
    try { comandoFontes(`${nome} claude-max`) } catch (e) { erro = String(e) }
    expect(erro).toMatch('Use fontes')
  }
})

test('fila identifica todos os grupos agy pelo canal, preservando desconhecidos bloqueados', () => {
  for (const rotulo of ['agy Gemini 4 Argon', 'agy Gemini Models', 'agy Claude and GPT models']) {
    expect(fonteDaFila(rotulo)).toBe('antigravity')
    expect(impedimento(analisarFontes(travado), fonteDaFila(rotulo))).toBeUndefined()
    expect(impedimento(analisarFontes('{"versao":1,"bloqueadas":["antigravity"]}'), fonteDaFila(rotulo))).toMatch('Antigravity travada')
  }
  expect(fonteDaFila('constructor')).toBeUndefined()
  expect(impedimento(analisarFontes(travado), fonteDaFila('novo desconhecido'))).toMatch('desconhecida')
})

test('Claude confirma ausência por fs.stat; read genérico, acesso negado e arquivo existente não liberam', async () => {
  const $: any = { env: { get: async () => 'C:/fake' }, fs: {
    read: async () => { throw new Error('fs.read failed: file not found') },
    stat: async () => { throw new Error('ENOENT: missing path') },
  } }
  expect(await lerFontesClaude($)).toEqual({ versao: 1, bloqueadas: [], valido: true })
  $.fs.stat = async () => { throw new Error('EACCES: access denied') }
  expect((await lerFontesClaude($)).valido).toBe(false)
  $.fs.stat = async () => ({ kind: 'file' })
  expect((await lerFontesClaude($)).valido).toBe(false)
  $.fs.stat = async () => { throw new Error('fs.stat failed: ENOENT? EACCES') }
  expect((await lerFontesClaude($)).valido).toBe(false)
})

test('botão apresenta falha CLI e relê estado incerto em vez de conservar rótulo antigo', async ($, on) => {
  const clock = mock.clock(on, { now: 1800000000000 })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/fake', LOCALAPPDATA: 'C:/fake/local' })
  let texto = travado
  on('fs.read', () => ({ value: texto }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  on('process.run', () => {
    texto = livre // escrita ocorreu, mas o processo falhou depois: resultado incerto.
    return { value: { exitCode: 3, stdout: '', stderr: 'falha simulada' } }
  })
  const ui = await $.ui.mount({ plugin: 'orquestra', surface: 'desktop', component: 'Pane', requestId: 'orquestra-fontes', props: { title: 'Fontes', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } })
  expect((await ui.find({ key: 'fonte:claude-max' }))?.text).toBe('Ligar Assinatura Claude')
  await ui.press({ key: 'fonte:claude-max' })
  await clock.advance(200)
  expect(JSON.stringify(await ui.drawn())).toMatch('⚠️ fontes.ps1 falhou (3): falha simulada')
  expect((await ui.find({ key: 'fonte:claude-max' }))?.text).toBe('Desligar Assinatura Claude')
  await ui.unmount()
})


test('compactação manual/auto/precompute/plugin e subagente bloqueiam; livre segue next', async () => {
  const hooks: Record<string, any> = {}
  registrarRota(((evento: string, ...args: any[]) => { hooks[evento] = args.at(-1) }) as any, {})
  let texto = travado
  const $: any = { env: { get: async () => 'C:/fake' }, fs: { read: async () => texto } }
  let chamadas = 0
  const next = async () => { chamadas++; return { messages: [] } }
  for (const trigger of ['manual', 'auto', 'precompute', 'plugin']) {
    for (const agentId of [undefined, 'subagente']) {
      expect((await hooks['session.compact']($, { trigger, agentId, messages: [] }, next)).skip).toMatch('Assinatura Claude travada')
    }
  }
  texto = '{}'
  expect((await hooks['session.compact']($, { trigger: 'auto' }, next)).skip).toMatch('inválido ou ilegível')
  expect(chamadas).toBe(0)
  texto = livre
  expect(await hooks['session.compact']($, { trigger: 'manual' }, next)).toEqual({ messages: [] })
  expect(chamadas).toBe(1)
})

test('model.complete recusa com uso zero/aviso local; UI falha não libera e livre segue next', async () => {
  const hooks: Record<string, any> = {}
  registrarRota(((evento: string, ...args: any[]) => { hooks[evento] = args.at(-1) }) as any, {})
  let texto = travado
  const avisos: string[] = []
  const $: any = { env: { get: async () => 'C:/fake' }, fs: { read: async () => texto }, ui: { log: (s: string) => avisos.push(s) } }
  let chamadas = 0
  const next = async () => { chamadas++; return { isAnswered: true, text: 'simulado' } }
  expect(await hooks['model.complete']($, { model: 'haiku', prompt: 'p' }, next)).toEqual({ isAnswered: false, reason: 'aborted', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  expect(avisos).toEqual(['⚠️ Assinatura Claude travada por você.'])
  $.ui.log = () => { throw new Error('UI falhou') }
  texto = '{}'
  expect((await hooks['model.complete']($, { model: 'haiku', prompt: 'p' }, next)).reason).toBe('aborted')
  expect(chamadas).toBe(0)
  texto = livre
  expect((await hooks['model.complete']($, { model: 'haiku', prompt: 'p' }, next)).isAnswered).toBe(true)
  expect(chamadas).toBe(1)
})

test('ausência stat estruturada/wrapper estreito e fallback CLI sem mascarar acesso negado', async () => {
  expect(statAusente({ errno: 'ENOENT' })).toBe(true)
  expect(statAusente(new Error('fs.stat failed: ENOENT: no such file'))).toBe(true)
  for (const erro of [{ code: 'EACCES', message: 'ENOENT: citado' }, new Error('fs.stat failed: EACCES; ENOENT citado'), new Error('fs.stat failed: ENOENT citado; EACCES real')]) expect(statAusente(erro)).toBe(false)
  const $: any = { env: { get: async () => 'C:/fake' }, fs: { read: async () => { throw new Error('read wrapped') }, stat: async () => { throw new Error('fs.stat failed: ENOENT: missing') } } }
  expect((await lerFontesClaude($)).valido).toBe(true)
  $.fs.stat = async () => { throw new Error('fs.stat failed: EACCES; ENOENT citado') }
  expect((await lerFontesClaude($)).valido).toBe(false)
  const vistos: string[] = []
  const path = await localizarCliFontes('C:/fake', async p => { vistos.push(p); if (p.includes('/.agents/')) throw { code: 'ENOENT' }; return {} })
  expect(path).toBe('C:/fake/.claude/skills/dupla/scripts/fontes.ps1')
  expect(vistos.length).toBe(2)
  let recusou = false
  try { await localizarCliFontes('C:/fake', async () => { throw { code: 'EACCES' } }) } catch { recusou = true }
  expect(recusou).toBe(true)
})

test('comando composer executa argv local e comando plugin continua recusado', async () => {
  const argv: unknown[] = []
  const $: any = {
    env: { get: async () => 'C:/fake' }, fs: { read: async () => livre, stat: async () => ({ kind: 'file' }) },
    process: { run: async (args: unknown) => { argv.push(args); return { exitCode: 0, stdout: '', stderr: '' } } },
    state: { get: async () => ({ value: '', version: 0 }), set: async () => ({ isSet: true, version: 1 }) },
  }
  let comando: any
  register(((evento: string, ...args: any[]) => { if (evento === 'command.run' && args[0]?.command === 'orquestra') comando = args.at(-1) }) as any, {})
  const resposta = await comando($, { args: 'fontes ligar claude-max', origin: { kind: 'composer' } })
  expect(resposta.text).toMatch('Fontes globais')
  expect(argv).toEqual([['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:/fake/.agents/skills/dupla/scripts/fontes.ps1', '-Acao', 'liberar', '-Fonte', 'claude-max']])
  expect((await comando($, { args: 'fontes ligar claude-max', origin: { kind: 'plugin', name: 'teste' } })).text).toMatch('Só o usuário')
  expect(argv.length).toBe(1)
})


test('ausência inicial exige os dois arquivos ausentes; marcador presente ou ilegível bloqueia', async () => {
  const ausente = async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }
  expect((await lerFontes(ausente, ausente)).valido).toBe(true)
  expect((await lerFontes(ausente, async () => '')).valido).toBe(false)
  expect((await lerFontes(ausente, async () => { throw { code: 'EACCES' } })).valido).toBe(false)
  expect((await lerFontes(ausente, async () => { throw { code: 'EBUSY' } })).valido).toBe(false)
  expect((await lerFontes(ausente, async () => { throw new Error('ENOENT citado; EACCES real') })).valido).toBe(false)
  expect((await lerFontes(async () => travado, async () => { throw { code: 'EACCES' } })).bloqueadas).toEqual(['claude-max'])
})

test('adapter Claude não libera estado gerenciado ausente, inclusive lock ocupado pelo escritor', async () => {
  let marker: 'ausente' | 'presente' | 'negado' = 'ausente'
  let estado: string | undefined
  const $: any = { env: { get: async () => 'C:/fake' }, fs: {
    read: async (path: string) => {
      if (path.endsWith('.lock') && marker === 'presente') return ''
      if (!path.endsWith('.lock') && estado !== undefined) return estado
      throw new Error('read wrapped')
    },
    stat: async (path: string) => {
      if (path.endsWith('.lock') && marker === 'negado') throw { code: 'EACCES' }
      if (path.endsWith('.lock') && marker === 'presente') return { kind: 'file' }
      throw new Error('fs.stat failed: ENOENT: missing')
    },
  } }
  expect((await lerFontesClaude($)).valido).toBe(true)
  marker = 'presente'
  expect((await lerFontesClaude($)).valido).toBe(false)
  marker = 'negado'
  expect((await lerFontesClaude($)).valido).toBe(false)
  estado = travado
  expect((await lerFontesClaude($)).bloqueadas).toEqual(['claude-max'])
})


test('stat errno numérico de ausência exige mensagem ancorada e nunca prevalece sobre negação', () => {
  for (const errno of [-2, -4058]) {
    expect(statAusente({ errno, message: 'ENOENT: no such file' })).toBe(true)
    expect(statAusente({ errno, message: 'fs.stat failed: ENOENT: missing' })).toBe(true)
    expect(statAusente({ errno, message: 'ENOENT citado; EACCES real' })).toBe(false)
    expect(statAusente({ errno, message: 'EPERM: operation denied' })).toBe(false)
    expect(statAusente({ errno })).toBe(false)
    expect(statAusente({ code: 'EACCES', errno, message: 'ENOENT: citado' })).toBe(false)
  }
  expect(statAusente({ errno: -13, message: 'ENOENT: citado' })).toBe(false)
  expect(statAusente({ errno: -4048, message: 'ENOENT: citado' })).toBe(false)
})

test('gramática comum recusa propriedades repetidas e conserva ordem/escapes JSON legítimos', () => {
  for (const texto of [
    '{"versao":1,"bloqueadas":["chatgpt"],"versao":1}',
    '{"versao":1,"bloqueadas":[],"bloqueadas":[]}',
    '{"versao":1,"versao":[]}',
    '{"versao":1,"bloqueadas":[],}',
    '\uFEFF\uFEFF{"versao":1,"bloqueadas":[]}',
  ]) expect(analisarFontes(texto).valido).toBe(false)
  expect(analisarFontes('{"bloqueadas":["chatgpt"],"versao":1e0}').bloqueadas).toEqual(['chatgpt'])
  expect(analisarFontes(String.raw`{"\u0076ersao":1.0,"bloqueadas":["chat\u0067pt"]}`).bloqueadas).toEqual(['chatgpt'])
  expect(analisarFontes('\uFEFF{"versao":1,"bloqueadas":[]}').valido).toBe(true)
})


test('Claude normal/MSIX compartilham canônico, preservam legados e não ressuscitam trava liberada', async () => {
  const home = 'C:/fake/user', homeWindows = String.raw`C:\fake\user`, normal = `${home}/AppData/Local`, msix = `${normal}/Packages/Claude_teste/LocalCache/Local`
  const canonical = `${home}/.local/share/dupla/fontes.json`
  const arquivos = new Map<string, string>([
    [`${normal}/dupla/fontes.json`, '{"versao":1,"bloqueadas":["chatgpt"]}'],
    [`${msix}/dupla/fontes.json`, '{"versao":1,"bloqueadas":["claude-max","openrouter"]}'],
  ])
  let local = normal, negarPackages = false
  const missing = () => Object.assign(new Error('ENOENT: missing'), { code: 'ENOENT' })
  const $: any = { env: { get: async (key: string) => key === 'USERPROFILE' ? homeWindows : key === 'LOCALAPPDATA' ? local : undefined }, fs: {
    read: async (path: string) => { if (!arquivos.has(path)) throw missing(); return arquivos.get(path) },
    stat: async (path: string) => { if (path.endsWith('/Packages')) { if (negarPackages) throw { code: 'EACCES' }; return { kind: 'dir' } }; if (!arquivos.has(path)) throw missing(); return { kind: 'file' } },
    list: async () => [{ name: 'Claude_teste', kind: 'dir' }],
  } }
  for (const ambiente of [normal, msix, normal.toUpperCase()]) {
    local = ambiente
    expect((await lerFontesClaude($)).bloqueadas).toEqual(['claude-max', 'chatgpt', 'openrouter'])
  }
  local = 'relativo'
  expect((await lerFontesClaude($)).valido).toBe(false)
  arquivos.set(canonical, livre)
  negarPackages = true // canônico é autoridade e não toca nos legados
  expect((await lerFontesClaude($)).bloqueadas).toEqual([])
  local = normal
  arquivos.delete(canonical)
  arquivos.set(canonical + '.lock', '')
  expect((await lerFontesClaude($)).valido).toBe(false)
  arquivos.delete(canonical + '.lock')
  expect((await lerFontesClaude($)).valido).toBe(false) // enumeração inacessível
  negarPackages = false
  arquivos.set(`${msix}/dupla/fontes.json`, '{}')
  expect((await lerFontesClaude($)).valido).toBe(false)
  $.env.get = async () => undefined
  expect((await lerFontesClaude($)).valido).toBe(false)
})


test('caminhos globais Windows não são resolvidos pelo cwd', () => {
  for (const path of ['', 'C:foo', '/foo', 'relative', String.fromCharCode(92) + 'foo']) expect(caminhoAbsolutoFontes(path)).toBe(false)
  for (const path of ['C:/Users/fake', String.raw`C:\Users\fakeuser`, '//server/share/user', String.raw`\\server\share\user`]) expect(caminhoAbsolutoFontes(path)).toBe(true)
  expect(caminhoAbsolutoFontes('/home/fake', false)).toBe(true)
})
