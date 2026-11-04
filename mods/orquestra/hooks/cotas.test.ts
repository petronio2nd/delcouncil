import { expect, test } from 'claude-code/testing'

import {
  barra,
  cotasEmTexto,
  dataCurta,
  folga,
  fraseCota,
  janelasFechadas,
  juntarMax,
  leiturasDoMax,
  lerHistorico,
  lerMax,
  linhasCota,
  maxAbandonado,
  mesclarMax,
  montarCotas,
  nomeLimite,
  perdas,
  pontosDoHistorico,
  proximaFonte,
  quandoVolta,
  rotulo,
  situacao,
  tempoPassado,
  topoCotas,
} from './cotas'
import { ha } from './leitura'
import type { Cota } from '../types'

const H = 3_600_000
// Datas no fuso de quem roda o teste, como o painel mostra.
const em = (mes: number, dia: number, hora = 0) => new Date(2026, mes - 1, dia, hora).getTime()
const AGORA = em(10, 26, 12)

const retrato = (t: number, fontes: Array<Record<string, unknown>>, semAgy = false) => JSON.stringify({ em: t, semAgy, fontes })
const chatgpt = (usado: number, volta: number) => ({ fonte: 'ChatGPT (OpenCode/Codex)', limite: 'semanal', usado, volta, horas: 168, folga: 3 })

test('lerHistorico: pula linha quebrada e campo estranho, ordena pelo momento da leitura', () => {
  const texto = [
    retrato(em(10, 20), [chatgpt(10, em(10, 23))]),
    '{"em":123,"fontes":[',
    '',
    retrato(em(10, 19), [{ fonte: '', usado: 5 }, { fonte: 'OpenRouter', limite: 'US$ 10,00 (monthly)', usado: '87', volta: null, horas: 744, folga: {} }]),
    'lixo',
  ].join('\r\n')
  const r = lerHistorico(texto)
  expect(r.map(x => x.em)).toEqual([em(10, 19), em(10, 20)])
  expect(r[0]?.fontes).toEqual([{ fonte: 'OpenRouter', limite: 'US$ 10,00 (monthly)', usado: null, volta: null, horas: 744, folga: null }])
})

test('janelasFechadas: o maior uso da janela, reset com segundos de diferença é a mesma janela, teto quando a leitura ficou longe', () => {
  const retratos = lerHistorico([
    // Janela que voltou em 19/10 00h: lida duas vezes, a última 2 h antes do reset.
    retrato(em(10, 17), [chatgpt(20, em(10, 19))]),
    retrato(em(10, 18, 22), [chatgpt(55, em(10, 19) + 40_000)]),
    // Janela que voltou em 26/10 00h: lida uma vez só, 2 dias antes. O perdido é um teto.
    retrato(em(10, 24), [chatgpt(30, em(10, 26))]),
    // Janela aberta (volta em 02/11): não entra.
    retrato(em(10, 26, 11), [chatgpt(1, em(11, 2))]),
    // Leitura depois da volta (retrato velho): não conta.
    retrato(em(10, 27), [chatgpt(99, em(10, 26))]),
    // Janela de 5 h: não entra no perdido.
    retrato(em(10, 26, 1), [{ fonte: 'agy Gemini Models', limite: 'Five Hour Limit Remaining', usado: 10, volta: em(10, 26, 3), horas: 5, folga: 0 }]),
  ].join('\n'))
  const f = janelasFechadas(pontosDoHistorico(retratos), AGORA)
  expect([...f.keys()]).toEqual(['ChatGPT (OpenCode/Codex)|semanal'])
  expect(f.get('ChatGPT (OpenCode/Codex)|semanal')).toEqual([
    { volta: em(10, 26), usado: 30, ultima: em(10, 24), perdido: 70, aprox: true },
    { volta: em(10, 19) + 40_000, usado: 55, ultima: em(10, 18, 22), perdido: 45, aprox: false },
  ])
})

test('juntarMax: guarda o maior uso por janela, não regrava o "visto" a cada varredura, descarta janela passada', () => {
  const volta = new Date(em(10, 30)).toISOString()
  let g = juntarMax([], [{ kind: 'seven_day', percentUsed: 20, resetsAt: volta }, { kind: 'five_hour', percentUsed: 5 }], AGORA)
  expect(g).toEqual([{ kind: 'seven_day', volta: em(10, 30), usado: 20, visto: AGORA }])
  // 4 s depois, mesmo uso: nada muda (o register não grava).
  expect(juntarMax(g, [{ kind: 'seven_day', percentUsed: 20, resetsAt: volta }], AGORA + 4_000)).toEqual(g)
  // O uso subiu: anda. Uso menor (outra leitura arredondada) não baixa.
  g = juntarMax(g, [{ kind: 'seven_day', percentUsed: 35, resetsAt: volta }], AGORA + 8_000)
  expect(g[0]).toEqual({ kind: 'seven_day', volta: em(10, 30), usado: 35, visto: AGORA + 8_000 })
  expect(juntarMax(g, [{ kind: 'seven_day', percentUsed: 30, resetsAt: volta }], AGORA + H)[0]?.usado).toBe(35)
  // Reset já passado não entra.
  expect(juntarMax([], [{ kind: 'seven_day', percentUsed: 1, resetsAt: new Date(AGORA - 1).toISOString() }], AGORA)).toEqual([])
})

