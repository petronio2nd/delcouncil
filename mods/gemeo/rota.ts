import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { escolherRota, lerPolitica, type Rota } from '../orquestra/hooks/roteamento.ts'

export type ModeloRota = { providerID: string; id: string; variant?: string }
export type InfoRota = ModeloRota & { enabled?: boolean; variants?: readonly { id: string }[]; time?: { released?: number } }

export async function lerRota(pedido: Record<string, unknown>): Promise<Rota> {
  const explicito = process.env.ORQUESTRA_POLITICA
  const texto = explicito ? await readFile(explicito, 'utf8') : await readFile(join(homedir(), '.agents', 'skills', 'orquestrador', 'politica-modelos.json'), 'utf8')
    .catch(() => readFile(join(homedir(), '.claude', 'skills', 'orquestrador', 'politica-modelos.json'), 'utf8'))
  return escolherRota(lerPolitica(texto), pedido)
}

// No catálogo Antigravity estes sufixos são parte do ID real, não variants.
// Gramática fechada: GPT-OSS e modelos thinking legados não são equivalentes. Flash-Lite é família própria
// (N1, usuário, 2026-11-03) e vem sem sufixo: sem botão de esforço, só atende o piso low.
function identidadeAntigravity(id: string) {
  const claude = /^antigravity-claude-(haiku|sonnet|opus|fable)-(\d+(?:[.-]\d+)*)-(low|medium|high|xhigh|max)$/.exec(id)
  const gemini = /^antigravity-gemini-(\d+(?:[.-]\d+)*)-(flash|argon)-(low|medium|high|xhigh)$/.exec(id)
  const lite = /^antigravity-gemini-(\d+(?:[.-]\d+)*)-flash-lite$/.exec(id)
  if (lite) return { familia: 'flash-lite', versao: lite[1].split(/[.-]/).map(Number), esforco: 'low' }
  if (!claude && !gemini) return undefined
  return { familia: claude ? claude[1] : gemini![2], versao: (claude ? claude[2] : gemini![1]).split(/[.-]/).map(Number), esforco: (claude ?? gemini)![3] }
}

const ESFORCOS_ANTIGRAVITY: readonly string[] = ['low', 'medium', 'high', 'xhigh']

function compararVersao(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diferenca = (a[i] ?? 0) - (b[i] ?? 0)
    if (diferenca) return diferenca
  }
  return 0
}

function modeloAntigravity(rota: Rota, modelos: readonly InfoRota[]): ModeloRota {
  const piso = ESFORCOS_ANTIGRAVITY.indexOf(rota.esforco)
  const familia = modelos.flatMap(modelo => {
    const identidade = modelo.providerID === 'google' && modelo.enabled !== false ? identidadeAntigravity(modelo.id) : undefined
    return identidade?.familia === rota.familia ? [{ modelo, versao: identidade.versao, esforco: identidade.esforco }] : []
  })
  // Como a dupla (despachar.ps1 e Select-VarianteAgy): a versão mais nova da família e, nela, o menor
  // esforço que atende ao piso. Sem esforço suficiente nessa versão, recusa em vez de usar uma anterior.
  const maisNova = familia.reduce<readonly number[] | undefined>((atual, c) => !atual || compararVersao(c.versao, atual) > 0 ? c.versao : atual, undefined)
  const candidatos = familia.flatMap(c => {
    const ordem = ESFORCOS_ANTIGRAVITY.indexOf(c.esforco)
    // max só atende pedido max; nunca entra na promoção automática low..xhigh.
    const atende = rota.esforco === 'max' ? c.esforco === 'max' : piso >= 0 && ordem >= piso
    return maisNova && compararVersao(c.versao, maisNova) === 0 && atende ? [{ ...c, ordem }] : []
  })
  candidatos.sort((a, b) => a.ordem - b.ordem
    || (b.modelo.time?.released ?? 0) - (a.modelo.time?.released ?? 0) || a.modelo.id.localeCompare(b.modelo.id))
  const modelo = candidatos[0]?.modelo
  if (!modelo) {
    const exigencia = rota.esforco === 'max' ? 'modelo Claude com sufixo -max exato e habilitado' : `esforço ${rota.esforco} ou superior até xhigh`
    const versao = maisNova ? ` na versão mais nova (${maisNova.join('.')})` : ''
    throw new Error(`família ${rota.familia} indisponível no canal antigravity: exige ${exigencia}${versao}; preserve ${rota.nivel}, sem reduzir esforço nem trocar canal`)
  }
  return { providerID: modelo.providerID, id: modelo.id }
}

export function modeloDaRota(rota: Rota, modelos: readonly InfoRota[], resolver: (familia: string, modelos: readonly InfoRota[]) => ModeloRota | undefined): ModeloRota {
  if (rota.canal === 'antigravity') return modeloAntigravity(rota, modelos)
  if (rota.canal !== undefined && rota.canal !== 'nativo') throw new Error('canal inválido')
  const ref = resolver(rota.familia, modelos)
  const info = ref && modelos.find(m => m.providerID === ref.providerID && m.id === ref.id && m.enabled !== false)
  if (!ref || !info) throw new Error(`família ${rota.familia} indisponível neste harness; preserve ${rota.nivel}`)
  if (!info.variants?.some(v => v.id === rota.esforco)) throw new Error(`${ref.id} sem variante ${rota.esforco}; esforço não foi reduzido`)
  return { ...ref, variant: rota.esforco }
}

// A referência aqui já foi selecionada/confirmada; não infere esforço da política.
export function esforcoDoModelo(rota: Rota, modelo: ModeloRota): string {
  const esforco = rota.canal === 'antigravity' ? identidadeAntigravity(modelo.id)?.esforco : modelo.variant
  if (!esforco) throw new Error('referência selecionada sem esforço identificável')
  return esforco
}

// Recebe exclusivamente o id devolvido pelo create deste despacho. Não aceita id fornecido pelo agente.
export async function aplicarRotaNova(sessionID: string, modelo: ModeloRota, session: {
  switchModel(input: { sessionID: string; model: ModeloRota }): Promise<unknown>
  get(input: { sessionID: string }): Promise<{ model?: ModeloRota }>
}): Promise<ModeloRota> {
  await session.switchModel({ sessionID, model: modelo })
  const real = (await session.get({ sessionID })).model
  if (!real || real.providerID !== modelo.providerID || real.id !== modelo.id || real.variant !== modelo.variant) throw new Error('modelo/esforço aplicado diverge do pedido; primeiro prompt não foi enviado')
  return real
}
