// Lógica pura da visão de cotas: lê o histórico do recursos.ps1 (cotas.jsonl, um retrato por linha), junta as
// leituras do Claude Max que o próprio painel guarda e calcula quanto de cada janela longa se perdeu no reset.
// Nada aqui toca disco; o register.tsx lê os arquivos e passa o texto.

import type { Cota, Cotas, Fechada, Fila, JanelaMax, Leitura, Retrato } from '../types'
import { nomeFonte } from './leitura'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Uma linha por retrato; linha quebrada (gravação interrompida, edição à mão) fica de fora sem derrubar as outras.
export function lerHistorico(texto: string): Retrato[] {
  const saida: Retrato[] = []
  for (const l of texto.split(/\r?\n/)) {
    if (!l.trim()) continue
    try {
      const r = JSON.parse(l) as Record<string, unknown>
      if (num(r?.em) === null || !Array.isArray(r.fontes)) continue
      const fontes: Leitura[] = []
      for (const x of r.fontes as unknown[]) {
        const f = x as Record<string, unknown>
        if (!f || typeof f.fonte !== 'string' || !f.fonte.trim()) continue
        const medido = num(f.medido)
        fontes.push({
          fonte: f.fonte,
          limite: typeof f.limite === 'string' ? f.limite : '',
          usado: num(f.usado),
          volta: num(f.volta),
          horas: num(f.horas),
          folga: num(f.folga),
          ...(medido !== null ? { medido } : {}),
        })
      }
      const fuso = num(r.fuso)
      saida.push({ em: r.em as number, semAgy: r.semAgy === true, ...(fuso !== null ? { fuso } : {}), fontes })
    } catch {
      continue
    }
  }
  return saida.sort((a, b) => a.em - b.em)
}

// Uma leitura dentro de uma janela: quanto estava usado, quando a janela volta e quando foi lida.
export type Ponto = { fonte: string; limite: string; usado: number; volta: number; em: number }

const ehLonga = (horas: number | null) => horas !== null && horas > 5

// A hora do ponto é a da medição, quando o retrato a traz: um retrato velho relido perto do reset não pode
// passar por leitura recente e tirar o "≤" do perdido.
export function pontosDoHistorico(retratos: readonly Retrato[]): Ponto[] {
  const saida: Ponto[] = []
  for (const r of retratos)
    for (const f of r.fontes) {
      const em = f.medido ?? r.em
      if (f.usado !== null && f.volta !== null && ehLonga(f.horas) && em < f.volta)
        saida.push({ fonte: f.fonte, limite: f.limite, usado: f.usado, volta: f.volta, em })
    }
  return saida
}

// O reset do agy e do ChatGPT vem com segundos de diferença entre leituras: até 1 h é a mesma janela.
const MESMA_JANELA_MS = 3_600_000
// Última leitura mais de 6 h antes do reset: o uso pode ter subido depois, e o perdido é um teto (≤).
const LEITURA_LONGE_MS = 6 * 3_600_000

// As janelas que já fecharam (volta no passado), da mais recente para a mais antiga, por fonte e limite.
// O uso só sobe dentro da janela: o maior lido é o que se usou, e o resto se perdeu.
export function janelasFechadas(pontos: readonly Ponto[], agora: number): Map<string, Fechada[]> {
  const porChave = new Map<string, Ponto[]>()
  for (const p of pontos) {
    const k = `${p.fonte}|${p.limite}`
    porChave.set(k, [...(porChave.get(k) ?? []), p])
  }
  const saida = new Map<string, Fechada[]>()
  for (const [k, lista] of porChave) {
    const grupos: Ponto[][] = []
    for (const p of [...lista].sort((a, b) => a.volta - b.volta)) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo?.[0] && p.volta - ultimo[0].volta <= MESMA_JANELA_MS) ultimo.push(p)
      else grupos.push([p])
    }
    const fechadas = grupos
      .map(g => {
        const volta = Math.max(...g.map(p => p.volta))
        const usado = Math.min(100, Math.max(...g.map(p => p.usado)))
        const ultima = Math.max(...g.map(p => p.em))
        return { volta, usado, ultima, perdido: Math.round(100 - usado), aprox: volta - ultima > LEITURA_LONGE_MS }
      })
      .filter(f => f.volta <= agora)
      .sort((a, b) => b.volta - a.volta)
    if (fechadas.length) saida.set(k, fechadas)
  }
  return saida
}

