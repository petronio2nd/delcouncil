import type { EngineInterface, Register } from 'claude-code'

// Troca o emoji do nome da sessão no app desktop enquanto o turno anda:
//   ⚙️ quando o turno começa;
//   🧠 quando o Claude pergunta (AskUserQuestion), pede aprovação de plano ou o app pede permissão;
//   ⚙️ de novo quando a última espera aberta termina;
//   no fim do turno, o nome que o Claude deu nesse turno ou, se ele não renomeou, o de antes.
// O texto depois do emoji é sempre do Claude (CLAUDE.md, "Nome da sessão"). Fora do app desktop
// as ferramentas da sessão não existem: na primeira recusa o mod se desliga, sem log.
// As funções que recebem o $ ficam no topo do arquivo (regra do engine), e o estado com elas.

const RENOMEAR = 'mcp__ccd_session_mgmt__set_session_title'
const LER = 'mcp__ccd_session_mgmt__get_session'
const PROPRIAS = new Set([RENOMEAR, LER])
const PERGUNTAS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const TRABALHANDO = '⚙️'
const ESPERANDO = '🧠'
// Um emoji no começo do nome, com ou sem o seletor U+FE0F, e o espaço depois dele.
const EMOJI = /^\s*\p{Extended_Pictographic}️?\s*/u
const PROVISORIO = /^\s*⚙/u // 🧠 não: é também o emoji final de "espera decisão do usuário"

let desligado = false
let meuId: string | undefined // o sessionId desta sessão, para reconhecer renomeação pelo id
let atual: string | undefined // o nome que a sessão tem agora; relido no começo de cada turno
let antesDoTurno: string | undefined
let doClaude: string | undefined // o último nome que o Claude deu a esta sessão neste turno
const esperas = new Map<string, number>() // ferramenta -> pedidos ao usuário ainda abertos
// Chamadas em andamento por ferramenta, na ordem em que começaram. O pedido de permissão não traz o
// id da chamada: ele fica com a mais recente daquela ferramenta que ainda não pediu, porque a
// permissão é pedida logo no começo da chamada.
const emCurso = new Map<string, { pediu: boolean }[]>()
const meus = new Set<string>() // nomes que o próprio mod está gravando: o observador os ignora
let fila: Promise<unknown> = Promise.resolve()

function zerar() {
  desligado = false
  meuId = atual = antesDoTurno = doClaude = undefined
  esperas.clear()
  emCurso.clear()
  meus.clear()
  fila = Promise.resolve()
}

export function semEmoji(titulo: string): string {
  return titulo.replace(EMOJI, '')
}

export function comEmoji(emoji: string, titulo: string): string {
  const texto = semEmoji(titulo).trim()
  return texto ? `${emoji} ${texto}` : emoji
}

// O nome do fim do turno: o do Claude, se ele renomeou; senão o de antes. Nunca fica parado com ⚙️:
// nesse caso vai só o texto.
export function nomeFinal(claude: string | undefined, antes: string | undefined): string | undefined {
  const base = claude ?? antes
  if (base === undefined || !PROVISORIO.test(base)) return base
  return semEmoji(base).trim() || undefined
}

// Ferramenta da sessão: a resposta, ou undefined se recusou. Fora do desktop (não existe) desliga o mod.
async function ferramenta($: EngineInterface, input: { tool: string; [k: string]: unknown }) {
  if (desligado) return undefined
  try {
    const r = await $.tool.call(input as any)
    return r.deny === undefined && !r.isError ? r : undefined
  } catch {
    desligado = true
    return undefined
  }
}

async function ler($: EngineInterface): Promise<string | undefined> {
  if (atual !== undefined) return atual
  const r = await ferramenta($, { tool: LER, session_id: 'self' })
  if (!r?.text) return undefined
  try {
    const dados = JSON.parse(r.text)
    if (typeof dados.sessionId === 'string') meuId = dados.sessionId
    if (typeof dados.title === 'string') atual = dados.title
  } catch {
    return undefined
  }
  return atual
}