test('mesclarMax: duas sessões gravando juntas não perdem janela nem baixam o uso', () => {
  const a = [{ kind: 'seven_day', volta: em(10, 23), usado: 80, visto: em(10, 22) }, { kind: 'seven_day', volta: em(10, 30), usado: 10, visto: AGORA }]
  const b = [{ kind: 'seven_day', volta: em(10, 30) + 1_000, usado: 25, visto: AGORA - H }]
  expect(mesclarMax(a, [], b)).toEqual([
    { kind: 'seven_day', volta: em(10, 23), usado: 80, visto: em(10, 22) },
    { kind: 'seven_day', volta: em(10, 30) + 1_000, usado: 25, visto: AGORA },
  ])
  expect(lerMax([{ kind: 'x', volta: 1, usado: 2, visto: 3 }, { kind: 'y' }, null, 'z'])).toEqual([{ kind: 'x', volta: 1, usado: 2, visto: 3 }])
  expect(lerMax(undefined)).toEqual([])
})

test('folga igual à do recursos.ps1', () => {
  // Semanal com 1 dia para o reset (14% da janela) e 40% usados: sobram 60, faltam 14 → +46.
  expect(folga(40, AGORA + 24 * H, 168, AGORA)).toBe(46)
  expect(folga(90, AGORA + 300 * H, 168, AGORA)).toBe(-90)
})

test('montarCotas e texto: Max ao vivo no topo, perdido das fechadas, não lido e fontes do último retrato', () => {
  const retratos = lerHistorico([
    retrato(em(10, 18, 22), [chatgpt(55, em(10, 19))]),
    retrato(em(10, 25, 20), [chatgpt(88, em(10, 26))]),
    retrato(em(10, 26, 11), [
      { fonte: 'Claude Max', limite: '5 h e semanal', usado: null, volta: null, horas: 5, folga: null },
      chatgpt(1, em(11, 2)),
      { fonte: 'agy', limite: '-', usado: null, volta: null, horas: null, folga: null },
      { fonte: 'API Anthropic (opencode)', limite: 'US$ 100/mês', usado: 84.7, volta: em(11, 1), horas: 744, folga: -2 },
    ], true),
  ].join('\n'))
  const max = [{ kind: 'seven_day', volta: em(10, 23), usado: 60, visto: em(10, 22, 20) }]
  const limites = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(AGORA + 2 * H).toISOString() },
    { kind: 'seven_day', percentUsed: 40, resetsAt: new Date(AGORA + 24 * H).toISOString() },
  ]
  const c = montarCotas(retratos, max, leiturasDoMax(limites, AGORA), AGORA)
  expect(c.lidoEm).toBe(em(10, 26, 11))
  expect(c.maxAoVivo).toBe(true)
  expect(c.cotas.map(x => `${x.fonte}|${nomeLimite(x)}`)).toEqual([
    'Claude Max|semanal', 'Claude Max|5 h', 'ChatGPT (OpenCode/Codex)|semanal', 'agy|', 'API Anthropic (opencode)|US$ 100/mês',
  ])
  expect(perdas(c.cotas[0]!)).toBe('perdeu 23/10 40%')
  expect(perdas(c.cotas[1]!)).toBeUndefined()
  expect(perdas(c.cotas[2]!)).toBe('perdeu 26/10 12% · 19/10 45% · média 29% de 2')
  expect(situacao(c.cotas[0]!)).toBe('usou 40% · volta 27/10 12:00 · folga +46')
  expect(situacao(c.cotas[3]!)).toBe('não lido')
  expect(situacao(c.cotas[4]!)).toBe('usou 85% · volta 01/11 · folga −2')

  const texto = cotasEmTexto(c, AGORA, ha)
  expect(texto.split('\n')[0]).toBe('Cotas  lidas há 1h00 (sem agy)')
  expect(texto).toMatch(/  ChatGPT · semanal — usou 1% · volta 02\/11 00:00 · folga \+3\n      perdeu 26\/10 12%/)
  expect(texto).toMatch(/  agy — não lido/)
  expect(texto).toMatch(/  API · US\$ 100\/mês — usou 85%/)
  expect(texto).not.toMatch(/sem leitura nesta sessão/)

  // Sem leitura ao vivo do Max: a linha vazia do recursos.ps1 não aparece, o aviso sim.
  const semMax = montarCotas(retratos, max, [], AGORA)
  expect(semMax.cotas.some(x => x.fonte === 'Claude Max')).toBe(false)
  expect(cotasEmTexto(semMax, AGORA, ha)).toMatch(/Claude Max: sem leitura nesta sessão/)
})