const VISTO_PASSO_MS = 30 * 60_000
const GUARDA_MS = 180 * 24 * 3_600_000

// A janela de `lista` que é a mesma de `j`, ou undefined.
const mesma = (lista: readonly JanelaMax[], j: Pick<JanelaMax, 'kind' | 'volta'>) =>
  lista.find(x => x.kind === j.kind && Math.abs(x.volta - j.volta) <= MESMA_JANELA_MS)

// Junta `j` na lista pelo maior uso, o último visto e a volta mais tarde. Muda a lista.
function fundir(lista: JanelaMax[], j: JanelaMax): void {
  const igual = mesma(lista, j)
  if (!igual) return void lista.push({ ...j })
  igual.usado = Math.max(igual.usado, j.usado)
  igual.visto = Math.max(igual.visto, j.visto)
  igual.volta = Math.max(igual.volta, j.volta)
}

// Claude Max: cada sessão guarda, por janela, o maior uso que viu e quando ($.store, numa chave só dela).
export function juntarMax(guardado: readonly JanelaMax[], limites: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>, agora: number): JanelaMax[] {
  const lista = guardado.filter(j => agora - j.volta < GUARDA_MS).map(j => ({ ...j }))
  for (const l of limites) {
    const volta = l.resetsAt ? Date.parse(l.resetsAt) : NaN
    if (!Number.isFinite(volta) || !Number.isFinite(l.percentUsed) || volta <= agora) continue
    const igual = mesma(lista, { kind: l.kind, volta })
    // A varredura roda a cada 4 s: o "visto" só anda quando o uso sobe ou a cada 30 min, para não gravar o
    // $.store o tempo todo.
    if (igual && l.percentUsed <= igual.usado && agora - igual.visto < VISTO_PASSO_MS) continue
    fundir(lista, { kind: l.kind, volta, usado: l.percentUsed, visto: agora })
  }
  return lista.sort((a, b) => a.volta - b.volta)
}

// As listas de várias sessões, uma por chave do $.store: junta pelo maior, sem perder janela de nenhuma.
export function mesclarMax(...listas: ReadonlyArray<readonly JanelaMax[]>): JanelaMax[] {
  const lista: JanelaMax[] = []
  for (const l of listas) for (const j of l) fundir(lista, j)
  return lista.sort((a, b) => a.volta - b.volta)
}

// Chave de outra sessão que pode sair do $.store: lida sem erro, com janelas válidas e a última gravação há mais
// de 180 dias. Sessão viva anda o "visto" a cada 30 min; se mesmo assim sair, a dona regrava da memória.
export function maxAbandonado(v: unknown, agora: number): boolean {
  const lista = lerMax(v)
  return lista.length > 0 && lista.every(j => agora - j.visto >= GUARDA_MS && agora - j.volta >= GUARDA_MS)
}

export function lerMax(v: unknown): JanelaMax[] {
  if (!Array.isArray(v)) return []
  return v.filter((j): j is JanelaMax =>
    !!j && typeof j.kind === 'string' && num(j.volta) !== null && num(j.usado) !== null && num(j.visto) !== null)
}

const HORAS_MAX: Record<string, number> = { five_hour: 5, seven_day: 168 }

export function pontosDoMax(janelas: readonly JanelaMax[]): Ponto[] {
  return janelas
    .filter(j => ehLonga(HORAS_MAX[j.kind] ?? null))
    .map(j => ({ fonte: 'Claude Max', limite: j.kind, usado: j.usado, volta: j.volta, em: j.visto }))
}

// A mesma folga do recursos.ps1: % que resta − % da janela que ainda falta até o reset.
export function folga(usado: number, volta: number, horas: number, agora: number): number {
  const falta = Math.min(100, Math.max(0, (100 * (volta - agora)) / (horas * 3_600_000)))
  return Math.round(100 - usado - falta)
}

export function leiturasDoMax(limites: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>, agora: number): Leitura[] {
  return limites
    .filter(l => Number.isFinite(l.percentUsed))
    .map(l => {
      const volta = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      const horas = HORAS_MAX[l.kind] ?? null
      const v = Number.isFinite(volta) ? volta : null
      return {
        fonte: 'Claude Max',
        limite: l.kind,
        usado: l.percentUsed,
        volta: v,
        horas,
        folga: v !== null && horas !== null ? folga(l.percentUsed, v, horas, agora) : null,
      }
    })
    .sort((a, b) => (b.horas ?? 0) - (a.horas ?? 0))
}

