// Política comum, sem classificador de texto e sem chamadas a modelos.
export type Nivel = 'N1' | 'N2' | 'N3'
export type Canal = 'nativo' | 'antigravity'
const ESFORCOS_CLAUDE = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const FAMILIAS_CLAUDE: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable']
export type EsforcoClaude = typeof ESFORCOS_CLAUDE[number]
// Canal opcional para ler reservas anteriores à inclusão desse campo; ausência significa nativo.
export type Rota = { fatia: string; nivel: Nivel; familia: string; canal?: Canal; esforco: string; motivo: string; papel: string; versao: number }
export type Politica = {
  versao: number
  capacidades: Record<Nivel, { esforco: string; escalado: string; familias: string[] }>
  // Astra, Fable e Argon só revisam e arbitram (usuário, 2026-11-03), com o mesmo piso por risco.
  revisao: { capacidade: Nivel; familias: string[]; L1: string; L2: string }
  limites: { astraExecutor: boolean }
}

export const NOTA_ROTEAMENTO = 'Antes de tarefa nova ou despacho, julgue a capacidade N1/N2/N3 e use rotear_tarefa. ' +
  'A fonte é a skill comum orquestrador/politica-modelos.json. Não classifique por palavras do prompt. ' +
  'Modelo, canal e esforço ficam fixos na fatia; escalada exige nova tentativa/fatia. ' +
  'canal é nativo por padrão; antigravity exige escolha explícita e despacho no OpenCode, sem mudar a família do modelo. ' +
  'Modelo explícito do usuário prevalece; não reduza piso para economizar. Confira pedido e aplicado; pendente não é aplicado. ' +
  'Não pare a tarefa atual esperando outro turno do usuário: despache a fatia via dupla ou subagente disponível, dentro da autorização existente.'

export const ESQUEMA_ROTA = {
  type: 'object',
  properties: {
    fatia: { type: 'string', description: 'Identificador novo da fatia/tentativa; não reutilizar para mudar modelo' },
    nivel: { type: 'string', enum: ['N1', 'N2', 'N3'] },
    familia: { type: 'string', description: 'Família escolhida pelo agente. Execução e orquestração: N1 haiku, luna, flash-lite; N2 sonnet, terra, flash; N3 opus, sol. Revisão (N3): astra, fable, argon. flash-lite/flash/argon exigem canal antigravity no OpenCode' },
    canal: { type: 'string', enum: ['nativo', 'antigravity'], description: 'Padrão nativo. Antigravity usa o provedor google no OpenCode; não altera a família nem autoriza fallback de canal' },
    escalado: { type: 'boolean', description: 'Nova tentativa após falha real; aumenta esforço dentro do nível' },
    papel: { type: 'string', enum: ['execucao', 'orquestracao', 'revisao'] },
    risco: { type: 'string', enum: ['L1', 'L2'], description: 'Obrigatório na revisão; risco não é capacidade' },
    motivo: { type: 'string', description: 'Julgamento breve do agente; sem conteúdo pessoal ou segredo' },
  },
  required: ['fatia', 'nivel', 'familia', 'papel', 'motivo'],
  additionalProperties: false,
}

export function esforcoClaudeValido(valor: unknown): valor is EsforcoClaude {
  return ESFORCOS_CLAUDE.some(esforco => esforco === valor)
}

export function lerPolitica(texto: string): Politica {
  const p = JSON.parse(texto) as Politica
  if (p.versao !== 2 || !p.revisao || typeof p.limites?.astraExecutor !== 'boolean') throw new Error('política inválida')
  if (!Array.isArray(p.revisao.familias) || !p.revisao.familias.length || !esforcoClaudeValido(p.revisao.L1) || !esforcoClaudeValido(p.revisao.L2)) throw new Error('revisão exige famílias e esforços L1 e L2 válidos na política')
  for (const n of ['N1', 'N2', 'N3'] as const) {
    const c = p.capacidades?.[n]
    if (!c || !['low', 'medium', 'high', 'xhigh'].includes(c.esforco) || !['medium', 'high', 'xhigh'].includes(c.escalado) || !Array.isArray(c.familias)) throw new Error('capacidade inválida na política')
  }
  return p
}

