import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Só substitui o registro do plugin. Todo o fluxo gemeo/index.ts é o código real,
// com servidor e ferramentas de mentira: não abre sessão nem faz chamada a modelo.
const loader = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@opencode/plugin') return { url: 'data:text/javascript,export const Plugin = { define: p => p };', shortCircuit: true }
  return next(specifier, context)
} })
const plugin = (await import('./index.ts')).default
loader.deregister()
const pasta = mkdtempSync(join(tmpdir(), 'gemeo-rota-teste-'))
const homeAnterior = process.env.USERPROFILE
process.env.USERPROFILE = pasta
const localAnterior = process.env.LOCALAPPDATA
process.env.LOCALAPPDATA = pasta
const pastaFontes = join(pasta, '.local', 'share', 'dupla')
mkdirSync(pastaFontes, { recursive: true })
const arquivoFontes = join(pastaFontes, 'fontes.json')
const arquivo = join(pasta, 'politica.json')
writeFileSync(arquivo, JSON.stringify({ versao: 2, capacidades: {
  N1: { esforco: 'low', escalado: 'medium', familias: ['haiku', 'luna', 'flash-lite'] },
  N2: { esforco: 'medium', escalado: 'high', familias: ['sonnet', 'terra', 'flash'] },
  N3: { esforco: 'high', escalado: 'xhigh', familias: ['opus', 'sol'] },
}, revisao: { capacidade: 'N3', familias: ['astra', 'fable', 'argon'], L1: 'high', L2: 'xhigh' },
  limites: { astraExecutor: false, gptExtra: false, rodadasCruzadasPorFatia: 2 } }))