const POR_COTA = 4
const NA_MEDIA = 8

// O último retrato do recursos.ps1, com o Claude Max lido pelo painel no lugar da linha "leia pelo app".
export function montarCotas(retratos: readonly Retrato[], max: readonly JanelaMax[], maxAgora: readonly Leitura[], agora: number): Cotas {
  const ultimo = retratos[retratos.length - 1]
  const fechadas = janelasFechadas([...pontosDoHistorico(retratos), ...pontosDoMax(max)], agora)
  // A linha "Claude Max" do recursos.ps1 nunca tem número: sem leitura ao vivo, o aviso do fim cobre.
  const leituras = [...maxAgora, ...(ultimo?.fontes.filter(f => f.fonte !== 'Claude Max') ?? [])]
  const cotas: Cota[] = leituras.map(l => {
    const todas = ehLonga(l.horas) ? (fechadas.get(`${l.fonte}|${l.limite}`) ?? []) : []
    const naMedia = todas.slice(0, NA_MEDIA)
    return {
      ...l,
      fechadas: todas.slice(0, POR_COTA),
      media: naMedia.length ? Math.round(naMedia.reduce((s, f) => s + f.perdido, 0) / naMedia.length) : undefined,
      mediaDe: naMedia.length,
      mediaAprox: naMedia.some(f => f.aprox),
    }
  })
  return {
    lidoEm: ultimo?.em ?? 0,
    semAgy: ultimo?.semAgy ?? false,
    ...(ultimo?.fuso !== undefined ? { fuso: ultimo.fuso } : {}),
    cotas,
    maxAoVivo: maxAgora.length > 0,
  }
}

// As cinco cotas que o painel sempre mostra, na ordem fixa: a semanal de cada fonte. Sem leitura no último
// retrato, a linha sai "não lida" em vez de sumir.
const FIXAS: ReadonlyArray<{ casa: (fonte: string) => boolean; nome: string }> = [
  { casa: f => f === 'Claude Max', nome: 'Claude Max' },
  { casa: f => f.startsWith('ChatGPT'), nome: 'ChatGPT (OpenCode/Codex)' },
  { casa: f => f.includes('Gemini Models'), nome: 'agy Gemini Models' },
  { casa: f => f.includes('Argon'), nome: 'agy Gemini 4 Argon' },
  { casa: f => f.startsWith('API Anthropic'), nome: 'API Anthropic (opencode)' },
]

export function cotasFixas(c: Cotas): Cota[] {
  return FIXAS.map(({ casa, nome }) =>
    c.cotas.find(x => casa(x.fonte) && x.horas === 168) ?? {
      fonte: nome, limite: '', usado: null, volta: null, horas: 168, folga: null,
      fechadas: [], media: undefined, mediaDe: 0, mediaAprox: false,
    })
}

// --- Formatação comum ao painel e ao /orquestra cotas texto ---

export function nomeLimite(l: Pick<Leitura, 'limite' | 'horas'>): string {
  if (l.limite.startsWith('US$')) return l.limite.replace(/\s*\((monthly|mensal)\)/, '/mês')
  if (l.horas === 5) return '5 h'
  if (l.horas === 168) return 'semanal'
  if (l.horas !== null && l.horas >= 672) return 'mês'
  return l.limite === '-' ? '' : l.limite
}

const dois = (n: number) => String(n).padStart(2, '0')
// Com o fuso do Windows (vindo do retrato), a data não depende do fuso do ambiente onde o mod roda.
function partes(ms: number, fuso?: number): { dia: number; mes: number; hora: number; min: number; semana: number } {
  const d = new Date(fuso === undefined ? ms : ms + fuso * 60_000)
  return fuso === undefined
    ? { dia: d.getDate(), mes: d.getMonth(), hora: d.getHours(), min: d.getMinutes(), semana: d.getDay() }
    : { dia: d.getUTCDate(), mes: d.getUTCMonth(), hora: d.getUTCHours(), min: d.getUTCMinutes(), semana: d.getUTCDay() }
}