export function escolherRota(p: Politica, pedido: Record<string, unknown>): Rota {
  const { fatia, nivel, familia, motivo, papel } = pedido
  if (typeof fatia !== 'string' || !fatia.trim() || fatia.length > 120 || typeof motivo !== 'string' || !motivo.trim() || motivo.length > 600) throw new Error('fatia e motivo são obrigatórios e curtos')
  if (!['N1', 'N2', 'N3'].includes(String(nivel)) || typeof familia !== 'string') throw new Error('nível ou família inválido')
  if (!['execucao', 'orquestracao', 'revisao'].includes(String(papel))) throw new Error('papel inválido')
  if (pedido.escalado !== undefined && typeof pedido.escalado !== 'boolean') throw new Error('escalado deve ser boolean')
  const canal = pedido.canal === undefined ? 'nativo' : pedido.canal
  if (canal !== 'nativo' && canal !== 'antigravity') throw new Error('canal inválido: use nativo ou antigravity')
  const capacidade = p.capacidades[nivel as Nivel]
  let esforco = pedido.escalado ? capacidade.escalado : capacidade.esforco
  if (papel === 'revisao') {
    if (nivel !== p.revisao.capacidade || !['L1', 'L2'].includes(String(pedido.risco))) throw new Error('revisão exige N3 e risco L1 ou L2')
    if (!p.revisao.familias.includes(familia)) throw new Error(`${familia} não revisa; use ${p.revisao.familias.join(', ')}`)
    esforco = pedido.risco === 'L2' || pedido.escalado ? p.revisao.L2 : p.revisao.L1
  } else {
    if (p.revisao.familias.includes(familia)) throw new Error(`${familia} reservado à revisão; execução e orquestração usam as famílias de ${nivel}`)
    if (!capacidade.familias.includes(familia)) throw new Error(`${familia} não atende ${nivel}; escolha uma família da capacidade exigida`)
  }
  return { fatia: fatia.trim(), nivel: nivel as Nivel, familia, canal, esforco, motivo: motivo.trim(), papel: String(papel), versao: p.versao }
}

export function conferirFatia(anterior: Rota | undefined, nova: Rota): void {
  if (anterior?.fatia === nova.fatia && (anterior.familia !== nova.familia || anterior.esforco !== nova.esforco || anterior.nivel !== nova.nivel || (anterior.canal ?? 'nativo') !== (nova.canal ?? 'nativo'))) throw new Error('modelo, canal e esforço fixos: use outra fatia/tentativa')
}

export function reservarFatia(reservas: Record<string, Rota> | undefined, nova: Rota): Record<string, Rota> {
  const mapa = reservas ?? {}
  conferirFatia(Object.hasOwn(mapa, nova.fatia) ? mapa[nova.fatia] : undefined, nova)
  return { ...mapa, [nova.fatia]: nova }
}

// A resposta confirma apenas o modelo. O esforço do pedido não é eco do provedor.
export function observarModeloClaude(rota: Rota, modelo: string | undefined) {
  const familia = modelo?.match(/^claude-(haiku|sonnet|opus|fable)(?:-|$)/)?.[1]
  const confirmado = familia === rota.familia
  return {
    aplicado: confirmado ? { model: modelo as string } : undefined,
    observado: modelo,
    aviso: !modelo ? 'pendente: resposta sem modelo observado; esforço apenas enviado'
      : confirmado ? 'modelo da família pedida confirmado; esforço apenas enviado, sem eco do provedor; seletor visual original'
      : `divergente/pendente: pedido ${rota.familia}, resposta ${modelo}; esforço apenas enviado, sem eco do provedor`,
  }
}