const antes = process.env.ORQUESTRA_POLITICA
process.env.ORQUESTRA_POLITICA = arquivo
test.after(() => {
  if (antes === undefined) delete process.env.ORQUESTRA_POLITICA
  else process.env.ORQUESTRA_POLITICA = antes
  if (homeAnterior === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = homeAnterior
  if (localAnterior === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = localAnterior
  if (existsSync(arquivoFontes)) unlinkSync(arquivoFontes)
  rmdirSync(pastaFontes)
  rmdirSync(join(pasta, '.local', 'share'))
  rmdirSync(join(pasta, '.local'))
  unlinkSync(arquivo)
  rmdirSync(pasta)
})
const rota = { fatia: 'fatia-1', nivel: 'N2', familia: 'terra', papel: 'execucao', motivo: 'integração delimitada' }

async function servidor(opcoes: { divergir?: boolean; semVariante?: boolean; divergirID?: boolean } = {}) {
  const tools = new Map<string, any>()
  const hooks = new Map<string, any>()
  const commands = new Map<string, any>()
  const storage = new Map<string, any>()
  const chamadas: any[] = []
  let selecionado: any
  let modeloInferencia: any
  const registro = { dispose: async () => {} }
  const ctx: any = {
    tool: { transform: async (f: any) => { f({ add: (t: any) => tools.set(t.name, t) }); return registro } },
    command: { transform: async (f: any) => { f({ add: (c: any) => commands.set(c.name, c) }); return registro } },
    storage: { get: async (k: string) => storage.get(k), set: async (k: string, v: any) => { storage.set(k, v) } },
    model: { list: async () => [
      { providerID: 'openai', id: 'gpt-6.1-terra', variants: [{ id: opcoes.semVariante ? 'low' : 'medium' }], time: { released: 2 } },
      { providerID: 'anthropic', id: 'claude-sonnet-5-5', variants: [{ id: 'medium' }], time: { released: 2 } },
      { providerID: 'google', id: 'antigravity-claude-sonnet-5-5-medium', variants: [], time: { released: 0 } },
      { providerID: 'google', id: 'antigravity-claude-opus-5-5-high', variants: [], time: { released: 0 } },
    ] },
    session: {
      hook: async (name: string, f: any) => { hooks.set(name, f); return registro },
      create: async () => { chamadas.push('create'); return { id: 'nova-isolada' } },
      switchModel: async (p: any) => { chamadas.push(['switch', p.sessionID]); selecionado = p.model },
      get: async ({ sessionID }: any) => { chamadas.push(['get', sessionID]); return { model: opcoes.divergirID ? { ...selecionado, id: selecionado.id.replace(/-medium$/, '-low') } : opcoes.divergir ? { ...selecionado, variant: 'low' } : selecionado } },
      synthetic: async (p: any) => { chamadas.push(['synthetic', p]); return {} },
      prompt: async (p: any) => { if (modeloInferencia) await hooks.get('model.request')({ sessionID: p.sessionID, model: modeloInferencia, kind: 'primary' }); chamadas.push(['prompt', p.sessionID]); return { id: 'msg-fake' } },
      remove: async ({ sessionID }: any) => { chamadas.push(['remove', sessionID]) },
    },
  }
  await plugin.setup(ctx)
  const chamar = (name: string, input: any) => tools.get(name).execute(input, { sessionID: 'sessao-atual' })
  return { chamar, chamadas, storage, hooks, commands, inferirCom: (m: any) => { modeloInferencia = m }, selecionar: (m: any) => { selecionado = m }, observarGet: (f: () => void) => { const get = ctx.session.get; ctx.session.get = async (p: any) => { f(); return get(p) } }, listarCom: (f: () => Promise<any[]>) => { ctx.model.list = f }, recarregar: () => plugin.setup(ctx) }
}

test('preparar em sessão ativa é pendente; repetição/steering não muda modelo', async () => {
  const s = await servidor()
  const primeiro = JSON.parse((await s.chamar('rotear_tarefa', rota)).content)
  assert.equal(primeiro.aplicado, null)
  assert.match(primeiro.estado, /pendente/)
  await s.chamar('rotear_tarefa', rota)
  await assert.rejects(s.chamar('rotear_tarefa', { ...rota, escalado: true }), /fixos/)
  assert.deepEqual(s.chamadas, [])
})

test('despacho aplica só sessão nova, confirma antes do prompt e informa pedido/aplicado', async () => {
  const s = await servidor()
  const out = JSON.parse((await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'fatia autorizada', rota })).content)
  assert.deepEqual(s.chamadas, ['create', ['switch', 'nova-isolada'], ['get', 'nova-isolada'], ['prompt', 'nova-isolada']])
  assert.equal(out.rota.aplicado.variant, 'medium')
  assert.deepEqual(out.rota.esforco, { valor: 'medium', representacao: 'variant' })
  assert.equal(out.rota.pedido.nivel, 'N2')
  assert.equal(s.storage.has('rota/sessao-atual'), false)
})

test('Antigravity confirma ID antes do prompt e registra representação do esforço no retorno/store', async () => {
  const s = await servidor()
  const agy = { ...rota, familia: 'sonnet', canal: 'antigravity' }
  const out = JSON.parse((await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: agy })).content)
  assert.deepEqual(s.chamadas, ['create', ['switch', 'nova-isolada'], ['get', 'nova-isolada'], ['prompt', 'nova-isolada']])
  assert.deepEqual(out.rota.aplicado, { providerID: 'google', id: 'antigravity-claude-sonnet-5-5-medium' })
  assert.deepEqual(out.rota.esforco, { valor: 'medium', representacao: 'embutido_no_id' })
  assert.equal(out.rota.pedido.familia, 'sonnet')
  assert.deepEqual(s.storage.get('rota/nova-isolada'), out.rota)
})

test('ID Antigravity divergente remove só sessão nova, sem admitir prompt', async () => {
  const s = await servidor({ divergirID: true })
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet', canal: 'antigravity' } }), /diverge/)
  assert.deepEqual(s.chamadas, ['create', ['switch', 'nova-isolada'], ['get', 'nova-isolada'], ['remove', 'nova-isolada']])
})

