import { expect, mock, test } from 'claude-code/testing'
import { escolherRota, lerPolitica, conferirFatia, observarModeloClaude, reservarFatia } from './roteamento'
import { iniciarRota, registrarRota } from './rota-claude'

const politica = { versao: 2, capacidades: {
  N1: { esforco: 'low', escalado: 'medium', familias: ['haiku', 'luna', 'flash-lite'] },
  N2: { esforco: 'medium', escalado: 'high', familias: ['sonnet', 'terra', 'flash'] },
  N3: { esforco: 'high', escalado: 'xhigh', familias: ['opus', 'sol'] },
}, revisao: { capacidade: 'N3', familias: ['astra', 'fable', 'argon'], L1: 'high', L2: 'xhigh' },
  limites: { astraExecutor: false, gptExtra: false, rodadasCruzadasPorFatia: 2 } }
const pedido = { fatia: 'nova-1', nivel: 'N2', familia: 'sonnet', papel: 'execucao', motivo: 'implementação delimitada' }
const TOOL = 'mcp__orquestra__rotear_tarefa'

test('canal explícito é validado e reserva antiga sem canal continua nativa', async () => {
  const p = lerPolitica(JSON.stringify(politica))
  const nativa = escolherRota(p, pedido)
  expect(nativa.canal).toBe('nativo')
  const { canal, ...antiga } = nativa
  conferirFatia(antiga, nativa)
  conferirFatia(nativa, antiga)
  const agy = escolherRota(p, { ...pedido, canal: 'antigravity' })
  const reservas = reservarFatia({ [antiga.fatia]: antiga }, { ...agy, fatia: 'fatia-b' })
  let conflito = false
  try { reservarFatia(reservas, agy) } catch { conflito = true }
  expect(conflito).toBe(true)
  for (const canalInvalido of ['', 'google', 'ANTIGRAVITY', null, 1]) {
    let recusou = false
    try { escolherRota(p, { ...pedido, canal: canalInvalido }) } catch { recusou = true }
    expect(recusou).toBe(true)
  }
})

test('política separa capacidade, esforço, revisão e reserva do Astra', async () => {
  const p = lerPolitica(JSON.stringify(politica))
  expect(escolherRota(p, pedido).esforco).toBe('medium')
  expect(escolherRota(p, { ...pedido, escalado: true }).esforco).toBe('high')
  // Revisores (astra, fable, argon) seguem o mesmo piso por risco: L1 = revisao.L1; L2 ou escalado = revisao.L2.
  for (const familia of ['fable', 'astra', 'argon']) {
    expect(escolherRota(p, { ...pedido, nivel: 'N3', familia, papel: 'revisao', risco: 'L1' }).esforco).toBe('high')
    expect(escolherRota(p, { ...pedido, nivel: 'N3', familia, papel: 'revisao', risco: 'L2' }).esforco).toBe('xhigh')
    expect(escolherRota(p, { ...pedido, nivel: 'N3', familia, papel: 'revisao', risco: 'L1', escalado: true }).esforco).toBe('xhigh')
  }
  expect(escolherRota(p, { ...pedido, nivel: 'N2', familia: 'terra' }).esforco).toBe('medium')
  expect(escolherRota(p, { ...pedido, nivel: 'N1', familia: 'flash-lite' }).esforco).toBe('low')
  expect(escolherRota(p, { ...pedido, nivel: 'N3', familia: 'sol' }).esforco).toBe('high')
  // Família só de revisão é recusada na execução e na orquestração; Sol saiu do N2.
  for (const invalido of [{ ...pedido, familia: 'haiku' }, { ...pedido, nivel: 'N3', familia: 'astra' }, { ...pedido, papel: 'revisao', risco: 'L2' },
    { ...pedido, nivel: 'N3', familia: 'fable' }, { ...pedido, nivel: 'N3', familia: 'argon', papel: 'orquestracao' }, { ...pedido, familia: 'sol' },
    { ...pedido, nivel: 'N3', familia: 'opus', papel: 'revisao', risco: 'L1' }]) {
    let recusou = false
    try { escolherRota(p, invalido) } catch { recusou = true }
    expect(recusou).toBe(true)
  }
  const rota = escolherRota(p, pedido)
  let recusou = false
  try { conferirFatia(rota, { ...rota, esforco: 'high' }) } catch { recusou = true }
  expect(recusou).toBe(true)
})

test('modelo divergente ou não observado deixa aplicação pendente; esforço não é confirmado', async () => {
  const rota = escolherRota(lerPolitica(JSON.stringify(politica)), { ...pedido, nivel: 'N3', familia: 'fable', papel: 'revisao', risco: 'L1' })
  const certo = observarModeloClaude(rota, 'claude-fable-5-1')
  expect(certo.aplicado).toEqual({ model: 'claude-fable-5-1' })
  expect(certo.aviso).toMatch('esforço apenas enviado')
  for (const modelo of ['claude-sonnet-5-5', 'claude-opus-5-5', 'desconhecido', undefined]) {
    const observado = observarModeloClaude(rota, modelo)
    expect(observado.aplicado).toBeUndefined()
    expect(observado.aviso).toMatch('pendente')
  }
})

