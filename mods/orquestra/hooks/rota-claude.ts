import type { EngineInterface, Register } from 'claude-code'
import { impedimento, invalidas } from './fontes'
import { lerFontesClaude } from './fontes-claude'
import { conferirFatia, escolherRota, esforcoClaudeValido, ESQUEMA_ROTA, FAMILIAS_CLAUDE, lerPolitica, NOTA_ROTEAMENTO, observarModeloClaude, reservarFatia, type Rota } from './roteamento'

const TOOL = 'mcp__orquestra__rotear_tarefa'
type Escolha = { model: string; effort?: string | number }
type Estado = { pendente?: Rota; ativa?: Rota; base?: Escolha; aviso?: string; enviado?: Escolha; aplicado?: { model: string }; observado?: string; bloqueada?: boolean; automatica?: boolean; reservas?: Record<string, Rota> }
type Transicao = { turno: string; modelos: string[]; esforco: string | number }
type Suspensao = { turno: string; base: string; rota: Rota }
type Memoria = { chave: string; naoSincronizada?: boolean; turnoMensagem?: string; turnoFalho?: string; estado: Estado; ultima?: Escolha; turnoAtual?: string; turnoPreparado?: string; transicao?: Transicao; suspensaoEsforco?: Suspensao; gravacao?: Promise<void> }
const sessoes = new Map<string, Promise<Memoria>>()
const LIMITE_RESERVAS_NA_CONSULTA = 8
const ESQUEMA_FERRAMENTA = { ...ESQUEMA_ROTA, properties: { ...ESQUEMA_ROTA.properties,
  acao: { type: 'string', enum: ['consultar', 'preparar'], description: 'consultar lê o estado atual e resume históricos grandes. Informe fatia para consultar uma reserva específica. preparar é o padrão' },
}, required: [] }

function consultar(estado: Estado, fatia: unknown) {
  const { reservas, ...atual } = estado
  const ids = Object.keys(reservas ?? {})
  const totalReservas = ids.length
  if (fatia !== undefined) {
    if (typeof fatia !== 'string' || !fatia.trim()) throw new Error('informe um identificador de fatia válido')
    const id = fatia.trim()
    return { ...atual, totalReservas, reserva: reservas && Object.hasOwn(reservas, id) ? reservas[id] : null }
  }
  if (totalReservas <= LIMITE_RESERVAS_NA_CONSULTA) return estado
  return { ...atual, totalReservas, amostraFatias: ids.slice(-LIMITE_RESERVAS_NA_CONSULTA), notaReservas: 'Para consultar uma reserva, informe acao=consultar e fatia.' }
}

async function carregar($: EngineInterface, chave: string): Promise<Estado> { return (await $.store.get(chave) as Estado | undefined) ?? {} }
// Cada seção termina antes de next/stream/yield; uma falha não prende a fila.
function critico<T>(m: Memoria, acao: () => Promise<T>): Promise<T> {
  const tarefa = (m.gravacao ?? Promise.resolve()).then(acao)
  m.gravacao = tarefa.then(() => {}, () => {})
  return tarefa
}
async function publicar($: EngineInterface, m: Memoria, estado: Estado, marcadores: Partial<Memoria> = {}) {
  await $.store.set(m.chave, estado)
  Object.assign(m, { estado, naoSincronizada: false }, marcadores)
}
// Notificações refletem fatos já ocorridos no engine, mesmo sem store disponível.
async function notificar($: EngineInterface, m: Memoria, estado: Estado, marcadores: Partial<Memoria> = {}) {
  Object.assign(m, { estado, naoSincronizada: true }, marcadores)
  await $.store.set(m.chave, estado)
  m.naoSincronizada = false
}
async function memoria($: EngineInterface, reiniciar = false): Promise<Memoria> {
  const id = await $.session.id()
  let pronta = sessoes.get(id)
  if (!pronta) {
    const chave = `rota:${id}`
    pronta = carregar($, chave).then(estado => ({ estado, chave }))
    sessoes.set(id, pronta)
    try { return await pronta } catch (erro) { sessoes.delete(id); throw erro }
  }
  const m = await pronta
  if (reiniciar) await critico(m, async () => {
    if (m.naoSincronizada || m.turnoFalho) {
      // No mesmo processo, o disco pode conter uma rota já revogada na memória.
      m.ultima = undefined
      m.transicao = undefined
      m.suspensaoEsforco = undefined
      if (m.naoSincronizada) {
        try { await $.store.set(m.chave, m.estado); m.naoSincronizada = false } catch { /* preserva estado e guardas locais */ }
      }
      return
    }
    const estado = await carregar($, m.chave)
    Object.assign(m, { estado, ultima: undefined, turnoAtual: undefined, turnoMensagem: undefined, turnoFalho: undefined, turnoPreparado: undefined, transicao: undefined, suspensaoEsforco: undefined })
  })
  return m
}
async function politica($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  const path = await $.env.get('ORQUESTRA_POLITICA')
  if (path) return lerPolitica(await $.fs.read(path))
  const texto = await $.fs.read(`${home}/.agents/skills/orquestrador/politica-modelos.json`)
    .catch(() => $.fs.read(`${home}/.claude/skills/orquestrador/politica-modelos.json`))
  return lerPolitica(texto)
}

