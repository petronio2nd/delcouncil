import test from 'node:test'
import assert from 'node:assert/strict'
import { aplicarRotaNova, modeloDaRota } from './rota.ts'
import { escolherRota, lerPolitica, type Rota } from '../orquestra/hooks/roteamento.ts'

const rota: Rota = { fatia: 'teste', nivel: 'N2', familia: 'terra', esforco: 'medium', motivo: 'teste isolado', papel: 'execucao', versao: 2 }
const modelo = { providerID: 'openai', id: 'gpt-6.1-terra', variant: 'medium' }
const agy = (id: string, extra = {}) => ({ providerID: 'google', id: `antigravity-${id}`, enabled: true, variants: [], time: { released: 0 }, ...extra })
const semNativo = () => { throw new Error('não pode buscar outro canal') }

test('Antigravity usa esforço exato no ID de Sonnet, Opus e Flash e o ID sem sufixo do Flash-Lite, sem variant', () => {
  for (const [familia, nivel, esforco, id] of [
    ['sonnet', 'N2', 'medium', 'claude-sonnet-5-5-medium'],
    ['opus', 'N3', 'high', 'claude-opus-5-5-high'],
    ['flash', 'N2', 'low', 'gemini-3.8-flash-low'],
    ['flash-lite', 'N1', 'low', 'gemini-3.8-flash-lite'],
  ] as const) {
    const resultado = modeloDaRota({ ...rota, familia, nivel, esforco, canal: 'antigravity' }, [agy(id)], semNativo)
    assert.deepEqual(resultado, { providerID: 'google', id: `antigravity-${id}` })
    assert.equal(Object.hasOwn(resultado, 'variant'), false)
  }
})

test('Argon revisão L2 usa o piso de revisão da política (sem High fixo) e resolve o ID Antigravity', () => {
  const p = lerPolitica(JSON.stringify({ versao: 2, capacidades: {
    N1: { esforco: 'low', escalado: 'medium', familias: ['flash-lite'] },
    N2: { esforco: 'low', escalado: 'medium', familias: ['sonnet'] },
    N3: { esforco: 'medium', escalado: 'high', familias: ['opus'] },
  }, revisao: { capacidade: 'N3', familias: ['astra', 'fable', 'argon'], L1: 'low', L2: 'medium' }, limites: { astraExecutor: false } }))
  const revisao = escolherRota(p, { ...rota, nivel: 'N3', familia: 'argon', papel: 'revisao', risco: 'L2', canal: 'antigravity' })
  assert.equal(revisao.esforco, 'medium')
  assert.deepEqual(modeloDaRota(revisao, [agy('gemini-4-argon-high'), agy('gemini-4-argon-medium')], semNativo), { providerID: 'google', id: 'antigravity-gemini-4-argon-medium' })
})

test('seleção numérica da versão considera só família, canal e esforço suficiente habilitados', () => {
  const modelos = [agy('claude-sonnet-5-9-medium'), agy('claude-sonnet-5-10-medium'),
    agy('claude-sonnet-5-9-high'), agy('claude-sonnet-6-0-medium', { enabled: false }),
    agy('claude-opus-8-0-medium'), agy('claude-sonnet-9-0-medium', { providerID: 'anthropic' }),
    agy('gemini-9-flash-medium'), agy('claude-sonnet-5-8-medium', { time: { released: 100 } })]
  assert.equal(modeloDaRota({ ...rota, familia: 'sonnet', canal: 'antigravity' }, modelos, semNativo).id, 'antigravity-claude-sonnet-5-10-medium')
  assert.equal(modeloDaRota({ ...rota, familia: 'flash', canal: 'antigravity' }, [agy('gemini-3.9-flash-medium'), agy('gemini-3.10-flash-medium')], semNativo).id, 'antigravity-gemini-3.10-flash-medium')
})

test('Antigravity não reduz xhigh, não confunde Flash-Lite com Flash, não classifica GPT-OSS e recusa canal desconhecido', () => {
  const modelos = [agy('claude-opus-5-5-high'), agy('gemini-3.5-flash-lite'), agy('gpt-oss-120b-medium')]
  assert.throws(() => modeloDaRota({ ...rota, familia: 'opus', esforco: 'xhigh', canal: 'antigravity' }, modelos, semNativo), /sem reduzir esforço nem trocar canal/)
  for (const familia of ['flash', 'sol', 'desconhecida']) {
    assert.throws(() => modeloDaRota({ ...rota, familia, canal: 'antigravity' }, modelos, semNativo), /indisponível/)
  }
  assert.throws(() => modeloDaRota({ ...rota, canal: 'google' as any }, modelos, semNativo), /canal inválido/)
})