// A fronteira MCP aceita texto, blocos ou ausência; o runner não valida esse contrato.
async function chamarMcp($: any, input: any) {
  const resposta = await $.tool.call(input)
  expect(resposta.result === undefined || typeof resposta.result === 'string' || Array.isArray(resposta.result)).toBe(true)
  return resposta
}

async function preparar($: any, on: any, politicaSelecionada = politica) {
  mock.clock(on, { now: 1_800_000_000_000 })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/fake', ORQUESTRA_POLITICA: 'C:/fake/politica.json' })
  on('fs.read', (_: any, e: any) => { if (e.path.endsWith('fontes.json')) return { value: '{"versao":1,"bloqueadas":[]}' }; return { value: JSON.stringify(politicaSelecionada) } })
  on('fs.list', () => ({ value: [] }))
  let sessao = 'somente-eu'
  on('session.id', () => ({ value: sessao }))
  on('session.cwd', () => ({ value: 'C:/fake/projeto' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { startedAt: 1_800_000_000_000, context: {}, rateLimits: [], cost: {} } }))
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('tool.register', (_: any, e: any) => ({ value: { tool: `mcp__orquestra__${e.name}` } }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('classic.PostModelSwitch', () => ({}))
  const enviados: any[] = []
  let modeloResposta: string | undefined
  let trava: { entrou: () => void; espera: Promise<void> } | undefined
  const reterProximo = () => {
    const p = porta()
    trava = { entrou: p.entrou, espera: p.espera }
    return { entrada: p.entrada, liberar: p.liberar }
  }
  on('turn.step', async function* (_: any, e: any) {
    enviados.push({ model: e.model, effort: e.effort, agentId: e.agentId, sessao })
    const t = trava
    trava = undefined
    if (t) { t.entrou(); await t.espera }
    const usage = modeloResposta ? { model: modeloResposta, input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } : null
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  })
  await $.session.start({ cwd: 'C:/fake/projeto', surface: 'desktop', isInteractive: true })
  const passo = async (turnId: string, extra = {}) => {
    const stream = $.turn.step({ turnId, index: 0, messageCount: 1, model: 'claude-opus-5-5', effort: 'high', ...extra })
    for await (const _ of stream) { /* drena sem modelo real */ }
  }
  await $.turn.start({ text: 'planejar', turnId: 't1' })
  await passo('t1')
  const troca = (source: string, to_model: string) => $.classic.PostModelSwitch({ hook_event_name: 'PostModelSwitch', source,
    from_model: 'claude-opus-5-5', to_model, requested_model: to_model, context_tokens: 0, prompt_cache_warm: false,
    cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog' } as any)
  return { enviados, passo, troca, reterProximo, mudarSessao: (id: string) => { sessao = id },
    responderComo: (modelo: string | undefined) => { modeloResposta = modelo },
    reiniciar: () => $.session.start({ cwd: 'C:/fake/projeto', surface: 'desktop', isInteractive: true }),
  }
}

for (const acao of ['consultar', 'preparar']) {
  test(`MCP aceita result de ${acao} e preserva texto visível`, async ($, on) => {
    await preparar($, on)
    const resposta = await chamarMcp($, { tool: TOOL, ...pedido, acao })
    expect(resposta.deny).toBeUndefined()
    expect(typeof resposta.result).toBe('string')
    expect(resposta.result).toBe(resposta.text)
    const texto = JSON.parse(resposta.text ?? '{}')
    if (acao === 'consultar') {
      expect(texto.pendente).toBeUndefined()
    } else {
      expect(texto.pedido.fatia).toBe(pedido.fatia)
      expect(texto.estado).toBe('pendente')
      const estado = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
      expect(estado.pendente.fatia).toBe(pedido.fatia)
      expect(estado.reservas[pedido.fatia]).toEqual(texto.pedido)
    }
  })
}

test('falha ao persistir preparo mantém estado e reserva anteriores no store e no cache', async () => {
  const r = await simularRota('falha-store-mcp')
  await r.chamar(pedido)
  const anterior = await r.estado()
  const antes = r.disco.gravacoes
  expect((await r.chamar({ ...pedido, familia: 'haiku' })).deny).toMatch('roteamento recusado')
  expect(r.disco.gravacoes).toBe(antes)
  const gravacao = porta()
  r.disco.antesDeGravar = async () => { gravacao.entrou(); await gravacao.espera; throw new Error('store indisponível') }
  const falha = r.chamar({ ...pedido, fatia: 'nao-salva' })
  await gravacao.entrada
  expect(await r.estado()).toEqual(anterior)
  gravacao.liberar()
  expect((await falha).deny).toMatch('store indisponível')
  expect(await r.estado()).toEqual(anterior)
  expect(r.disco.estado).toEqual(anterior)
  r.disco.antesDeGravar = async () => {}
  await r.troca()
  const proximaGravacao = porta()
  r.disco.antesDeGravar = async () => { proximaGravacao.entrou(); await proximaGravacao.espera }
  const primeiro = r.chamar({ ...pedido, fatia: 'em-voo' })
  await proximaGravacao.entrada
  const segundo = r.chamar({ ...pedido, fatia: 'em-voo', escalado: true })
  const proximoTurno = r.turno('t2')
  proximaGravacao.liberar()
  expect((await primeiro).deny).toBeUndefined()
  expect((await segundo).deny).toMatch('fixos')
  await proximoTurno
  expect((await r.estado()).ativa.esforco).toBe('medium')
  expect(r.disco.estado).toEqual(await r.estado())
})

function porta() {
  let entrou = () => {}
  let liberar = () => {}
  const entrada = new Promise<void>(r => { entrou = r })
  const espera = new Promise<void>(r => { liberar = r })
  return { entrada, espera, entrou, liberar }
}

async function simularRota(id: string, inicializar = true) {
  const handlers: Record<string, any> = {}
  registrarRota(((evento: string, ...args: any[]) => { handlers[evento] = args.at(-1) }) as any, {})
  const disco = { estado: {} as any, leituras: 0, gravacoes: 0, antesDeGravar: async (_: any) => {} }
  const $: any = {
    session: { id: async () => id }, tool: { register: async () => {} },
    env: { get: async (nome: string) => nome === 'ORQUESTRA_POLITICA' ? 'politica.json' : nome === 'USERPROFILE' ? 'C:/fake' : undefined },
    fs: { read: async (path: string) => JSON.stringify(path.endsWith('fontes.json') ? { versao: 1, bloqueadas: [] } : politica) },
    store: {
      get: async () => { disco.leituras++; return disco.estado },
      set: async (_: string, estado: any) => { disco.gravacoes++; await disco.antesDeGravar(estado); disco.estado = estado },
    },
  }
  const chamar = (input: any) => chamarMcp({ tool: { call: (e: any) => handlers['tool.call']($, e) } }, { tool: TOOL, ...input })
  const estado = async () => JSON.parse((await chamar({ acao: 'consultar' })).text)
  const turno = (turnId: string, text = 'nova') => handlers['turn.start']($, { turnId, text }, async () => ({}))
  const troca = (source = 'picker') => handlers['classic.PostModelSwitch']($, { source }, async () => ({}))
  const stream = (turnId: string, extra = {}, resposta = async () => ({ usage: { model: 'claude-sonnet-5-5' } })) =>
    handlers['turn.step']($, { turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', ...extra }, async function* () { return await resposta() })
  const passo = async (turnId: string, extra = {}, resposta?: () => Promise<any>) => {
    for await (const _ of stream(turnId, extra, resposta)) { /* drena */ }
  }
  if (inicializar) {
    await iniciarRota($)
    await turno('t1')
    await passo('t1')
  }
  return { $, disco, handlers, chamar, estado, turno, troca, stream, passo }
}

test('aviso libera fila antes do yield; seleção manual vence preparo persistido em voo', async () => {
  const r = await simularRota('aviso-e-manual')
  expect(r.disco.leituras).toBe(1)
  const gravacao = porta()
  r.disco.antesDeGravar = async e => { if (e.pendente) { gravacao.entrou(); await gravacao.espera } }
  const preparo = r.chamar(pedido)
  await gravacao.entrada
  const manual = r.troca()
  gravacao.liberar()
  expect((await preparo).deny).toBeUndefined()
  await manual
  expect((await r.estado()).pendente).toBeUndefined()
  expect((await r.estado()).reservas[pedido.fatia]).toBeDefined()
  r.disco.antesDeGravar = async () => {}
  await r.chamar(pedido)
  await r.turno('t2')
  const aviso = r.stream('t2', { model: 'claude-haiku-5-5', effort: 'low' })
  expect((await aviso.next()).value.kind).toBe('text')
  await r.troca()
  expect((await r.estado()).aviso).toMatch('seleção explícita')
  await aviso.return()
})

test('confirmação em voo de A preserva preparo de B e autoriza reflexo confirmado', async () => {
  const r = await simularRota('confirmar-a-com-b')
  await r.chamar(pedido)
  await r.turno('t2')
  const modelo = porta()
  const a = r.passo('t2', {}, async () => { modelo.entrou(); await modelo.espera; return { usage: { model: 'claude-sonnet-5-5' } } })
  await modelo.entrada
  const gravacao = porta()
  r.disco.antesDeGravar = async e => { if (e.pendente?.fatia === 'b') { gravacao.entrou(); await gravacao.espera } }
  const b = r.chamar({ ...pedido, fatia: 'b', nivel: 'N1', familia: 'haiku' })
  await gravacao.entrada
  modelo.liberar()
  gravacao.liberar()
  await b
  await a
  const estado = await r.estado()
  expect(estado.pendente.fatia).toBe('b')
  expect(estado.aplicado.model).toBe('claude-sonnet-5-5')
  await r.turno('t3')
  await r.passo('t3', { model: 'claude-sonnet-5-5', effort: 'medium' })
  expect((await r.estado()).bloqueada).toBeUndefined()
})

test('falha de gravação não publica marcadores: turn.start pode ser repetido', async () => {
  const r = await simularRota('retry-turno')
  await r.chamar(pedido)
  const anterior = await r.estado()
  r.disco.antesDeGravar = async () => { throw new Error('indisponível') }
  let falhou = false
  try { await r.turno('t2') } catch { falhou = true }
  expect(falhou).toBe(true)
  const duranteFalha = await r.estado()
  expect(duranteFalha.pendente).toEqual(anterior.pendente)
  expect(duranteFalha.turnoFalho).toBe('t2')
  let enviou = false
  await r.passo('t2', {}, async () => { enviou = true; return { usage: null } })
  expect(enviou).toBe(false)
  r.disco.antesDeGravar = async () => {}
  await r.turno('t2')
  expect((await r.estado()).ativa.fatia).toBe(pedido.fatia)
})

test('store indisponível deixa passar turno sem rota e preserva a resposta já recebida', async () => {
  const r = await simularRota('falha-sem-rota')
  const indisponivel = async () => { throw new Error('indisponível') }
  r.disco.antesDeGravar = indisponivel
  await r.turno('livre')
  let enviou = false
  await r.passo('livre', {}, async () => { enviou = true; return { usage: null } })
  expect(enviou).toBe(true)
  r.disco.antesDeGravar = async () => {}
  await r.chamar(pedido)
  await r.turno('com-rota')
  r.disco.antesDeGravar = indisponivel
  const resultado = await r.stream('com-rota').next()
  expect(resultado.value.usage.model).toBe('claude-sonnet-5-5')
  expect((await r.estado()).aviso).toMatch('somente na memória')
  try { await r.turno('nova') } catch { /* rota ativa, falha no disco */ }
  r.disco.antesDeGravar = async () => {}
  await r.troca('picker')
  expect((await r.estado()).turnoFalho).toBeUndefined()
})

test('outra mensagem expira a ativação que falhou mesmo se o store continuar indisponível', async () => {
  const r = await simularRota('mensagem-apos-falha')
  await r.chamar(pedido)
  r.disco.antesDeGravar = async () => { throw new Error('indisponível') }
  try { await r.turno('t2') } catch { /* a mesma mensagem pode repetir a ativação */ }
  await r.turno('t3')
  let enviou = false
  await r.passo('t3', {}, async () => { enviou = true; return { usage: null } })
  expect(enviou).toBe(true)
  expect((await r.estado()).pendente).toBeUndefined()
  expect((await r.estado()).ativa).toBeUndefined()
})

for (const evento of ['manual', 'expiracao']) {
  test(`reabrir no mesmo processo preserva ${evento} ainda não sincronizada`, async () => {
    const r = await simularRota(`reabrir-${evento}`)
    await r.chamar(pedido)
    await r.turno('t2')
    r.disco.antesDeGravar = async () => { throw new Error('store indisponível') }
    if (evento === 'manual') {
      try { await r.troca() } catch { /* a seleção já ocorreu */ }
    } else await r.turno('t3')
    const local = await r.estado()
    const leituras = r.disco.leituras
    await iniciarRota(r.$)
    expect(r.disco.leituras).toBe(leituras)
    expect(await r.estado()).toEqual(local)
    expect((await r.estado()).ativa).toBeUndefined()
    r.disco.antesDeGravar = async () => {}
    await iniciarRota(r.$)
    expect(r.disco.estado).toEqual(local)
    expect(r.disco.leituras).toBe(leituras)
    expect((await r.chamar(pedido)).deny).toMatch('seleção deste turno ainda não observada')
  })
}

test('manual após falha reconhece turno atual e preparo aguarda a próxima mensagem', async () => {
  const r = await simularRota('manual-apos-falha-preparo')
  await r.chamar(pedido)
  r.disco.antesDeGravar = async () => { throw new Error('store indisponível') }
  try { await r.turno('t2') } catch { /* registra guarda local */ }
  expect((await r.chamar(pedido)).deny).toMatch('falha de gravação')
  try { await r.troca() } catch { /* libera o turno mesmo sem persistir */ }
  r.disco.antesDeGravar = async () => {}
  await r.passo('t2')
  expect((await r.chamar({ ...pedido, fatia: 'proxima' })).deny).toBeUndefined()
  await r.turno('t2')
  expect((await r.estado()).pendente.fatia).toBe('proxima')
  expect((await r.estado()).ativa).toBeUndefined()
  await r.turno('t3')
  expect((await r.estado()).ativa.fatia).toBe('proxima')
})

for (const evento of ['picker', 'auto', 'effort', 'bloqueio']) {
  test(`${evento} prevalece na memória com store indisponível`, async () => {
    const r = await simularRota(`falha-${evento}`)
    await r.chamar(pedido)
    await r.turno('t2')
    r.disco.antesDeGravar = async () => { throw new Error('store indisponível') }
    if (evento !== 'bloqueio') {
      let erro = ''
      try {
        if (evento === 'effort') await r.handlers['command.run'](r.$, { origin: { kind: 'composer' }, args: 'low' }, async () => ({}))
        else await r.troca(evento)
      } catch (e) { erro = String(e) }
      expect(erro).toMatch('store indisponível')
    }
    let enviou = false
    if (evento === 'auto' || evento === 'bloqueio') {
      const aviso = r.stream('t2', { model: 'claude-haiku-5-5', effort: 'low' }, async () => { enviou = true; return { usage: null } })
      expect((await aviso.next()).value.text).toMatch('Falha ao persistir: store indisponível')
      expect((await r.estado()).bloqueada).toBe(true)
      await aviso.return()
      await r.passo('t2', {}, async () => { enviou = true; return { usage: null } })
      expect(enviou).toBe(false)
    } else {
      expect((await r.estado()).ativa).toBeUndefined()
      await r.passo('t2', {}, async () => { enviou = true; return { usage: null } })
      expect(enviou).toBe(true)
    }
  })
}

test('continuação vazia não invalida preparo enfileirado da mesma mensagem', async () => {
  const r = await simularRota('preparo-continuacao')
  const gravacao = porta()
  r.disco.antesDeGravar = async () => { gravacao.entrou(); await gravacao.espera }
  const primeiro = r.chamar(pedido)
  await gravacao.entrada
  const continuacao = r.turno('continua', '')
  const segundo = r.chamar({ ...pedido, fatia: 'seguinte' })
  gravacao.liberar()
  await primeiro
  await continuacao
  expect((await segundo).deny).toBeUndefined()
  expect((await r.estado()).pendente.fatia).toBe('seguinte')
})

test('primeiros acessos concorrentes compartilham carga e preparo antigo não atravessa turnos', async () => {
  const r = await simularRota('primeiros-acessos', false)
  await Promise.all([r.chamar({ acao: 'consultar' }), r.chamar({ acao: 'consultar' })])
  expect(r.disco.leituras).toBe(1)
  await iniciarRota(r.$)
  expect(r.disco.leituras).toBe(2)
  await r.turno('t1')
  await r.passo('t1')
  const gravacao = porta()
  r.disco.antesDeGravar = async e => { if (e.pendente) { gravacao.entrou(); await gravacao.espera } }
  const primeiro = r.chamar(pedido)
  await gravacao.entrada
  const novoTurno = r.turno('t2')
  const antigo = r.chamar({ ...pedido, fatia: 'antigo' })
  gravacao.liberar()
  await primeiro
  await novoTurno
  expect((await antigo).deny).toMatch('turno mudou')
  expect((await r.estado()).pendente).toBeUndefined()
  expect((await r.estado()).reservas.antigo).toBeUndefined()
})

for (const invalidacao of ['picker', 'auto', 'turno']) {
  test(`resposta atrasada de A é invalidada por ${invalidacao}`, async () => {
    const r = await simularRota(`invalidar-${invalidacao}`)
    await r.chamar(pedido)
    await r.turno('t2')
    const modelo = porta()
    const a = r.passo('t2', {}, async () => { modelo.entrou(); await modelo.espera; return { usage: { model: 'claude-sonnet-5-5' } } })
    await modelo.entrada
    if (invalidacao === 'turno') await r.turno('t3')
    else await r.troca(invalidacao)
    modelo.liberar()
    await a
    expect((await r.estado()).aplicado).toBeUndefined()
    expect((await r.estado()).enviado).toBeUndefined()
  })
}

test('consulta grande resume o histórico e permite recuperar a primeira reserva depois de recarregar', async ($, on) => {
  const { reiniciar, passo } = await preparar($, on)
  const consulta = async (fatia?: string) => JSON.parse((await chamarMcp($, { tool: TOOL, acao: 'consultar', fatia })).result)
  for (let i = 1; i <= 9; i++) {
    const resposta = await chamarMcp($, { tool: TOOL, ...pedido, fatia: `fatia-${i}` })
    expect(resposta.deny).toBeUndefined()
    if (i === 8) expect(Object.keys((await consulta()).reservas).length).toBe(8)
  }
  await reiniciar()
  const resumo = await consulta()
  expect(resumo.reservas).toBeUndefined()
  expect(resumo.totalReservas).toBe(9)
  expect(resumo.amostraFatias.length).toBe(8)
  expect(resumo.pendente.fatia).toBe('fatia-9')
  expect((await consulta('fatia-1')).reserva.familia).toBe('sonnet')
  expect((await consulta('constructor')).reserva).toBe(null)
  await passo('t1')
  const conflito = await chamarMcp($, { tool: TOOL, ...pedido, fatia: 'fatia-1', escalado: true })
  expect(conflito.deny).toMatch('fixos')
})

test('Claude recusa Antigravity sem sobrescrever preparo nativo e orienta OpenCode', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  const recusada = await $.tool.call({ tool: TOOL, ...pedido, fatia: 'agy', canal: 'antigravity' } as any)
  expect(recusada.deny).toMatch('despacho no OpenCode')
  const estado = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(estado.pendente.fatia).toBe(pedido.fatia)
  expect(estado.reservas.agy).toBeUndefined()
  await $.turn.start({ text: 'executar nativa', turnId: 't2' })
  await passo('t2')
  expect(enviados.at(-1)?.model).toBe('sonnet')
})

test('rota pendente não muda turno/steering/continuação; próxima fatia fixa e subagente intacto', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  const resposta = await $.tool.call({ tool: TOOL, ...pedido } as any)
  expect(resposta.text).toMatch('pendente')
  await passo('t1') // ferramenta/steering no turno já aberto
  await $.turn.start({ text: '', turnId: 'continua' })
  await passo('continua')
  expect(enviados.slice(-2).every(e => e.model === 'claude-opus-5-5')).toBe(true)
  await $.turn.start({ text: 'executar nova fatia', turnId: 't2' })
  await passo('t2')
  await passo('t2')
  expect(enviados.slice(-2).every(e => e.model === 'sonnet' && e.effort === 'medium')).toBe(true)
  await passo('filha', { agentId: 'filha' })
  expect(enviados.at(-1)?.model).toBe('claude-opus-5-5')
  const recusada = await $.tool.call({ tool: TOOL, ...pedido, escalado: true } as any)
  expect(recusada.deny).toMatch('fixos')
})

test('escolha explícita no app entre turnos suspende override', async ($, on) => {
  const { enviados, passo, troca } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await troca('picker', 'claude-fable-5-1')
  await $.turn.start({ text: 'nova', turnId: 't2' })
  await passo('t2', { model: 'claude-fable-5-1', effort: 'xhigh' })
  expect(enviados.at(-1)?.model).toBe('claude-fable-5-1')
  expect(enviados.at(-1)?.effort).toBe('xhigh')
})

test('seletor visual só de esforço suspende a rota sem bloquear e vira a base do próximo preparo', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  // Sem PostModelSwitch nem /effort: o seletor só muda sessionEffort.
  await passo('t2', { effort: 'xhigh' })
  expect(enviados.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh', agentId: undefined, sessao: 'somente-eu' })
  const suspensa = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(suspensa.ativa).toBeUndefined()
  expect(suspensa.bloqueada).toBeUndefined()
  expect(suspensa.aviso).toMatch('seleção explícita no app preservada')
  expect(suspensa.reservas[pedido.fatia]).toBeDefined()
  await passo('t2', { effort: 'xhigh' })
  expect(enviados.at(-1)?.effort).toBe('xhigh')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'depois-do-seletor' } as any)
  const preparada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(preparada.base).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
})

test('seletor de esforço no meio do turno com modelo refletido da rota volta ao modelo do seletor', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'low' })
  expect(enviados.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'low', agentId: undefined, sessao: 'somente-eu' })
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'low' })
  expect(enviados.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'low', agentId: undefined, sessao: 'somente-eu' })
  const suspensa = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(suspensa.ativa).toBeUndefined()
  expect(suspensa.bloqueada).toBeUndefined()
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'depois-do-reflexo' } as any)
  const preparada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(preparada.base).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
})