test('topoCotas: histórico velho ou ausente pede o recursos.ps1', () => {
  const vazio = montarCotas([], [], [], AGORA)
  expect(topoCotas(vazio, AGORA, ha)).toEqual({ texto: 'sem histórico · rode recursos.ps1', velha: true })
  const velho = montarCotas(lerHistorico(retrato(AGORA - 7 * H, [chatgpt(1, em(11, 2))])), [], [], AGORA)
  expect(topoCotas(velho, AGORA, ha)).toEqual({ texto: 'histórico de há 7 h · rode recursos.ps1', velha: true })
})

test('retrato velho do ChatGPT: a hora da medição decide o ≤, não a hora da coleta', () => {
  // Medido 2 dias antes do reset, recolhido 1 h antes dele: o perdido é teto.
  const retratos = lerHistorico(retrato(em(10, 25, 23), [{ ...chatgpt(20, em(10, 26)), medido: em(10, 24) }]))
  expect(retratos[0]?.fontes[0]?.medido).toBe(em(10, 24))
  const f = janelasFechadas(pontosDoHistorico(retratos), AGORA).get('ChatGPT (OpenCode/Codex)|semanal')
  expect(f).toEqual([{ volta: em(10, 26), usado: 20, ultima: em(10, 24), perdido: 80, aprox: true }])
})

test('fuso do retrato: as datas saem no fuso do Windows, qualquer que seja o do mod', () => {
  const utc = Date.UTC(2026, 9, 26, 1, 30)
  expect(dataCurta(utc, true, -180)).toBe('25/10 22:30')
  expect(dataCurta(utc, false, -180)).toBe('25/10')
  expect(dataCurta(utc, true, 0)).toBe('26/10 01:30')
  const r = lerHistorico(JSON.stringify({ em: utc, semAgy: false, fuso: -180, fontes: [chatgpt(5, Date.UTC(2026, 10, 2, 3))] }))
  const c = montarCotas(r, [], [], utc + H)
  expect(c.fuso).toBe(-180)
  expect(cotasEmTexto(c, utc + H, ha)).toMatch(/volta 02\/11 00:00/)
})

test('maxAbandonado: só sai a chave lida, válida e sem gravação há 180 dias', () => {
  const D = 24 * H
  const velha = { kind: 'seven_day', volta: AGORA - 200 * D, usado: 50, visto: AGORA - 201 * D }
  expect(maxAbandonado([velha], AGORA)).toBe(true)
  // Janela vencida, mas gravada há pouco: a sessão está viva.
  expect(maxAbandonado([{ ...velha, visto: AGORA - 10 * D }], AGORA)).toBe(false)
  expect(maxAbandonado([velha, { kind: 'seven_day', volta: AGORA + D, usado: 5, visto: AGORA }], AGORA)).toBe(false)
  // Lixo, vazio ou falha de leitura (undefined) nunca autorizam apagar.
  expect(maxAbandonado('lixo', AGORA)).toBe(false)
  expect(maxAbandonado([], AGORA)).toBe(false)
  expect(maxAbandonado(undefined, AGORA)).toBe(false)
})