export async function iniciarRota($: EngineInterface) {
  await memoria($, true)
  await $.tool.register({ name: 'rotear_tarefa', description: 'acao=consultar lê o estado real da própria sessão, sem snapshot nem mudança. preparar valida N1/N2/N3 e prepara a PRÓXIMA fatia/turno; não muda este turno nem outras sessões. Preserve modelo explícito do usuário. Para executar a tarefa atual, despache pela dupla ou por subagente permitido com modelo/esforço da rota; não espere outro turno do usuário.', inputSchema: ESQUEMA_FERRAMENTA })
}

export const registrarRota: Register = on => {

  on('session.compact', async ($, e, next) => {
    let trava: string | undefined
    try { trava = impedimento(await lerFontesClaude($), 'claude-max') }
    catch { trava = invalidas().motivo }
    return trava ? { skip: trava } : next(e)
  })

  on('model.complete', async ($, e, next) => {
    let trava: string | undefined
    try { trava = impedimento(await lerFontesClaude($), 'claude-max') }
    catch { trava = invalidas().motivo }
    if (!trava) return next(e)
    // Falha de apresentação nunca autoriza inferência; não fabrica resposta de modelo.
    try { $.ui.log(trava) } catch { /* preserva a recusa */ }
    return { isAnswered: false as const, reason: 'aborted' as const,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'rotear_tarefa da sessão principal não altera subagentes; despache com modelo/esforço explícitos' }
    try {
      const m = await memoria($)
      const input = e as unknown as Record<string, unknown>
      if (input.acao === 'consultar') {
        const estado = m.turnoFalho ? { ...m.estado, turnoFalho: m.turnoFalho, aviso: 'A transição deste turno não foi gravada; roteamento suspenso até nova mensagem ou escolha manual.' } : m.estado
        const text = JSON.stringify(consultar(estado, input.fatia))
        return { result: text, text, isReadOnly: true }
      }
      if (input.acao !== undefined && input.acao !== 'preparar') throw new Error('ação inválida')
      const turnoPedido = m.turnoMensagem
      return await critico(m, async () => {
        if (m.turnoFalho) throw new Error('falha de gravação na transição do turno; roteamento suspenso até nova mensagem ou escolha manual')
        if (m.turnoMensagem !== turnoPedido) throw new Error('turno mudou durante o preparo; prepare novamente')
        const rota = escolherRota(await politica($), input)
        if (rota.canal === 'antigravity') throw new Error('canal antigravity exige despacho no OpenCode; Claude Code não aplica esse canal na sessão principal')
        if (!FAMILIAS_CLAUDE.includes(rota.familia)) throw new Error('Claude Code só roteia famílias Claude; use o executor da skill para outras famílias')
        if (!esforcoClaudeValido(rota.esforco)) throw new Error('esforço inválido para Claude Code; preserve a política e use outro harness compatível')
        conferirFatia(m.estado.ativa, rota)
        conferirFatia(m.estado.pendente, rota)
        if (!m.ultima) throw new Error('seleção deste turno ainda não observada; não é seguro preparar uma troca')
        // Em um passo que reflete o override, m.ultima não representa o seletor original.
        const base = m.estado.ativa && m.estado.base ? m.estado.base : m.ultima
        const reservas = reservarFatia(m.estado.reservas, rota)
        const estado = { ...m.estado, reservas, pendente: rota, base, aviso: 'pendente: próximo turno principal; execute a fatia atual por despacho autorizado, sem esperar outro turno do usuário' }
        // Monte a resposta MCP válida antes de publicar ou persistir a preparação.
        const text = JSON.stringify({ pedido: rota, estado: 'pendente', aplicado: null, rotaAtual: estado.ativa ?? null, nota: estado.aviso })
        await publicar($, m, estado, { turnoPreparado: m.turnoAtual })
        return { result: text, text }
      })
    } catch (erro) { return { deny: `roteamento recusado: ${erro instanceof Error ? erro.message : String(erro)}` } }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const m = await memoria($)
    await critico(m, async () => {
      if (m.turnoAtual !== e.turnId && e.text.trim()) {
        const anterior = m.estado
        // Só o próprio turno que falhou pode repetir a ativação. Uma mensagem posterior expira a tentativa.
        const repetir = !m.turnoFalho || m.turnoFalho === e.turnId
        const pendente = repetir && e.turnId !== m.turnoPreparado ? anterior.pendente : undefined
        // Só uma resposta confirmada de A autoriza seu reflexo no primeiro passo de B.
        const transicao = pendente && anterior.ativa && !anterior.bloqueada && !anterior.automatica && anterior.aplicado && anterior.enviado?.effort !== undefined
          ? { turno: e.turnId, modelos: [anterior.enviado.model, anterior.aplicado.model], esforco: anterior.enviado.effort }
          : undefined
        const estado = pendente
          ? { reservas: anterior.reservas, ativa: pendente, base: anterior.base, aviso: 'selecionada para este turno e continuações sem texto; aguardando primeira requisição' }
          : { reservas: anterior.reservas, aviso: 'nova mensagem: rota anterior encerrada; reclassifique e despache conforme a política' }
        const marcadores = { transicao, turnoAtual: e.turnId, turnoMensagem: e.turnId, turnoFalho: undefined, turnoPreparado: undefined }
        try {
          await publicar($, m, estado, marcadores)
        } catch (erro) {
          m.naoSincronizada = true
          if (!pendente) {
            // Sem rota a aplicar, a falha de um registro informativo não impede a mensagem.
            Object.assign(m, { estado }, marcadores)
            return
          }
          m.turnoFalho = e.turnId
          m.transicao = undefined
          throw erro
        }
      } else m.turnoAtual = e.turnId
    })
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const resultado = await next(e)
    // `auto` inclui fallback; `sdk` pode vir de automação; `resume` só restaura.
    if (['command', 'picker', 'auto'].includes(e.source)) {
      const m = await memoria($)
      await critico(m, async () => {
        const estado = e.source === 'auto'
          ? { ...m.estado, automatica: true }
          : { reservas: m.estado.reservas, aviso: 'suspensa: seleção explícita no app preservada' }
        // O modelo do seletor mudou: a base guardada na suspensão por esforço deixa de valer.
        await notificar($, m, estado, e.source === 'auto' ? { transicao: undefined, suspensaoEsforco: undefined } : { suspensaoEsforco: undefined,
          transicao: undefined, turnoAtual: m.turnoFalho ?? m.turnoAtual, turnoMensagem: m.turnoFalho ?? m.turnoMensagem, turnoFalho: undefined,
        })
      })
    }
    return resultado
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const resultado = await next(e)
    if (e.origin.kind === 'composer' && esforcoClaudeValido(e.args.trim())) {
      const m = await memoria($)
      await critico(m, async () => {
        await notificar($, m, { reservas: m.estado.reservas, aviso: 'suspensa: comando explícito de esforço preservado' }, {
          transicao: undefined, turnoAtual: m.turnoFalho ?? m.turnoAtual, turnoMensagem: m.turnoFalho ?? m.turnoMensagem, turnoFalho: undefined,
        })
      })
    }
    return resultado
  })

  on('turn.step', async function* ($, e, next) {
    // Antes do bypass de subagentes: vale para raiz, filhas e toda continuação.
    const trava = impedimento(await lerFontesClaude($), 'claude-max')
    if (trava) {
      yield { kind: 'text' as const, index: 0, text: trava }
      return { turnId: e.turnId, index: e.index, answer: trava, toolUses: [], stopReason: 'end_turn' as const, usage: null }
    }
    if (e.agentId !== undefined) return yield* next(e)
    const m = await memoria($)
    const decisao = await critico(m, async () => {
      const estado = m.estado
      if (m.turnoFalho) return { estado, turno: m.turnoAtual, aviso: 'Roteamento suspenso porque o início do turno não foi gravado. Envie uma nova mensagem ou selecione o modelo manualmente.' }
      const transicao = m.transicao
      // Após suspender pelo seletor, continuações da mesma mensagem ainda refletem o modelo da rota.
      const s = m.suspensaoEsforco
      const refletido = s !== undefined && s.turno === m.turnoMensagem && (e.model === s.base || e.model === s.rota.familia || observarModeloClaude(s.rota, e.model).aplicado !== undefined)
      const marcadores = { transicao: undefined, ultima: estado.ativa && estado.base ? estado.base : { model: refletido ? s.base : e.model, effort: e.effort } }
      if (!estado.ativa || !estado.base) {
        const { ultima } = marcadores
        // A base do preparo acompanha a seleção atual: outra troca de esforço não suspende a fatia preparada.
        if (estado.pendente && estado.base && (estado.base.model !== ultima.model || estado.base.effort !== ultima.effort)) {
          try { await notificar($, m, { ...estado, base: ultima }, marcadores) } catch { /* a memória já tem a base nova */ }
        } else Object.assign(m, marcadores)
        // O passo refletido volta ao modelo do seletor com o esforço escolhido pelo usuário.
        return { estado, turno: m.turnoAtual, manual: refletido && e.model !== s.base ? { model: s.base, effort: e.effort } : undefined }
      }
      const modeloDaRota = e.model === estado.ativa.familia || observarModeloClaude(estado.ativa, e.model).aplicado !== undefined
      const esperado = modeloDaRota && e.effort === estado.ativa.esforco
      const reflexoAnterior = e.index === 0 && transicao?.turno === e.turnId && transicao.modelos.includes(e.model) && transicao.esforco === e.effort
      const mudou = (e.model !== estado.base.model || e.effort !== estado.base.effort) && !esperado && !reflexoAnterior
      // O seletor visual muda sessionEffort sem evento de plugin (applyFlagSettings só avisa a superfície).
      // Esforço novo com o modelo da base ou da rota é escolha manual; modelo diferente segue como possível fallback.
      // Esforço ausente vem de modelo sem esforço, nunca do seletor.
      const esforcoManual = mudou && e.effort !== undefined && e.effort !== estado.base.effort && (e.model === estado.base.model || modeloDaRota)
      const esforco = estado.ativa.esforco
      const esforcoInvalido = !esforcoClaudeValido(esforco)
      if (!esforcoInvalido && !estado.bloqueada && !estado.automatica && esforcoManual) {
        const selecao = { model: estado.base.model, effort: e.effort }
        // Sem evento explícito, o preparo da próxima fatia continua valendo, com a seleção nova como base.
        const suspensa = { reservas: estado.reservas, ...estado.pendente && { pendente: estado.pendente, base: selecao }, aviso: 'suspensa: seleção explícita no app preservada' }
        // A base guarda o modelo do seletor; um passo refletido traz o modelo da rota.
        const suspensaoEsforco = m.turnoMensagem === undefined ? undefined : { turno: m.turnoMensagem, base: estado.base.model, rota: estado.ativa }
        try { await notificar($, m, suspensa, { ...marcadores, suspensaoEsforco, ultima: selecao }) } catch { /* a memória já registra a suspensão */ }
        return { estado: suspensa, turno: m.turnoAtual, manual: e.model !== selecao.model ? selecao : undefined }
      }
      if (esforcoInvalido || estado.bloqueada || estado.automatica || mudou) {
        let aviso = 'Roteamento pendente neste turno: modelo/esforço mudou sem seleção explícita comprovada (possível fallback). Nenhuma requisição enviada. Uma nova mensagem solta a rota e permite reclassificar; não exige troca manual de modelo. Use reserva de mesma capacidade pela dupla na nova tentativa.'
        if (esforcoInvalido) aviso = 'Roteamento pendente: esforço da rota inválido para Claude Code. Nenhuma requisição enviada. Use nova fatia com esforço Claude válido ou outro harness compatível.'
        try {
          await notificar($, m, { ...estado, bloqueada: true, aplicado: undefined, enviado: undefined, observado: undefined, aviso }, marcadores)
        } catch (erro) {
          aviso += ` Falha ao persistir: ${erro instanceof Error ? erro.message : String(erro)}`
        }
        return { estado, turno: m.turnoAtual, aviso }
      }
      Object.assign(m, marcadores)
      return { estado, turno: m.turnoAtual, pedido: { model: estado.ativa.familia, effort: esforco } }
    })
    if (decisao.aviso) {
      yield { kind: 'text' as const, index: 0, text: decisao.aviso }
      return { turnId: e.turnId, index: e.index, answer: decisao.aviso, toolUses: [], stopReason: 'end_turn' as const, usage: null }
    }
    if (decisao.manual) return yield* next({ ...e, ...decisao.manual })
    if (!decisao.pedido) return yield* next(e)
    const resultado = yield* next({ ...e, ...decisao.pedido })
    await critico(m, async () => {
      const atual = m.estado
      // Preparar B mantém A ativa; mescla a confirmação sem apagar o preparo de B.
      // Seleção manual, fallback ou outro turno invalida a observação em voo.
      if (m.turnoFalho || m.turnoAtual !== decisao.turno || atual.ativa !== decisao.estado.ativa || atual.automatica || atual.bloqueada) return
      const observado = { ...atual, enviado: decisao.pedido, ...observarModeloClaude(atual.ativa!, resultado.usage?.model) }
      try { await notificar($, m, observado) } catch {
        // O modelo já respondeu. Uma falha ao registrar a observação não descarta a resposta.
        m.estado = { ...observado, aviso: observado.aviso + ' Observação disponível somente na memória.' }
      }
    })
    return resultado
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'orquestra:roteamento', scope: 'session' as const, text: `${NOTA_ROTEAMENTO}\nFerramenta: ${TOOL}; use acao=consultar para ler estado atual. No Claude a seleção vale via turn.step, sem gravar defaults globais. Esta nota é estática: snapshot do system prompt não confirma estado nem aplicação.` }] }
  })
}