for (const [nome, extra] of [['com esforço novo', { model: 'claude-haiku-5-5', effort: 'xhigh' }], ['com esforço da base', { model: 'claude-haiku-5-5', effort: 'high' }],
  ['refletido com esforço da base', { model: 'claude-sonnet-5-5', effort: 'high' }]] as const) {
  test(`modelo diferente sem evento explícito continua bloqueando (${nome})`, async ($, on) => {
    const { enviados, passo } = await preparar($, on)
    await $.tool.call({ tool: TOOL, ...pedido } as any)
    await $.turn.start({ text: 'nova fatia', turnId: 't2' })
    const antes = enviados.length
    await passo('t2', extra)
    expect(enviados.length).toBe(antes)
    const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
    expect(consulta.bloqueada).toBe(true)
    expect(consulta.ativa.fatia).toBe(pedido.fatia)
  })
}

test('continuações refletidas após a suspensão preservam a base do seletor até a próxima rota', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'low' })
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'low' })
  await $.turn.start({ text: '', turnId: 'continua-t2' })
  await passo('continua-t2', { model: 'claude-sonnet-5-5', effort: 'low' })
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'depois-das-continuacoes', nivel: 'N1', familia: 'haiku' } as any)
  const preparada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(preparada.base).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
  await $.turn.start({ text: 'fatia haiku', turnId: 't3' })
  await passo('t3', { effort: 'low' })
  expect(enviados.at(-1)).toEqual({ model: 'haiku', effort: 'low', agentId: undefined, sessao: 'somente-eu' })
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').bloqueada).toBeUndefined()
})