test('canal inválido, família desconhecida, família só de revisão ou xhigh ausente recusam antes de create', async () => {
  const s = await servidor()
  for (const [alteracao, erro] of [
    [{ canal: 'google' }, /canal inválido/],
    [{ canal: 'antigravity', familia: 'desconhecida' }, /não atende N2/],
    [{ familia: 'fable' }, /reservado à revisão/],
    [{ canal: 'antigravity', nivel: 'N3', familia: 'argon' }, /reservado à revisão/],
    [{ familia: 'sol' }, /não atende N2/],
    [{ canal: 'antigravity', nivel: 'N3', familia: 'opus', escalado: true }, /sem reduzir esforço nem trocar canal/],
  ] as const) {
    await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, ...alteracao } }), erro)
  }
  assert.deepEqual(s.chamadas, [])
})

test('reserva antiga sem canal aceita nativo, mas A→B→A não permite trocar para Antigravity', async () => {
  const s = await servidor()
  const antiga = { ...rota, familia: 'sonnet', esforco: 'medium', versao: 1 }
  s.storage.set('rotas/sessao-atual', { [rota.fatia]: antiga })
  await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet', canal: 'nativo' } })
  await s.chamar('rotear_tarefa', { ...rota, fatia: 'fatia-b' })
  await s.recarregar()
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet', canal: 'antigravity' } }), /fixos/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 1)
})

test('apelido legado nativo não muda de canal com Antigravity presente no catálogo', async () => {
  const s = await servidor()
  const out = JSON.parse((await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', model: 'sonnet', effort: 'medium' })).content)
  assert.equal(out.model, 'anthropic/claude-sonnet-5-5 (medium)')
  assert.equal(out.rota, undefined)
})

test('modelo explícito conflitante e variante ausente falham antes de criar', async () => {
  const s = await servidor()
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota, model: 'luna' }), /competir/)
  assert.deepEqual(s.chamadas, [])
  const sem = await servidor({ semVariante: true })
  await assert.rejects(sem.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota }), /não foi reduzido/)
  assert.deepEqual(sem.chamadas, [])
})

test('divergência real remove só a sessão criada e impede o primeiro prompt', async () => {
  const s = await servidor({ divergir: true })
  await assert.rejects(s.chamar('spawn_task', { cwd: 'C:/fake', prompt: 'p', rota }), /diverge/)
  assert.deepEqual(s.chamadas, ['create', ['switch', 'nova-isolada'], ['get', 'nova-isolada'], ['remove', 'nova-isolada']])
})

test('despacho confere rota preparada do chamador antes de criar', async () => {
  const s = await servidor()
  await s.chamar('rotear_tarefa', rota)
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet' } }), /fixos/)
  assert.deepEqual(s.chamadas, [])
})

test('primeiro despacho sem preparo reserva a fatia; família não muda no segundo', async () => {
  const s = await servidor()
  await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota })
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet' } }), /fixos/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 1)
  assert.equal(s.storage.get('rota-preparada/sessao-atual').pedido.familia, 'terra')
})

test('despachos simultâneos da mesma fatia também reservam uma única família', async () => {
  const s = await servidor()
  const resultados = await Promise.allSettled([
    s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota }),
    s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet' } }),
  ])
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1)
  const erro = resultados.find(r => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(erro.reason), /fixos/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 1)
})

test('mapa de reservas por fatia sobrevive A→B→A e recarga do plugin', async () => {
  const s = await servidor()
  await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota })
  await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, fatia: 'fatia-2', familia: 'sonnet' } })
  await s.recarregar()
  await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: { ...rota, familia: 'sonnet' } }), /fixos/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 2)
  assert.equal(s.storage.get('rotas/sessao-atual')['fatia-1'].familia, 'terra')
  assert.equal(s.storage.get('rotas/sessao-atual')['fatia-2'].familia, 'sonnet')
})


const agySonnet = (esforco: string) => ({ providerID: 'google', id: `antigravity-claude-sonnet-5-5-${esforco}`, enabled: true, variants: [] })
const rotaAgy = { ...rota, familia: 'sonnet', canal: 'antigravity' }
const abrirAgy = (s: Awaited<ReturnType<typeof servidor>>) => s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota: rotaAgy })