async function gravar($: EngineInterface, titulo: string) {
  if (titulo === atual) return
  meus.add(titulo)
  try {
    if (await ferramenta($, { tool: RENOMEAR, session_id: 'self', title: titulo })) atual = titulo
  } finally {
    meus.delete(titulo)
  }
}

// Uma troca de cada vez, na ordem em que os eventos chegam; um erro não trava as seguintes.
function emFila(passo: () => Promise<void>) {
  fila = fila.then(passo).catch(() => undefined)
  return fila
}

async function trocarEmoji($: EngineInterface, emoji: string) {
  const titulo = await ler($)
  if (titulo !== undefined) await gravar($, comEmoji(emoji, titulo))
}

function abrirEspera($: EngineInterface, chave: string) {
  esperas.set(chave, (esperas.get(chave) ?? 0) + 1)
  return emFila(() => trocarEmoji($, ESPERANDO))
}

function fecharEspera($: EngineInterface, chave: string) {
  const n = esperas.get(chave) ?? 0
  if (n === 0) return
  if (n === 1) esperas.delete(chave)
  else esperas.set(chave, n - 1)
  if (esperas.size === 0) emFila(() => trocarEmoji($, TRABALHANDO))
}

async function comecarTurno($: EngineInterface) {
  atual = undefined // o usuário ou outra sessão podem ter renomeado entre os turnos
  antesDoTurno = await ler($)
  await trocarEmoji($, TRABALHANDO)
}

async function terminarTurno($: EngineInterface) {
  const final = nomeFinal(doClaude, antesDoTurno)
  if (final !== undefined) await gravar($, final)
}

export const register: Register = on => {
  zerar()

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined || desligado) return next(e)
    doClaude = undefined
    esperas.clear()
    emCurso.clear()
    await emFila(() => comecarTurno($))
    return next(e)
  })

  // A permissão pedida dentro do next() abre a espera; o fim da chamada, de quem for, a fecha.
  // Um gancho só para todas as ferramentas: o casamento por nome da ferramenta MCP faz o tsc
  // expandir o tipo dela fundo demais.
  on('tool.call', async ($, e, next) => {
    const nome = String(e.tool)
    if (nome === RENOMEAR) {
      // O Claude renomeou esta sessão: esse passa a ser o nome do fim do turno.
      const r = await next(e)
      const campos = e as unknown as { title?: unknown; session_id?: unknown }
      const titulo = typeof campos.title === 'string' ? campos.title : undefined
      const destaSessao = campos.session_id === 'self' || (meuId !== undefined && campos.session_id === meuId)
      const ok = r.deny === undefined && !r.isError
      if (titulo !== undefined && !meus.has(titulo) && destaSessao && e.agentId === undefined && ok) {
        atual = titulo
        doClaude = titulo
      }
      return r
    }
    if (nome === LER || desligado) return next(e)
    const pergunta = e.agentId === undefined && PERGUNTAS.has(nome)
    if (pergunta) await abrirEspera($, nome)
    const chamada = { pediu: false }
    emCurso.set(nome, [...(emCurso.get(nome) ?? []), chamada])
    try {
      return await next(e)
    } finally {
      emCurso.set(nome, (emCurso.get(nome) ?? []).filter(c => c !== chamada))
      // Sem await: a volta a ⚙️ não precisa segurar o resultado da ferramenta.
      if (pergunta) fecharEspera($, nome)
      if (chamada.pediu) fecharEspera($, 'permissao:' + nome)
    }
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    // A chamada do próprio mod pedindo permissão não entra na fila: ela espera essa mesma chamada.
    if (PROPRIAS.has(e.tool_name) || desligado) return next(e)
    const dona = [...(emCurso.get(e.tool_name) ?? [])].reverse().find(c => !c.pediu)
    if (dona) {
      dona.pediu = true
      abrirEspera($, 'permissao:' + e.tool_name)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || desligado) return next(e)
    esperas.clear()
    await emFila(() => terminarTurno($))
    return next(e)
  })
}