test('troca de modelo depois da suspensão por esforço volta a usar o modelo do passo como base', async ($, on) => {
  const { passo, troca } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2', { effort: 'xhigh' })
  await troca('picker', 'claude-sonnet-5-5')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'xhigh' })
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'depois-do-picker', nivel: 'N1', familia: 'haiku' } as any)
  const preparada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(preparada.base).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
})

test('suspensão pelo seletor mantém o preparo da próxima fatia com a seleção nova como base', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  await passo('t2')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  await passo('t2', { effort: 'xhigh' })
  const suspensa = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(suspensa.ativa).toBeUndefined()
  expect(suspensa.pendente.fatia).toBe('fatia-b')
  expect(suspensa.base).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  await passo('t3', { effort: 'xhigh' })
  expect(enviados.at(-1)).toEqual({ model: 'haiku', effort: 'low', agentId: undefined, sessao: 'somente-eu' })
  const ativa = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(ativa.ativa.fatia).toBe('fatia-b')
  expect(ativa.bloqueada).toBeUndefined()
})

test('segunda troca de esforço na mesma mensagem atualiza a base do preparo pendente', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  await passo('t2')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  await passo('t2', { effort: 'xhigh' })
  await passo('t2', { effort: 'high' })
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').base).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  await passo('t3', { effort: 'high' })
  expect(enviados.at(-1)).toEqual({ model: 'haiku', effort: 'low', agentId: undefined, sessao: 'somente-eu' })
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').ativa.fatia).toBe('fatia-b')
})