test('promoção registra esforço pedido e aplicado sem mudar a rota pedida', async () => {
  const s = await servidor()
  s.listarCom(async () => [agySonnet('high'), agySonnet('xhigh')])
  s.observarGet(() => assert.equal(s.storage.has('rota/nova-isolada'), false))
  const out = JSON.parse((await abrirAgy(s)).content)
  assert.equal(out.rota.pedido.esforco, 'medium')
  assert.match(out.avisos.join(' '), /pedido medium, aplicado high/)
  assert.deepEqual(out.rota.esforco, { valor: 'high', representacao: 'embutido_no_id' })
  assert.equal(out.rota.aplicado.id, agySonnet('high').id)
  assert.deepEqual(s.storage.get('rota/nova-isolada'), out.rota)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforco, 'medium')
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
})

test('reserva do esforço selecionado sobrevive recarga e recusa exato reaparecido', async () => {
  const s = await servidor()
  s.listarCom(async () => [agySonnet('high')])
  const anterior = { ...rota, fatia: 'anterior', esforco: 'medium', versao: 1, esforcoSelecionado: 'xhigh' }
  s.storage.set('rotas/sessao-atual', { anterior })
  await abrirAgy(s)
  await s.recarregar()
  await abrirAgy(s)
  s.listarCom(async () => [agySonnet('medium'), agySonnet('high')])
  await assert.rejects(abrirAgy(s), /esforço selecionado fixo.*catálogo mudou/)
  s.listarCom(async () => [agySonnet('xhigh')])
  await assert.rejects(abrirAgy(s), /esforço selecionado fixo.*catálogo mudou/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 2)
  assert.deepEqual(s.storage.get('rotas/sessao-atual').anterior, anterior)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
})

test('fila de despachos concorrentes recusa esforços diferentes para a mesma fatia', async () => {
  const s = await servidor()
  let consultas = 0
  s.listarCom(async () => [agySonnet(++consultas === 1 ? 'high' : 'medium')])
  const resultados = await Promise.allSettled([abrirAgy(s), abrirAgy(s)])
  assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1)
  const erro = resultados.find(r => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(erro.reason), /esforço selecionado fixo/)
  assert.equal(s.chamadas.filter(c => c === 'create').length, 1)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
})

test('divergência depois da promoção não grava aplicado confirmado nem envia prompt', async () => {
  const s = await servidor({ divergir: true })
  s.listarCom(async () => [agySonnet('high')])
  await assert.rejects(abrirAgy(s), /diverge/)
  assert.equal(s.storage.has('rota/nova-isolada'), false)
  assert.equal(s.chamadas.some(c => Array.isArray(c) && c[0] === 'prompt'), false)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
})


test('preparo novo usa null e novo preparo preserva seleção já reservada', async () => {
  const s = await servidor()
  await s.chamar('rotear_tarefa', rotaAgy)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, null)
  s.listarCom(async () => [agySonnet('high')])
  await abrirAgy(s)
  const repetido = JSON.parse((await s.chamar('rotear_tarefa', rotaAgy)).content)
  assert.equal(repetido.esforcoSelecionado, 'high')
  assert.equal(repetido.aplicado, null)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
})

test('migração de reserva antiga mantém exato e recusa promoção na mesma fatia', async () => {
  const s = await servidor()
  s.storage.set('rotas/sessao-atual', { [rota.fatia]: { ...rotaAgy, esforco: 'medium', versao: 1 } })
  s.listarCom(async () => [agySonnet('high')])
  await assert.rejects(abrirAgy(s), /esforço selecionado fixo/)
  assert.deepEqual(s.chamadas, [])
  await s.chamar('rotear_tarefa', rotaAgy)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'medium')
  s.listarCom(async () => [agySonnet('medium')])
  await abrirAgy(s)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'medium')
})

test('rota ativa da filha também preserva esforço aplicado no mesmo ID de fatia', async () => {
  const s = await servidor()
  const pedido = { ...rotaAgy, esforco: 'medium', versao: 1 }
  s.storage.set('rota/sessao-atual', { pedido, aplicado: { providerID: 'google', id: agySonnet('high').id },
    esforco: { valor: 'high', representacao: 'embutido_no_id' } })
  await s.chamar('rotear_tarefa', rotaAgy)
  assert.equal(s.storage.get('rotas/sessao-atual')[rota.fatia].esforcoSelecionado, 'high')
  await assert.rejects(abrirAgy(s), /esforço selecionado fixo/)
  assert.deepEqual(s.chamadas, [])
})