test('barra, tempo passado, rótulo e volta em palavras', () => {
  expect(barra(0)).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(barra(44)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(barra(130)).toBe('▰▰▰▰▰▰▰▰▰▰')
  // Semanal com 1 dia para o reset: passaram 86% da janela.
  expect(tempoPassado({ volta: AGORA + 24 * H, horas: 168 }, AGORA)).toBe(86)
  expect(tempoPassado({ volta: null, horas: 168 }, AGORA)).toBeUndefined()
  expect([59, 18, 5, -2, -4, -20].map(f => rotulo({ usado: 10, folga: f }).texto))
    .toEqual(['sobra muito', 'sobra', 'no ritmo', 'no ritmo', 'apertado', 'vai faltar'])
  expect(rotulo({ usado: 100, folga: 0 })).toEqual({ texto: 'esgotada', tom: 'error' })
  expect(rotulo({ usado: null, folga: null }).texto).toBe('não lido')
  const utc = Date.UTC(2026, 9, 26, 15)
  expect(quandoVolta(utc + 3 * H, utc, -180)).toBe('volta 15:00')
  // 29/10/2026 é quinta.
  expect(quandoVolta(Date.UTC(2026, 9, 29, 15), utc, -180)).toBe('volta qui')
  expect(quandoVolta(Date.UTC(2026, 10, 2, 15), utc, -180)).toBe('volta 02/11')
})

test('linhasCota e proximaFonte: o que os painéis desenham', () => {
  const c = montarCotas(lerHistorico(retrato(AGORA - H, [
    chatgpt(4, AGORA + 140 * H),
    { fonte: 'agy Claude and GPT models', limite: 'Five Hour Limit Remaining', usado: 0, volta: AGORA + 2 * H, horas: 5, folga: 40 },
    { fonte: 'agy Claude and GPT models', limite: 'Weekly Limit Remaining', usado: 1, volta: AGORA + 60 * H, horas: 168, folga: 59 },
    { fonte: 'agy', limite: '-', usado: null, volta: null, horas: null, folga: null },
  ])), [], [], AGORA)
  const l = linhasCota(c.cotas[0]!, AGORA)
  expect(l.titulo).toBe('ChatGPT · semanal')
  expect(l.uso).toBe('▱▱▱▱▱▱▱▱▱▱ 4%')
  expect(l.tempo).toMatch(/^▰▰▱{8} 17% · volta /)
  expect(linhasCota(c.cotas[3]!, AGORA)).toEqual({ titulo: 'agy', rotulo: { texto: 'não lido' } })
  const fila = { lidoEm: AGORA, semAgy: false, fila: [
    { fonte: 'OpenRouter', folga: 50, trava: true },
    { fonte: 'agy Claude and GPT models', folga: 59, trava: false },
    { fonte: 'ChatGPT (OpenCode/Codex)', folga: 5, trava: false },
  ] }
  const p = proximaFonte(fila, c)
  // A travada fica de fora; da fonte, a janela mais longa.
  expect(p?.nome).toBe('agy Claude')
  expect(p?.cota?.limite).toBe('Weekly Limit Remaining')
  expect(p?.depois).toBe('ChatGPT')
  expect(proximaFonte(undefined, c)).toBeUndefined()
})

test('nomeLimite', () => {
  expect(nomeLimite({ limite: 'US$ 10,00 (monthly)', horas: 744 })).toBe('US$ 10,00/mês')
  expect(nomeLimite({ limite: 'Gemini 4 Argon Weekly Limit', horas: 168 })).toBe('semanal')
  expect(nomeLimite({ limite: 'five_hour', horas: 5 })).toBe('5 h')
  expect(nomeLimite({ limite: '-', horas: null })).toBe('')
})

test('fraseCota: barra com a marca do tempo e a frase', async () => {
  const agora = Date.UTC(2026, 9, 31, 12)
  const cota = (campos: Partial<Cota>): Cota => ({ fonte: 'agy Gemini Models', limite: 'semanal', usado: 1, volta: agora + 0.24 * 168 * H, horas: 168, folga: 75, fechadas: [], mediaDe: 0, mediaAprox: false, ...campos })
  const f = fraseCota(cota({}), agora, 0)
  expect(f.barra?.map(b => b.texto).join('')).toBe('▱▱▱▱▱▱▱▱│▱▱')
  expect(f.frase).toBe('Cota semanal quase toda livre: usou 1%, e 76% da semana já passou (│). Renova segunda.')
  const meia = fraseCota(cota({ usado: 42, volta: agora + 10 * H }), agora, 0)
  expect(meia.barra).toEqual([{ texto: '▰▰▰▰', tipo: 'cheia' }, { texto: '▱▱▱▱▱', tipo: 'vazia' }, { texto: '│', tipo: 'marca' }, { texto: '▱', tipo: 'vazia' }])
  expect(meia.frase).toBe('Cota semanal com mais da metade livre: usou 42%, e 94% da semana já passou (│). Renova às 22:00.')
  expect(fraseCota(cota({ usado: 70, horas: 5, limite: '5 h', volta: agora + 4 * H }), agora, 0).frase).toMatch(/^Cota de 5 h com 30% livre: usou 70%, e 20% da janela já passou/)
  expect(fraseCota(cota({ usado: 100, horas: 720, limite: 'mensal', volta: agora + 10 * 24 * H }), agora, 0).frase).toMatch(/^Cota do mês esgotada: usou 100%, e \d+% do mês já passou \(│\)\. Renova em \d\d\/\d\d\.$/)
  // 99,6% ainda não esgotou: a frase segue o rótulo, que só diz "esgotada" em 100%.
  expect(fraseCota(cota({ usado: 99.6 }), agora, 0).frase).toMatch(/^Cota semanal quase esgotada: usou 100%/)
  const semVolta = fraseCota(cota({ volta: null }), agora, 0)
  expect(semVolta.frase).toBe('Cota semanal quase toda livre: usou 1%.')
  expect(semVolta.barra?.map(b => b.texto).join('')).toBe('▱▱▱▱▱▱▱▱▱▱')
  expect(fraseCota(cota({ usado: null }), agora, 0)).toEqual({ frase: 'Cota não lida.' })
})