test('troca de esforço depois de preparar num turno sem rota não suspende a fatia preparada', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await passo('t1', { effort: 'xhigh' })
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').base).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2', { effort: 'xhigh' })
  expect(enviados.at(-1)).toEqual({ model: 'sonnet', effort: 'medium', agentId: undefined, sessao: 'somente-eu' })
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').ativa.fatia).toBe(pedido.fatia)
})

test('passo refletido sem esforço não conta como seletor e continua bloqueando', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2')
  const antes = enviados.length
  await passo('t2', { model: 'claude-sonnet-5-5', effort: undefined })
  expect(enviados.length).toBe(antes)
  expect(JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}').bloqueada).toBe(true)
})

test('troca só de esforço depois de bloqueio ou sinal auto não solta a rota', async ($, on) => {
  const { enviados, passo, troca } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await troca('auto', 'claude-sonnet-5-5')
  const antes = enviados.length
  await passo('t2', { effort: 'xhigh' })
  await passo('t2', { effort: 'low' })
  expect(enviados.length).toBe(antes)
  const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(consulta.bloqueada).toBe(true)
  expect(consulta.ativa.fatia).toBe(pedido.fatia)
})

test('seletor de esforço com store indisponível suspende na memória e envia o passo', async () => {
  const r = await simularRota('falha-seletor')
  await r.chamar(pedido)
  await r.turno('t2')
  r.disco.antesDeGravar = async () => { throw new Error('store indisponível') }
  let enviado: any
  await r.passo('t2', { effort: 'xhigh' }, async () => { enviado = true; return { usage: null } })
  expect(enviado).toBe(true)
  const estado = await r.estado()
  expect(estado.ativa).toBeUndefined()
  expect(estado.bloqueada).toBeUndefined()
})