test('trava global protege despacho fixo, mensagem e cpa; liberação relida sem reiniciar', async () => {
  const s = await servidor()
  writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: ['chatgpt'] }))
  try {
    await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', rota }), /Assinatura ChatGPT travada por você/)
    assert.deepEqual(s.chamadas, [])
    s.selecionar({ providerID: 'openai', id: 'gpt-6.1-sol' })
    await assert.rejects(s.chamar('SendMessage', { to: 'destino', message: 'p' }), /travada/)
    await assert.rejects(s.commands.get('cpa').execute({ sessionID: 'destino', prompt: { text: '' } }), /travada/)
    assert.equal(s.chamadas.some(c => Array.isArray(c) && c[0] === 'prompt'), false)
    writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: [] }))
    await s.chamar('SendMessage', { to: 'destino', message: 'p' })
    assert.equal(s.chamadas.some(c => Array.isArray(c) && c[0] === 'prompt'), true)
  } finally { unlinkSync(arquivoFontes) }
})

test('hooks gerais barram direto, continuação, subagente, título e compactação em HTTP e WebSocket', async () => {
  const s = await servidor()
  const modelos = [
    ['openai', 'gpt-6.1-sol', 'chatgpt'], ['anthropic', 'claude-sonnet-5-5', 'anthropic-api'],
    ['google', 'antigravity-gemini-3.1-argon-high', 'antigravity'], ['openrouter', 'qualquer', 'openrouter'],
  ]
  try {
    for (const [providerID, id, fonte] of modelos) {
      writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: [fonte] }))
      for (const fronteira of ['context', 'model.request', 'http.request', 'experimental.ws.handshake', 'experimental.ws.send']) {
        for (const kind of ['primary', 'compaction', 'title', 'generate']) {
          await assert.rejects(s.hooks.get(fronteira)({ sessionID: 'direta', agent: 'filha', model: { providerID, id }, kind, system: [] }), /travada/)
        }
      }
    }
    await assert.rejects(s.hooks.get('http.request')({ model: { providerID: 'google', id: 'gemini-pro' } }), /desconhecida/)
    writeFileSync(arquivoFontes, '{quebrado')
    await assert.rejects(s.hooks.get('http.request')({ model: { providerID: 'openai', id: 'gpt-6.1-sol' } }), /inválido ou ilegível/)
  } finally { unlinkSync(arquivoFontes) }
})

test('fonte distinta autorizada continua disponível e modelo explícito desconhecido nunca cai no padrão', async () => {
  const s = await servidor()
  writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: ['claude-max'] }))
  try {
    await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', model: 'sonnet' })
    const anteriores = s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length
    await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p', model: 'desconhecido' }), /não reconhecido/)
    assert.equal(s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length, anteriores)
    await s.commands.get('fontes').execute({ sessionID: 'local', prompt: { text: '' } })
    const local = s.chamadas.find(c => Array.isArray(c) && c[0] === 'synthetic')[1]
    assert.equal(local.resume, false)
    assert.match(local.text, /Assinatura Claude travada por você/)
    assert.equal(s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length, anteriores)
  } finally { unlinkSync(arquivoFontes) }
})


test('sessão sem model registrado adia decisão à fronteira real, que permite ou bloqueia a fonte efetiva', async () => {
  const s = await servidor()
  s.inferirCom({ providerID: 'openai', id: 'gpt-6.1-sol' })
  writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: ['openrouter'] }))
  try {
    await s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p' })
    await s.chamar('SendMessage', { to: 'sem-modelo', message: 'p' })
    await s.commands.get('cpa').execute({ sessionID: 'sem-modelo', prompt: { text: '' } })
    assert.equal(s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length, 3)
    writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: ['chatgpt'] }))
    await assert.rejects(s.chamar('start_session', { cwd: 'C:/fake', prompt: 'p' }), /Assinatura ChatGPT travada/)
    await assert.rejects(s.chamar('SendMessage', { to: 'sem-modelo', message: 'p' }), /Assinatura ChatGPT travada/)
    await assert.rejects(s.commands.get('cpa').execute({ sessionID: 'sem-modelo', prompt: { text: '' } }), /Assinatura ChatGPT travada/)
    assert.equal(s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length, 3)
  } finally { unlinkSync(arquivoFontes) }
})