test('variante ausente e modelo indisponível recusam sem baixar capacidade/esforço', () => {
  assert.throws(() => modeloDaRota(rota, [], () => modelo), /indisponível/)
  assert.throws(() => modeloDaRota(rota, [{ ...modelo, variants: [{ id: 'low' }] }], () => modelo), /não foi reduzido/)
  assert.deepEqual(modeloDaRota(rota, [{ ...modelo, variants: [{ id: 'medium' }] }], () => modelo), modelo)
})

test('aplica apenas id recém-criado e confere modelo/variante antes de prompt', async () => {
  const chamadas: unknown[] = []
  const api = {
    switchModel: async (args: unknown) => { chamadas.push(args) },
    get: async ({ sessionID }: { sessionID: string }) => { chamadas.push(sessionID); return { model: modelo } },
  }
  assert.deepEqual(await aplicarRotaNova('nova-do-teste', modelo, api), modelo)
  assert.deepEqual(chamadas, [{ sessionID: 'nova-do-teste', model: modelo }, 'nova-do-teste'])
  await assert.rejects(aplicarRotaNova('nova-do-teste', modelo, { ...api, get: async () => ({ model: { ...modelo, variant: 'low' } }) }), /primeiro prompt não foi enviado/)
})

test('confirmação Antigravity exige provider/ID exatos e nenhuma variante inesperada', async () => {
  const pedido = { providerID: 'google', id: 'antigravity-claude-sonnet-5-5-medium' }
  const api = { switchModel: async () => {}, get: async () => ({ model: pedido }) }
  assert.deepEqual(await aplicarRotaNova('nova', pedido, api), pedido)
  for (const divergente of [{ ...pedido, id: 'antigravity-claude-sonnet-5-5-low' }, { ...pedido, providerID: 'anthropic' }, { ...pedido, variant: 'high' }]) {
    await assert.rejects(aplicarRotaNova('nova', pedido, { ...api, get: async () => ({ model: divergente }) }), /primeiro prompt não foi enviado/)
  }
})


test('Antigravity escolhe a versão mais nova e nela o menor esforço que atende ao piso, como a dupla', () => {
  const pedido = { ...rota, familia: 'sonnet', canal: 'antigravity' as const }
  // Duas versões, dois esforços cada: a 5-5 tem o esforço exato, a 6-0 só esforços acima do piso.
  const modelos = [agy('claude-sonnet-5-5-medium'), agy('claude-sonnet-5-5-high'), agy('claude-sonnet-6-0-xhigh'), agy('claude-sonnet-6-0-high')]
  assert.equal(modeloDaRota(pedido, modelos, semNativo).id, 'antigravity-claude-sonnet-6-0-high')
  assert.equal(modeloDaRota(pedido, [...modelos, agy('claude-sonnet-6-0-medium')], semNativo).id, 'antigravity-claude-sonnet-6-0-medium')
  // Versão mais nova sem esforço suficiente recusa, como a dupla; não volta para uma versão anterior.
  assert.throws(() => modeloDaRota({ ...pedido, esforco: 'xhigh' }, [agy('claude-sonnet-6-0-high'), agy('claude-sonnet-5-5-xhigh')], semNativo), /versão mais nova \(6\.0\); preserve N2, sem reduzir esforço/)
  // Versão desabilitada não conta como a mais nova.
  assert.equal(modeloDaRota(pedido, [agy('claude-sonnet-6-0-xhigh', { enabled: false }), agy('claude-sonnet-5-5-high')], semNativo).id, 'antigravity-claude-sonnet-5-5-high')
})

test('Antigravity não promove para max nem aceita família, provedor ou gramática diferentes', () => {
  const pedido = { ...rota, familia: 'sonnet', canal: 'antigravity' as const }
  const invalidos = [agy('claude-sonnet-5-5-low'), agy('claude-sonnet-5-5-max'),
    agy('claude-opus-5-5-high'), agy('claude-sonnet-5-5-high', { providerID: 'anthropic' }),
    agy('claude-sonnet-5-5-high', { enabled: false }), agy('claude-sonnet-5-5-thinking-high')]
  assert.throws(() => modeloDaRota(pedido, invalidos, semNativo), /sem reduzir esforço nem trocar canal/)
})

// Política v2: Astra, Fable e Argon só revisam (mesmo piso L1/L2 para os três); Terra é N2 e Sol é N3.
const politicaAtual = { versao: 2, capacidades: {
  N1: { esforco: 'low', escalado: 'medium', familias: ['haiku', 'luna', 'flash-lite'] },
  N2: { esforco: 'low', escalado: 'medium', familias: ['sonnet', 'terra', 'flash'] },
  N3: { esforco: 'medium', escalado: 'high', familias: ['opus', 'sol'] },
}, revisao: { capacidade: 'N3', familias: ['astra', 'fable', 'argon'], L1: 'low', L2: 'medium' },
  limites: { astraExecutor: false, gptExtra: false, rodadasCruzadasPorFatia: 2 } }