test('fallback automático não vira escolha explícita nem envia requisição abaixo da capacidade', async ($, on) => {
  const { enviados, passo, troca } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido, nivel: 'N3', familia: 'fable', papel: 'revisao', risco: 'L1' } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await troca('auto', 'claude-sonnet-5-5')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'medium' })
  await passo('t2') // também não repete a família original sem nova tentativa
  expect(enviados.length).toBe(1)
  const consulta = await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)
  expect(consulta.text).toMatch('Roteamento pendente')
  expect(JSON.parse(consulta.text ?? '{}').bloqueada).toBe(true)
  await $.turn.start({ text: 'nova tentativa: reclassificar', turnId: 't3' })
  await passo('t3')
  expect(enviados.length).toBe(2)
  expect(enviados.at(-1)?.model).toBe('claude-opus-5-5')
  const retomada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(retomada.ativa).toBeUndefined()
  expect(retomada.bloqueada).toBeUndefined()
})

test('override refletido na entrada seguinte mantém a rota', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(enviados.slice(-2).every(e => e.model === 'sonnet' && e.effort === 'medium')).toBe(true)
})

test('rota dura um turno e continuações vazias; mensagem nova volta ao engine', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  await passo('t2')
  await $.turn.start({ text: '', turnId: 'continua-t2' })
  await passo('continua-t2')
  expect(enviados.slice(-2).every(e => e.model === 'sonnet' && e.effort === 'medium')).toBe(true)
  await $.turn.start({ text: 'outro pedido', turnId: 't3' })
  await passo('t3')
  expect(enviados.at(-1)?.model).toBe('claude-opus-5-5')
  const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(consulta.ativa).toBeUndefined()
  expect(consulta.enviado).toBeUndefined()
})