test('/fontes apresenta erro de uso localmente, sem processo nem inferência', async () => {
  const s = await servidor()
  for (const args of ['constructor chatgpt', 'toString claude-max', 'desligar foo']) {
    await s.commands.get('fontes').execute({ sessionID: 'local', prompt: { text: args } })
    const entrada = s.chamadas.at(-1)
    assert.equal(entrada[0], 'synthetic')
    assert.equal(entrada[1].resume, false)
    assert.match(entrada[1].text, /⚠️.*Use fontes/)
  }
  assert.equal(s.chamadas.filter(c => Array.isArray(c) && c[0] === 'prompt').length, 0)
})


test('adapter OpenCode bloqueia perda do estado após marcador e conserva estado válido', async () => {
  const s = await servidor()
  const marker = arquivoFontes + '.lock'
  const event = { model: { providerID: 'openai', id: 'gpt-6.1-sol' }, kind: 'primary' }
  await s.hooks.get('model.request')(event) // instalação fresca: ambos ausentes
  writeFileSync(marker, '')
  try {
    await assert.rejects(s.hooks.get('model.request')(event), /inválido ou ilegível/)
    writeFileSync(arquivoFontes, JSON.stringify({ versao: 1, bloqueadas: ['openrouter'] }))
    await s.hooks.get('model.request')(event)
    unlinkSync(arquivoFontes)
    // Diretório no lugar do marcador: erro de leitura também bloqueia.
    unlinkSync(marker)
    mkdirSync(marker)
    await assert.rejects(s.hooks.get('model.request')(event), /inválido ou ilegível/)
    rmdirSync(marker)
  } finally {
    if (existsSync(arquivoFontes)) unlinkSync(arquivoFontes)
    if (existsSync(marker)) unlinkSync(marker)
  }
})


test('OpenCode ignora LOCALAPPDATA como canônico, une normal/MSIX e respeita liberação consolidada', async () => {
  const { lerFontesOpenCode } = await import('./fontes.ts')
  const normal = join(pasta, 'AppData', 'Local')
  const msix = join(normal, 'Packages', 'Claude_teste', 'LocalCache', 'Local')
  const dirs = [join(pasta, 'AppData'), normal, join(normal, 'dupla'), join(normal, 'Packages'), join(normal, 'Packages', 'Claude_teste'), join(normal, 'Packages', 'Claude_teste', 'LocalCache'), msix, join(msix, 'dupla')]
  for (const dir of dirs) mkdirSync(dir)
  const arquivos = [join(normal, 'dupla', 'fontes.json'), join(msix, 'dupla', 'fontes.json')]
  writeFileSync(arquivos[0], '{"versao":1,"bloqueadas":["chatgpt"]}')
  writeFileSync(arquivos[1], '{"versao":1,"bloqueadas":["claude-max","openrouter"]}')
  const local = process.env.LOCALAPPDATA
  try {
    for (const ambiente of [normal, msix]) {
      process.env.LOCALAPPDATA = ambiente
      assert.deepEqual((await lerFontesOpenCode()).bloqueadas, ['claude-max', 'chatgpt', 'openrouter'])
    }
    writeFileSync(arquivoFontes, '{"versao":1,"bloqueadas":[]}')
    writeFileSync(arquivos[1], '{}') // legado inválido é irrelevante após canônico
    assert.deepEqual((await lerFontesOpenCode()).bloqueadas, [])
  } finally {
    process.env.LOCALAPPDATA = local
    if (existsSync(arquivoFontes)) unlinkSync(arquivoFontes)
    for (const file of arquivos) unlinkSync(file)
    for (const dir of dirs.reverse()) rmdirSync(dir)
  }
})