export function dataCurta(ms: number, comHora = true, fuso?: number): string {
  const p = partes(ms, fuso)
  const data = `${dois(p.dia)}/${dois(p.mes + 1)}`
  return comHora ? `${data} ${dois(p.hora)}:${dois(p.min)}` : data
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// "volta 18:40" no mesmo dia, "volta qui" na semana, "volta 01/11" depois.
export function quandoVolta(volta: number, agora: number, fuso?: number): string {
  const p = partes(volta, fuso)
  const falta = volta - agora
  if (falta < 20 * 3_600_000) return `volta ${dois(p.hora)}:${dois(p.min)}`
  if (falta < 6 * 24 * 3_600_000) return `volta ${SEMANA[p.semana]}`
  return `volta ${dataCurta(volta, false, fuso)}`
}

// Dez casas: ▰ cheia, ▱ vazia.
export function barra(pct: number): string {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return '▰'.repeat(n) + '▱'.repeat(10 - n)
}

// Quanto da janela já passou (%), para comparar com o uso.
export function tempoPassado(c: Pick<Leitura, 'volta' | 'horas'>, agora: number): number | undefined {
  if (c.volta === null || c.horas === null || c.horas <= 0) return undefined
  const falta = Math.min(100, Math.max(0, (100 * (c.volta - agora)) / (c.horas * 3_600_000)))
  return Math.round(100 - falta)
}

export type Tom = 'success' | 'warning' | 'error'

// A folga em palavras: uso abaixo do tempo vai sobrar, acima vai faltar.
export function rotulo(c: Pick<Leitura, 'usado' | 'folga'>): { texto: string; tom?: Tom } {
  if (c.usado === null) return { texto: 'não lido' }
  if (c.usado >= 100) return { texto: 'esgotada', tom: 'error' }
  if (c.folga === null) return { texto: '' }
  if (c.folga >= 30) return { texto: 'sobra muito', tom: 'success' }
  if (c.folga >= 10) return { texto: 'sobra', tom: 'success' }
  if (c.folga >= -3) return { texto: 'no ritmo' }
  if (c.folga >= -15) return { texto: 'apertado', tom: 'warning' }
  return { texto: 'vai faltar', tom: 'error' }
}

// O que o painel desenha de uma cota: título e rótulo na primeira linha, as duas barras, as perdas.
export function linhasCota(c: Cota, agora: number, fuso?: number): { titulo: string; rotulo: { texto: string; tom?: Tom }; uso?: string; tempo?: string; perdeu?: string } {
  const tempo = c.usado === null ? undefined : tempoPassado(c, agora)
  const perdeu = perdas(c, fuso)
  return {
    titulo: titulo(c),
    rotulo: rotulo(c),
    ...(c.usado !== null ? { uso: `${barra(c.usado)} ${Math.round(c.usado)}%` } : {}),
    ...(tempo !== undefined ? { tempo: `${barra(tempo)} ${tempo}% · ${quandoVolta(c.volta!, agora, fuso)}` } : {}),
    ...(perdeu ? { perdeu } : {}),
  }
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

// Os mesmos limites do quandoVolta, por extenso: "às 22:00", "segunda", "em 02/11".
function renova(volta: number, agora: number, fuso?: number): string {
  const p = partes(volta, fuso)
  const falta = volta - agora
  if (falta < 20 * 3_600_000) return `às ${dois(p.hora)}:${dois(p.min)}`
  if (falta < 6 * 24 * 3_600_000) return DIAS[p.semana]!
  return `em ${dataCurta(volta, false, fuso)}`
}

export type Trecho = { texto: string; tipo: 'cheia' | 'vazia' | 'marca' }

// A cota do próximo trabalho numa barra e numa frase: a barra cheia é o uso, o "│" marca quanto da
// janela já passou. "Cota semanal quase toda livre: usou 1%, e 76% da semana já passou (│). Renova segunda."
export function fraseCota(c: Cota, agora: number, fuso?: number): { frase: string; barra?: Trecho[] } {
  if (c.usado === null) return { frase: 'Cota não lida.' }
  const u = Math.round(c.usado)
  const tempo = tempoPassado(c, agora)
  const limite = nomeLimite(c)
  const nome = limite === 'semanal' ? 'Cota semanal' : limite === 'mês' ? 'Cota do mês' : limite === '5 h' ? 'Cota de 5 h' : limite ? `Cota ${limite}` : 'Cota'
  const livre = c.usado >= 100 ? 'esgotada' : c.usado >= 90 ? 'quase esgotada' : u < 10 ? 'quase toda livre' : u < 50 ? 'com mais da metade livre' : `com ${100 - u}% livre`
  const periodo = (c.horas ?? 0) <= 24 ? 'da janela' : (c.horas ?? 0) <= 200 ? 'da semana' : 'do mês'
  let frase = `${nome} ${livre}: usou ${u}%`
  if (tempo !== undefined) frase += `, e ${tempo}% ${periodo} já passou (│)`
  frase += '.'
  if (c.volta !== null) frase += ` Renova ${renova(c.volta, agora, fuso)}.`
  const cheias = Math.max(0, Math.min(10, Math.round(u / 10)))
  const marca = tempo === undefined ? undefined : Math.max(0, Math.min(10, Math.round(tempo / 10)))
  const barra: Trecho[] = []
  const por = (texto: string, tipo: Trecho['tipo']) => {
    const ultimo = barra[barra.length - 1]
    if (ultimo?.tipo === tipo) ultimo.texto += texto
    else barra.push({ texto, tipo })
  }
  for (let i = 0; i <= 10; i++) {
    if (i === marca) por('│', 'marca')
    if (i < 10) por(i < cheias ? '▰' : '▱', i < cheias ? 'cheia' : 'vazia')
  }
  return { frase, barra }
}

// A primeira fonte da fila (sem trava) e a cota dela de janela mais longa, para o painel orquestra.
export function proximaFonte(f: Fila | undefined, c: Cotas): { nome: string; cota?: Cota; depois?: string } | undefined {
  const livres = (f?.fila ?? []).filter(x => !x.trava)
  const primeira = livres[0]
  if (!primeira) return undefined
  const cota = c.cotas.filter(x => x.fonte === primeira.fonte).sort((a, b) => (b.horas ?? 0) - (a.horas ?? 0))[0]
  return {
    nome: nomeFonte(primeira.fonte),
    ...(cota ? { cota } : {}),
    ...(livres[1] ? { depois: nomeFonte(livres[1].fonte) } : {}),
  }
}

const sinal = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n)}`

export function titulo(c: Cota): string {
  return [nomeFonte(c.fonte), nomeLimite(c)].filter(Boolean).join(' · ')
}

export function situacao(c: Cota, fuso?: number): string {
  if (c.usado === null) return 'não lido'
  const partes = [`usou ${Math.round(c.usado)}%`]
  if (c.volta !== null) partes.push(`volta ${dataCurta(c.volta, (c.horas ?? 0) < 672, fuso)}`)
  if (c.folga !== null) partes.push(`folga ${sinal(c.folga)}`)
  return partes.join(' · ')
}

// "perdeu 18/10 40% · 25/10 ≤12% · média 26% de 2": o mais recente primeiro.
export function perdas(c: Cota, fuso?: number): string | undefined {
  if (!c.fechadas.length) return undefined
  const lista = c.fechadas.map(f => `${dataCurta(f.volta, false, fuso)} ${f.aprox ? '≤' : ''}${f.perdido}%`).join(' · ')
  const media = c.mediaDe > 1 ? ` · média ${c.mediaAprox ? '≤' : ''}${c.media}% de ${c.mediaDe}` : ''
  return `perdeu ${lista}${media}`
}

export function idadeCotas(c: Cotas, agora: number): { velha: boolean; horas: number } {
  const horas = c.lidoEm ? Math.floor(Math.max(0, agora - c.lidoEm) / 3_600_000) : Infinity
  return { velha: horas >= 6, horas }
}

export function topoCotas(c: Cotas, agora: number, ha: (ms: number) => string): { texto: string; velha: boolean } {
  const idade = idadeCotas(c, agora)
  if (!c.lidoEm) return { texto: 'sem histórico · rode recursos.ps1', velha: true }
  const quando = idade.velha ? `histórico de há ${idade.horas} h · rode recursos.ps1` : `lidas ${ha(agora - c.lidoEm)}`
  return { texto: quando + (c.semAgy ? ' (sem agy)' : ''), velha: idade.velha }
}

export const AVISO_MAX = 'Claude Max: sem leitura nesta sessão (vem com a primeira resposta do modelo)'

export function cotasEmTexto(c: Cotas, agora: number, ha: (ms: number) => string): string {
  const linhas = [`Cotas  ${topoCotas(c, agora, ha).texto}`]
  for (const cota of c.cotas) {
    linhas.push(`  ${titulo(cota)} — ${situacao(cota, c.fuso)}`)
    const p = perdas(cota, c.fuso)
    if (p) linhas.push(`      ${p}`)
  }
  if (!c.maxAoVivo) linhas.push(`  ${AVISO_MAX}`)
  return linhas.join('\n')
}