test('duas rotas consecutivas preservam a seleção original após passo refletido', async ($, on) => {
  const { enviados, passo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  await passo('t2')
  await passo('t2', { model: 'claude-sonnet-5-5', effort: 'medium' })
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  const preparada = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(preparada.base).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  await passo('t3')
  expect(enviados.at(-1)?.model).toBe('haiku')
  expect(enviados.at(-1)?.effort).toBe('low')
  const ativa = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(ativa.bloqueada).toBeUndefined()
  expect(ativa.ativa.fatia).toBe('fatia-b')
})

test('primeiro passo de B aceita reflexo confirmado de A uma única vez', async ($, on) => {
  const { enviados, passo, responderComo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  responderComo('claude-sonnet-5-5')
  await passo('t2')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  responderComo('claude-haiku-5-5')
  await passo('t3', { model: 'claude-sonnet-5-5', effort: 'medium', index: 0 })
  expect(enviados.at(-1)?.model).toBe('haiku')
  expect(enviados.at(-1)?.effort).toBe('low')
  const antes = enviados.length
  await passo('t3', { model: 'claude-sonnet-5-5', effort: 'medium', index: 1 })
  expect(enviados.length).toBe(antes)
  const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(consulta.bloqueada).toBe(true)
})

test('sinal auto impede aceitar até o reflexo exato da rota confirmada', async ($, on) => {
  const { enviados, passo, responderComo, troca } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  responderComo('claude-sonnet-5-5')
  await passo('t2')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  await troca('auto', 'claude-sonnet-5-5')
  const antes = enviados.length
  await passo('t3', { model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(enviados.length).toBe(antes)
})

for (const [nome, modelo] of [['ausente', undefined], ['divergente', 'claude-haiku-5-5']] as const) {
  test(`resposta ${nome} de A não autoriza transição refletida para B`, async ($, on) => {
    const { enviados, passo, responderComo } = await preparar($, on)
    await $.tool.call({ tool: TOOL, ...pedido } as any)
    await $.turn.start({ text: 'fatia a', turnId: 't2' })
    responderComo(modelo)
    await passo('t2')
    await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
    await $.turn.start({ text: 'fatia b', turnId: 't3' })
    const antes = enviados.length
    await passo('t3', { model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(enviados.length).toBe(antes)
  })
}

test('reserva por fatia sobrevive A→B→A, mensagem nova, escolha manual e recarga', async ($, on) => {
  const { passo, troca, reiniciar } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'fatia a', turnId: 't2' })
  await passo('t2')
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N3', familia: 'opus' } as any)
  await $.turn.start({ text: 'fatia b', turnId: 't3' })
  await passo('t3')
  await troca('picker', 'claude-fable-5-1')
  await reiniciar()
  await $.turn.start({ text: 'revisitar a', turnId: 't4' })
  await passo('t4', { model: 'claude-fable-5-1', effort: 'xhigh' })
  const recusada = await $.tool.call({ tool: TOOL, ...pedido, escalado: true } as any)
  expect(recusada.deny).toMatch('fixos')
  const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(consulta.reservas['nova-1'].esforco).toBe('medium')
  expect(consulta.reservas['fatia-b'].familia).toBe('opus')
})

test('dois IDs de sessão intercalados conservam rotas, bases e consultas próprias', async ($, on) => {
  const { enviados, passo, mudarSessao } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  mudarSessao('outra')
  await $.turn.start({ text: 'planejar b', turnId: 't1' })
  await passo('t1', { model: 'claude-fable-5-1', effort: 'xhigh' })
  await $.tool.call({ tool: TOOL, ...pedido, fatia: 'fatia-b', nivel: 'N1', familia: 'haiku' } as any)
  mudarSessao('somente-eu')
  await $.turn.start({ text: 'nova a', turnId: 't2' })
  await passo('t2')
  const a = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(a.ativa.familia).toBe('sonnet')
  mudarSessao('outra')
  await $.turn.start({ text: 'nova b', turnId: 't2' })
  await passo('t2', { model: 'claude-fable-5-1', effort: 'xhigh' })
  const b = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(b.ativa.familia).toBe('haiku')
  expect(enviados.slice(-2).map(e => [e.sessao, e.model, e.effort])).toEqual([
    ['somente-eu', 'sonnet', 'medium'], ['outra', 'haiku', 'low'],
  ])
})

test('seleção manual durante resposta não é sobrescrita pela observação atrasada', async ($, on) => {
  const { enviados, passo, troca, reterProximo } = await preparar($, on)
  await $.tool.call({ tool: TOOL, ...pedido } as any)
  await $.turn.start({ text: 'nova fatia', turnId: 't2' })
  const porta = reterProximo()
  const emCurso = passo('t2')
  await porta.entrada
  await troca('picker', 'claude-fable-5-1')
  porta.liberar()
  await emCurso
  const consulta = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(consulta.ativa).toBeUndefined()
  expect(consulta.aviso).toMatch('seleção explícita')
  await $.turn.start({ text: 'seguir', turnId: 't3' })
  await passo('t3', { model: 'claude-fable-5-1', effort: 'xhigh' })
  expect(enviados.at(-1)?.model).toBe('claude-fable-5-1')
})

for (const [risco, escalado, esforco] of [['L1', false, 'high'], ['L2', false, 'xhigh'], ['L1', true, 'xhigh']] as const) {
  test(`revisão Fable ${risco} escalado=${escalado} envia ${esforco} ao turn.step`, async ($, on) => {
    const { enviados, passo } = await preparar($, on)
    const resposta = await $.tool.call({ tool: TOOL, ...pedido, nivel: 'N3', familia: 'fable', papel: 'revisao', risco, escalado } as any)
    expect(resposta.deny).toBeUndefined()
    expect(JSON.parse(resposta.text ?? '{}').pedido.esforco).toBe(esforco)
    await $.turn.start({ text: 'revisar nova fatia', turnId: 't2' })
    await passo('t2')
    expect(enviados.at(-1)?.model).toBe('fable')
    expect(enviados.at(-1)?.effort).toBe(esforco)
    const estado = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
    expect(estado.enviado.effort).toBe(esforco)
  })
}


test('política com esforço de revisão incompatível com Claude é recusada antes de persistir preparo', async ($, on) => {
  await preparar($, on, { ...politica, revisao: { ...politica.revisao, L2: 'ultra' } })
  const resposta = await $.tool.call({ tool: TOOL, ...pedido, nivel: 'N3', familia: 'fable', papel: 'revisao', risco: 'L2' } as any)
  expect(resposta.deny).toMatch('roteamento recusado')
  const estado = JSON.parse((await $.tool.call({ tool: TOOL, acao: 'consultar' } as any)).text ?? '{}')
  expect(estado.pendente).toBeUndefined()
  expect(estado.reservas).toBeUndefined()
})

test('estado antigo com esforço inválido bloqueia sem enviar requisição Claude', async () => {
  const r = await simularRota('esforco-antigo-invalido', false)
  r.disco.estado = { ativa: { ...pedido, esforco: 'ultra', versao: 2 }, base: { model: 'claude-opus-5-5', effort: 'high' } }
  await iniciarRota(r.$)
  let enviados = 0
  await r.passo('antigo', {}, async () => { enviados++; return { usage: null } })
  expect(enviados).toBe(0)
  expect((await r.estado()).bloqueada).toBe(true)
  expect((await r.estado()).aviso).toMatch('esforço da rota inválido para Claude Code')
})