test('revisão usa o mesmo piso L1/L2 para Astra, Fable e Argon; revisor não executa', () => {
  const p = lerPolitica(JSON.stringify(politicaAtual))
  const revisao = (familia: string, risco: string, escalado = false) =>
    escolherRota(p, { ...rota, nivel: 'N3', familia, papel: 'revisao', risco, escalado }).esforco
  for (const familia of ['fable', 'astra', 'argon']) {
    assert.equal(revisao(familia, 'L1'), 'low')
    assert.equal(revisao(familia, 'L2'), 'medium')
    assert.equal(revisao(familia, 'L1', true), 'medium')
    assert.throws(() => escolherRota(p, { ...rota, nivel: 'N3', familia, papel: 'execucao' }), /reservado à revisão/)
    assert.throws(() => escolherRota(p, { ...rota, nivel: 'N3', familia, papel: 'orquestracao' }), /reservado à revisão/)
  }
  // Opus executa, mas não está na lista de revisores.
  assert.throws(() => revisao('opus', 'L1'), /não revisa/)
  assert.equal(escolherRota(p, { ...rota, familia: 'terra' }).esforco, 'low')
  assert.equal(escolherRota(p, { ...rota, nivel: 'N3', familia: 'sol' }).esforco, 'medium')
  assert.throws(() => escolherRota(p, { ...rota, nivel: 'N2', familia: 'sol' }), /não atende N2/)
})

test('JSON externo exige versão 2 e revisão com famílias e esforços L1/L2 válidos', () => {
  const ler = (alteracao: Record<string, unknown>) => lerPolitica(JSON.stringify({ ...politicaAtual, ...alteracao }))
  const lerRevisao = (revisao: unknown) => ler({ revisao })
  assert.throws(() => ler({ versao: 1 }), /política inválida/)
  assert.throws(() => lerRevisao({ ...politicaAtual.revisao, familias: [] }), /revisão exige famílias e esforços/)
  assert.throws(() => lerRevisao({ capacidade: 'N3', L1: 'low', L2: 'medium' }), /revisão exige famílias e esforços/)
  assert.throws(() => lerRevisao({ ...politicaAtual.revisao, L1: 'ultra' }), /revisão exige famílias e esforços/)
  assert.throws(() => lerRevisao({ ...politicaAtual.revisao, L2: undefined }), /revisão exige famílias e esforços/)
  assert.deepEqual(lerRevisao(politicaAtual.revisao).revisao.familias, ['astra', 'fable', 'argon'])
})

test('Flash-Lite Antigravity vem sem sufixo, só atende piso low e não se confunde com Flash', () => {
  const lite = agy('gemini-3.8-flash-lite')
  const baixo = { ...rota, nivel: 'N1', familia: 'flash-lite', esforco: 'low', canal: 'antigravity' as const }
  assert.deepEqual(modeloDaRota(baixo, [lite, agy('gemini-3.8-flash-low')], semNativo), { providerID: 'google', id: lite.id })
  assert.throws(() => modeloDaRota({ ...baixo, esforco: 'medium' }, [lite], semNativo), /sem reduzir esforço nem trocar canal/)
  assert.throws(() => modeloDaRota({ ...baixo, familia: 'flash', nivel: 'N2' }, [lite], semNativo), /indisponível/)
})

test('Fable de revisão resolve o menor esforço que atende ao piso e não reduz', async () => {
  const p = lerPolitica(JSON.stringify(politicaAtual))
  const revisao = escolherRota(p, { ...rota, nivel: 'N3', familia: 'fable', papel: 'revisao', risco: 'L2', canal: 'antigravity' })
  assert.equal(revisao.esforco, 'medium')
  const medium = agy('claude-fable-5-1-medium')
  const high = agy('claude-fable-5-1-high')
  const selecionado = modeloDaRota(revisao, [high, medium], semNativo)
  assert.deepEqual(selecionado, { providerID: 'google', id: medium.id })
  assert.throws(() => modeloDaRota(revisao, [agy('claude-fable-5-1-low'), { ...medium, enabled: false }], semNativo), /sem reduzir esforço nem trocar canal/)
  assert.throws(() => modeloDaRota({ ...revisao, familia: 'argon' }, [agy('gemini-4-argon-low')], semNativo), /indisponível/)
  await assert.rejects(aplicarRotaNova('nova-medium', selecionado, {
    switchModel: async () => {}, get: async () => ({ model: { providerID: 'google', id: high.id } }),
  }), /primeiro prompt não foi enviado/)
})

test('Astra de revisão usa a variante nativa do piso da política', () => {
  const p = lerPolitica(JSON.stringify(politicaAtual))
  const astra = escolherRota(p, { ...rota, nivel: 'N3', familia: 'astra', papel: 'revisao', risco: 'L2' })
  const modelo = { providerID: 'openai', id: 'gpt-6-astra', variants: [{ id: 'low' }, { id: 'medium' }] }
  assert.equal(astra.esforco, 'medium')
  assert.equal(modeloDaRota(astra, [modelo], () => modelo).variant, 'medium')
})
