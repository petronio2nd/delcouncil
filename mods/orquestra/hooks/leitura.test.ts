import { expect, test } from 'claude-code/testing'

import {
  agruparTrabalhos,
  arquivosParaLer,
  assuntoDaPasta,
  casaProjeto,
  descendentes,
  estado,
  estadoTrabalho,
  faixaFila,
  ha,
  iconeTrabalho,
  juntarRodadas,
  lerModelo,
  lerTentativa,
  lerFila,
  lerSessao,
  lerVeredito,
  linha,
  linhaModelo,
  mapaEmTexto,
  nomeDoRemoto,
  nomeModelo,
  nomeCurto,
  nomeFonte,
  nomeProximo,
  nomeQuem,
  ordenarTrabalhos,
  prefixosDaPasta,
  quemRoda,
  ramos,
  resumoTrabalho,
  rotuloRodada,
  tituloTrabalho,
  trabalhosDaPasta,
  type Sessao,
} from './leitura'
import type { Trabalho } from '../types'

const sessao = (id: string, mae?: string, criada = 1): Sessao => ({
  id,
  cli: id,
  titulo: `⚙️ ${id}`,
  modelo: 'claude-sonnet-5-5',
  esforco: 'high',
  arquivada: false,
  criada,
  mae,
})

test('lê o arquivo de sessão do app', async () => {
  const texto = JSON.stringify({
    sessionId: 'local_b',
    cliSessionId: 'cli-b',
    cwd: 'D:\\codigos\\projeto-teste',
    createdAt: 10,
    model: 'claude-haiku-5-5',
    effort: 'medium',
    isArchived: false,
    title: '👍 filha: ok p/ commit',
    spawnedFrom: { sessionId: 'local_a', taskId: 'task_1', title: 'x' },
    remoteMcpServersConfig: [{ name: 'muito texto' }],
  })
  expect(lerSessao(texto)).toEqual({
    id: 'local_b',
    cli: 'cli-b',
    titulo: '👍 filha: ok p/ commit',
    modelo: 'claude-haiku-5-5',
    esforco: 'medium',
    arquivada: false,
    criada: 10,
    mae: 'local_a',
    pasta: 'D:\\codigos\\projeto-teste',
  })
  expect(lerSessao('{"nada": 1}')).toBeUndefined()
  expect(lerSessao('não é json')).toBeUndefined()
})

test('estado pelo emoji do título', async () => {
  expect(estado('⚙️ rodando ocr')).toEqual({ emoji: '⚙️', rotulo: 'trabalhando', esperaUsuario: false })
  expect(estado('👍 commit e ok').esperaUsuario).toBe(true)
  expect(estado('▶️ faxina: rodar 3 passos')).toEqual({ emoji: '▶️', rotulo: 'espera ação sua', esperaUsuario: true })
  expect(estado('▶ sem seletor de variação').emoji).toBe('▶')
  expect(estado('🧠 decidir').rotulo).toBe('espera decisão')
  expect(estado('🔥 projeto 28/09: pdf').esperaUsuario).toBe(true)
  expect(estado('🗄️ logo').esperaUsuario).toBe(false)
  expect(estado('👍 qualquer', true)).toEqual({ emoji: '🗄️', rotulo: 'arquivada', esperaUsuario: false })
  expect(estado('Título gerado pelo app').emoji).toBe('·')
})

test('nome do modelo', async () => {
  expect(nomeModelo('claude-opus-5-5')).toBe('Opus 5.5')
  expect(nomeModelo('claude-haiku-5')).toBe('Haiku 5')
  expect(nomeModelo('gpt-6-astra')).toBe('gpt-6-astra')
})

test('descendentes em ordem de criação, netas indentadas, estranhas fora', async () => {
  const lista = [sessao('a'), sessao('c', 'a', 3), sessao('b', 'a', 2), sessao('b1', 'b', 4), sessao('x', 'outra', 5)]
  expect(descendentes('a', lista).map(d => `${d.nivel}:${d.s.id}`)).toEqual(['1:b', '2:b1', '1:c'])
})

test('pasta da dupla casa com o projeto', async () => {
  expect(casaProjeto('projeto-20261019-sessao', ['projeto'])).toBe(true)
  expect(casaProjeto('projeto2-20261019', ['projeto'])).toBe(false)
  expect(casaProjeto('claude-mods-20261013-1453', ['mods', 'claude-mods'])).toBe(true)
  expect(casaProjeto('qualquer', [''])).toBe(false)
  expect(nomeDoRemoto('https://github.com/dono/claude-mods.git')).toBe('claude-mods')
  expect(nomeDoRemoto('git@github.com:dono/Projeto-X.git')).toBe('projeto-x')
  expect(nomeDoRemoto(null)).toBeUndefined()
})

test('quem roda, pelo .cmd', async () => {
  const codex =
    '@echo off\r\nchcp 65001 > nul\r\n"C:\\fake\\codex.exe" exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s read-only -o "x\\revisao.md" "Siga a skill revisor."'
  expect(quemRoda(codex)).toBe('codex gpt-6-astra xhigh')
  expect(quemRoda('cd /d "D:\\p" && "C:\\fake\\agy\\bin\\agy.exe" -p "Leia"')).toBe('agy')
  expect(quemRoda('powershell -File "D:\\s\\openrouter.ps1" -Pasta "D:\\p" -Modelo "meta/muse-2"')).toBe('openrouter meta/muse-2')
  expect(quemRoda(undefined)).toBe('?')
})

test('veredito: só a palavra, sem o resto da linha', async () => {
  expect(lerVeredito('## Veredito\n\nrefazer — a trava permite renovações simultâneas.')).toBe('refazer')
  expect(lerVeredito('## Veredito\n\naprovado com correções — falta o STATUS.md.')).toBe('aprovado com correções')
  expect(lerVeredito('## Veredito\n\n**aprovado**. Tudo certo.')).toBe('aprovado')
  expect(lerVeredito('aprovado - sem achados')).toBe('aprovado')
  expect(lerVeredito('')).toBe('?')
})

test('quem roda: OpenCode com modelo openai ou anthropic', async () => {
  const inicio = '@echo off\r\nset "OPENCODE_CONFIG=local"\r\nchcp 65001\r\ncd /d "D:\\proj" && '
  expect(quemRoda(inicio + '"C:\\fake\\opencode-cli.exe" run --standalone --auto --format json -m openai/gpt-6-astra#xhigh --title "dupla revisar proj" --file "entrada.md" "prompt"')).toBe('opencode openai/gpt-6-astra#xhigh')
  expect(quemRoda(inicio + '"C:\\fake\\opencode-cli.exe" run --standalone --auto --format json -m anthropic/claude-sonnet-5-5#high --title "dupla revisar proj" --file "entrada.md" "prompt"')).toBe('opencode anthropic/claude-sonnet-5-5#high')
  expect(quemRoda('opencode-cli run -m "openai/gpt-6-sol#high"')).toBe('opencode openai/gpt-6-sol#high')
})

test('arquivar do OpenCode não vira trabalho nem arquivo para ler', async () => {
  const cmd = '"C:\\fake\\opencode-cli.exe" api patch /session/abc --body "arquivo"'
  const arquivos = [{ nome: 'revisao.md.arquivar.cmd', mtime: 1 }]
  expect(quemRoda(cmd)).toBe('?')
  expect(trabalhosDaPasta('proj', arquivos, { 'revisao.md.arquivar.cmd': cmd }, 1)).toEqual([])
  expect(arquivosParaLer(arquivos)).toEqual([])
})

const casosModelo: ReadonlyArray<[string, string, string, boolean]> = [
  ['igual', 'openai/gpt-6-sol#high', 'openai/gpt-6-sol#high', false],
  ['diferente no modelo', 'openai/gpt-6-sol#high', 'openai/gpt-6-astra#high', true],
  ['diferente só na variante', 'openai/gpt-6-sol#high', 'openai/gpt-6-sol#xhigh', true],
  ['sem variante no real', 'openai/gpt-6-sol#high', 'openai/gpt-6-sol', false],
  ['sem variante no pedido', 'openai/gpt-6-sol', 'openai/gpt-6-sol#high', false],
  ['sem variantes e modelo diferente', 'openai/gpt-6-sol', 'openai/gpt-6-astra', true],
  ['não lido', 'openai/gpt-6-sol#high', 'não lido', false],
  ['não informado', 'claude-sonnet-5-5-high', 'não informado', false],
]
for (const [nome, pedido, real, difere] of casosModelo) {
  test(`lerModelo: ${nome}`, async () => {
    expect(lerModelo(`\uFEFFpedido: ${pedido}\r\nreal: ${real}\r\n`)).toEqual({ pedido, real, difere })
  })
}

test('lerModelo: texto inválido', async () => {
  for (const texto of ['', 'qualquer texto', 'pedido: x', 'real: x', 'pedido: \nreal: x', 'pedido: x\nreal: ']) {
    expect(lerModelo(texto)).toBeUndefined()
  }
})

test('trabalhos e resumo com modelo pedido × real, com e sem .cmd', async () => {
  const textos = {
    'revisao.md.cmd': '"C:\\fake\\opencode-cli.exe" run -m openai/gpt-6-astra#xhigh',
    'revisao.md': '## Veredito\n\naprovado com correções',
    'revisao.md.modelo': 'pedido: openai/gpt-6-sol#high\nreal: openai/gpt-6-astra#xhigh',
    'relatorio.md.cmd': 'opencode-cli run -m anthropic/claude-sonnet-5-5#high',
    'relatorio.md': 'relatório',
    'relatorio.md.modelo': 'pedido: anthropic/claude-sonnet-5-5#high\nreal: anthropic/claude-sonnet-5-5#high',
  }
  for (const comCmd of [true, false]) {
    const arquivos = ['pacote.md', 'tarefa.md', ...Object.keys(textos)]
      .filter(n => comCmd || !n.endsWith('.cmd'))
      .map(nome => ({ nome, mtime: 1 }))
    expect(arquivosParaLer(arquivos).sort()).toEqual([
      'relatorio.md.modelo', 'revisao.md', 'revisao.md.modelo',
      ...(comCmd ? ['relatorio.md.cmd', 'revisao.md.cmd'] : []),
    ].sort())
    const trabalhos = trabalhosDaPasta('proj', arquivos, textos, 1)
    expect(trabalhos.length).toBe(2)
    const revisao = trabalhos.find(t => t.saida === 'revisao.md')!
    const relatorio = trabalhos.find(t => t.saida === 'relatorio.md')!
    expect([revisao.pedido, revisao.real, revisao.difere]).toEqual(['openai/gpt-6-sol#high', 'openai/gpt-6-astra#xhigh', true])
    expect([relatorio.pedido, relatorio.real, relatorio.difere]).toEqual(['anthropic/claude-sonnet-5-5#high', 'anthropic/claude-sonnet-5-5#high', false])
    expect(resumoTrabalho(revisao)).toBe(`revisão · ${comCmd ? 'opencode Astra 6 xhigh' : 'quem?'} · aprovado com correções`)
    expect(resumoTrabalho(relatorio)).toBe(`execução · ${comCmd ? 'opencode Sonnet 5.5 high' : 'quem?'} · relatório pronto`)
    expect(iconeTrabalho(revisao)).toBe('⚠️')
    expect(iconeTrabalho(relatorio)).toBe('✅')
    for (const veredito of ['refazer', 'reprovado']) {
      expect(iconeTrabalho({ ...revisao, veredito })).toBe('❌')
    }
    expect(iconeTrabalho({ ...revisao, difere: false })).toBe('☑️')
    const pendentes = trabalhosDaPasta('proj', arquivos.filter(a => !['revisao.md', 'relatorio.md'].includes(a.nome)), textos, 1)
    expect(pendentes.map(t => [t.estado, t.difere])).toEqual([
      [comCmd ? 'rodando' : 'esperando', true],
      [comCmd ? 'rodando' : 'esperando', false],
    ])
  }
})

test('trabalhos de uma pasta da dupla', async () => {
  const agora = 100 * 60_000
  const arquivos = [
    { nome: 'pacote.md', mtime: agora - 50 * 60_000 },
    { nome: 'revisao.md.cmd', mtime: agora - 49 * 60_000 },
    { nome: 'revisao.md', mtime: agora - 45 * 60_000 },
    { nome: 'pacote2.md', mtime: agora - 3 * 60_000 },
    { nome: 'revisao2.md.cmd', mtime: agora - 2 * 60_000 },
    { nome: 'revisao2.md.log', mtime: agora - 60_000 },
    { nome: 'pacote3.md', mtime: agora - 60_000 },
  ]
  const textos = {
    'revisao.md.cmd': '"C:\\fake\\codex.exe" exec -m gpt-6-astra -c model_reasoning_effort=high',
    'revisao.md': '## Veredito\n\nrefazer — detalhe do projeto',
    'revisao2.md.cmd': '"C:\\fake\\codex.exe" exec -m gpt-6-astra -c model_reasoning_effort=xhigh',
  }
  expect(arquivosParaLer(arquivos).sort()).toEqual(['revisao.md', 'revisao.md.cmd', 'revisao2.md.cmd'])
  const lista = ordenarTrabalhos(trabalhosDaPasta('proj-1', arquivos, textos, agora))
  expect(lista.map(t => [t.saida, t.estado, t.quem, t.veredito])).toEqual([
    ['revisao2.md', 'rodando', 'codex gpt-6-astra xhigh', undefined],
    ['revisao3.md', 'esperando', '?', undefined],
    ['revisao.md', 'feito', 'codex gpt-6-astra high', 'refazer'],
  ])
})

test('execução do codex: tarefa, relatório, e log parado', async () => {
  const agora = 200 * 60_000
  const arquivos = [
    { nome: 'tarefa.md', mtime: agora - 90 * 60_000 },
    { nome: 'relatorio.md.cmd', mtime: agora - 89 * 60_000 },
    { nome: 'relatorio.md.log', mtime: agora - 80 * 60_000 },
  ]
  const [t] = trabalhosDaPasta('proj-codex-x', arquivos, { 'relatorio.md.cmd': '"C:\\f\\codex.exe" exec -m gpt-6-luna' }, agora)
  expect(t).toEqual({ pasta: 'proj-codex-x', saida: 'relatorio.md', tipo: 'execução', quem: 'codex gpt-6-luna', estado: 'parado', desde: agora - 89 * 60_000 })
  const pronto = trabalhosDaPasta('p', [...arquivos, { nome: 'relatorio.md', mtime: agora }], {}, agora)
  expect(pronto.map(x => [x.estado, x.veredito])).toEqual([['feito', 'relatório pronto']])
  const outros = trabalhosDaPasta('p', [{ nome: 'cx-relatorio.md.cmd', mtime: agora }, { nome: 'agy-a.md.cmd', mtime: agora }], {}, agora)
  expect(outros.map(x => x.tipo)).toEqual(['execução', 'execução'])
})

test('prefixos da pasta', async () => {
  expect(prefixosDaPasta('D:\\codigos\\projeto-exemplo')).toEqual(['projeto-exemplo', 'exemplo'])
  expect(prefixosDaPasta('C:\\Users\\x\\.claude\\mods\\')).toEqual(['mods'])
  expect(prefixosDaPasta('')).toEqual([])
})

test('mapa em texto, com o que espera o usuário no topo e "há ≥" na primeira leitura', async () => {
  const agora = 10 * 60_000
  const mae = linha({ ...sessao('local_a'), titulo: '⚙️ teste: orquestrando', modelo: 'claude-opus-5-5' }, agora - 5 * 60_000, 0, true)
  const filha = linha({ ...sessao('local_b', 'local_a'), titulo: '👍 filha: ok p/ commit' }, agora - 2 * 60_000, 1)
  const texto = mapaEmTexto(
    {
      raiz: mae,
      filhas: [filha],
      trabalhos: [{ pasta: 'teste-1', saida: 'revisao.md', tipo: 'revisão', quem: 'codex gpt-6-astra high', estado: 'rodando', desde: agora }],
      lidoEm: agora,
    },
    agora,
  )
  expect(texto).toBe(
    [
      'Esperando você (1)',
      '  👍 filha: ok p/ commit — espera seu OK · Sonnet 5.5 high · há 2 min',
      '',
      'Sessões',
      '⚙️ teste: orquestrando (esta) — trabalhando · Opus 5.5 high · há ≥ 5 min',
      '  👍 filha: ok p/ commit — espera seu OK · Sonnet 5.5 high · há 2 min',
      '',
      'Executores e revisões',
      '  teste-1',
      '    ⏳ revisão · codex Astra 6 high · rodando',
      '      revisao.md · agora',
    ].join('\n'),
  )
})

test('há quanto tempo', async () => {
  expect(ha(10_000)).toBe('agora')
  expect(ha(5 * 60_000)).toBe('há 5 min')
  expect(ha(125 * 60_000)).toBe('há 2h05')
  expect(ha(50 * 3_600_000)).toBe('há 2 d')
})

const trabalho = (campos: Partial<Trabalho> = {}): Trabalho => ({
  pasta: 'a', saida: 'revisao.md', tipo: 'revisão', quem: '?', estado: 'feito', desde: 0, ...campos,
})

test('nomeCurto: OpenCode, Claude, agy e desconhecido', async () => {
  const casos = [
    ['openai/gpt-6.1-sol#medium', 'Sol 6.1 medium'],
    ['openai/gpt-6-astra#xhigh', 'Astra 6 xhigh'],
    ['anthropic/claude-sonnet-5-5#high', 'Sonnet 5.5 high'],
    ['claude-sonnet-5-5-high', 'Sonnet 5.5 high'],
    ['gemini-4-argon-high', 'Gemini 4 Argon high'],
    ['gemini-3.5-flash-medium', 'Gemini 3.5 Flash medium'],
    ['outro/modelo#high', 'outro/modelo#high'],
  ]
  for (const [id, nome] of casos) expect(nomeCurto(id)).toBe(nome)
  expect(resumoTrabalho(trabalho({ quem: 'agy gemini-4-argon-high' }))).toBe('revisão · agy Gemini 4 Argon high · feito')
  expect(resumoTrabalho(trabalho({ quem: 'opencode openai/gpt-6.1-sol#medium' }))).toBe('revisão · opencode Sol 6.1 medium · feito')
})

test('tituloTrabalho e estadoTrabalho: quem sem esforço, estado em palavras com cor', async () => {
  expect(tituloTrabalho(trabalho({ quem: 'opencode openai/gpt-6-astra#xhigh' }))).toBe('Revisão do GPT Astra 6')
  expect(tituloTrabalho(trabalho({ quem: 'agy gemini-4-argon-high' }))).toBe('Revisão do agy Gemini 4 Argon')
  expect(tituloTrabalho(trabalho({ tipo: 'execução', quem: 'opencode anthropic/claude-sonnet-5-5#high' }))).toBe('Execução no Sonnet 5.5')
  expect(tituloTrabalho(trabalho({ tipo: 'execução', quem: 'agy' }))).toBe('Execução no agy')
  expect(tituloTrabalho(trabalho())).toBe('Revisão do quem?')
  const H = 3_600_000
  expect(estadoTrabalho(trabalho({ estado: 'rodando', desde: 0 }), 12 * 60_000)).toEqual({ texto: 'rodando · 12 min' })
  expect(estadoTrabalho(trabalho({ estado: 'parado' }), H).tom).toBe('warning')
  expect(estadoTrabalho(trabalho({ estado: 'esperando', tipo: 'execução' }), H)).toEqual({ texto: 'executor não chamado', tom: 'warning' })
  expect(estadoTrabalho(trabalho({ veredito: 'refazer' }), H)).toEqual({ texto: 'pediu refazer', tom: 'error' })
  expect(estadoTrabalho(trabalho({ veredito: 'não comprovado' }), H).tom).toBe('warning')
  expect(estadoTrabalho(trabalho({ veredito: 'aprovado com correções' }), H)).toEqual({ texto: 'aprovado com correções', tom: 'success' })
  expect(estadoTrabalho(trabalho({ tipo: 'execução', veredito: 'relatório pronto' }), H)).toEqual({ texto: 'relatório pronto' })
})

for (const [nome, real, difere, esperado] of [
  ['igual', 'openai/gpt-6.1-sol#medium', false, 'modelo Sol 6.1 medium'],
  ['difere', 'openai/gpt-6-astra#xhigh', true, 'modelo Astra 6 xhigh ⚠️ pedido Sol 6.1 medium'],
  ['não informado', 'não informado', false, 'modelo Sol 6.1 medium (real não informado)'],
  ['não lido', 'não lido', false, 'modelo Sol 6.1 medium (real não lido)'],
  ['sem real', undefined, false, undefined],
] as const) {
  test(`linhaModelo: ${nome}`, async () => {
    expect(linhaModelo(trabalho({ pedido: 'openai/gpt-6.1-sol#medium', real, difere }))).toBe(esperado)
  })
}

test('lerFila: válido e inválido', async () => {
  const fila = { lidoEm: 100, semAgy: true, fila: [{ fonte: 'API', folga: -5, trava: false }] }
  expect(lerFila('\uFEFF' + JSON.stringify(fila))).toEqual(fila)
  for (const texto of ['x', 'null', '[]', '{}', JSON.stringify({ ...fila, lidoEm: '100' }), JSON.stringify({ ...fila, semAgy: 1 }), JSON.stringify({ ...fila, fila: [null] }), JSON.stringify({ ...fila, fila: [{ fonte: 'API', folga: '5', trava: false }] }), JSON.stringify({ ...fila, fila: [{ fonte: 'API', folga: 5 }] })]) {
    expect(lerFila(texto)).toBeUndefined()
  }
})

test('nomeFonte: rótulos curtos e desconhecido', async () => {
  for (const [fonte, nome] of [
    ['agy Claude and GPT models', 'agy Claude'], ['agy Gemini 4 Argon', 'Argon'],
    ['agy Gemini Models', 'agy Gemini'], ['ChatGPT (OpenCode/Codex)', 'ChatGPT'],
    ['API Anthropic (opencode)', 'API'], ['OpenRouter', 'OpenRouter'], ['outra', 'outra'],
  ]) expect(nomeFonte(fonte)).toBe(nome)
})

test('faixaFila: ordem, sinal, trava, semAgy e velha', async () => {
  const f = { lidoEm: 0, semAgy: false, fila: [
    { fonte: 'agy Claude and GPT models', folga: 45, trava: false },
    { fonte: 'agy Gemini 4 Argon', folga: 5, trava: false },
    { fonte: 'ChatGPT (OpenCode/Codex)', folga: 4, trava: false },
    { fonte: 'API Anthropic (opencode)', folga: -5, trava: false },
  ] }
  expect(faixaFila(f, 180_000).texto).toBe('Fila  agy Claude +45 › Argon +5 › ChatGPT +4 › API −5   há 3 min')
  expect(faixaFila(f, 180_000).velha).toBe(false)
  expect(faixaFila({ ...f, semAgy: true, fila: [{ fonte: 'OpenRouter', folga: 0, trava: true }] }, 180_000).texto).toBe('Fila  OpenRouter +0 🔒   há 3 min (sem agy)')
  expect(faixaFila(f, 6 * 3_600_000).velha).toBe(false)
  const velha = faixaFila({ ...f, semAgy: true }, 7 * 3_600_000)
  expect(velha.velha).toBe(true)
  expect(velha.texto).toMatch(/fila de há 7 h · rode recursos.ps1 \(sem agy\)$/)
})

test('agruparTrabalhos: duas pastas, antigos resumidos, alerta e refazer ficam', async () => {
  const agora = 2 * 3_600_000
  const lista = [
    trabalho({ pasta: 'a' }), trabalho({ pasta: 'b', estado: 'rodando' }),
    trabalho({ pasta: 'a', difere: true }), trabalho({ pasta: 'a', veredito: 'refazer' }),
    trabalho({ pasta: 'b', estado: 'parado' }), trabalho({ pasta: 'a', estado: 'esperando' }),
    trabalho({ pasta: 'b', desde: agora - 3_600_000 }), trabalho({ pasta: 'a', veredito: 'reprovado' }),
  ]
  const grupos = agruparTrabalhos(lista, agora)
  expect(grupos.map(g => [g.pasta, g.antigos, g.trabalhos.length])).toEqual([['b', 0, 3], ['a', 1, 4]])
  expect(grupos[1].trabalhos.map(t => t.estado)).toEqual(['esperando', 'feito', 'feito', 'feito'])
  expect(lista.length).toBe(8)
  expect(agruparTrabalhos([], agora)).toEqual([])
})

test('veredito não comprovado: ícone próprio e não some entre os antigos', async () => {
  const t = trabalho({ veredito: 'não comprovado' })
  expect(iconeTrabalho(t)).toBe('❔')
  expect(iconeTrabalho({ ...t, veredito: 'refazer' })).toBe('❌')
  expect(lerVeredito('## Veredito\nnão comprovado — falta rodar o teste')).toBe('não comprovado')
  const [grupo] = agruparTrabalhos([t], 2 * 3_600_000)
  expect([grupo.antigos, grupo.trabalhos.length]).toEqual([0, 1])
})

test('mapa em texto: tentativas e cópia final numa linha só, sem "quem?"', async () => {
  const tent = (n: number, campos: Partial<Trabalho>) => trabalho({ pasta: 'mods-m2', saida: `revisao.md.tentativa-${n}-gpt.md`, rodada: 'revisao.md', tentativa: n, familia: 'gpt', quem: 'codex gpt-6-astra xhigh', ...campos })
  const agora = 30 * 60_000
  const texto = mapaEmTexto({ filhas: [], trabalhos: [
    tent(1, { veredito: 'refazer', desde: 60_000 }), tent(2, { veredito: 'aprovado', desde: 120_000 }),
    trabalho({ pasta: 'mods-m2', veredito: 'aprovado com correções', desde: 180_000 }),
  ], lidoEm: 0 }, agora)
  expect(texto).toMatch(/  mods-m2\n    ☑️ revisão · codex Astra 6 xhigh · aprovado com correções\n      revisao\.md\.tentativa-2-gpt\.md · há 27 min$/)
  expect(texto).not.toMatch(/quem\?|refazer|tentativa-1/)
})

test('mapa em texto: fila no topo, modelo recuado e antigos por pasta', async () => {
  const texto = mapaEmTexto({ filhas: [], trabalhos: [
    trabalho(), trabalho({ saida: 'nova.md', difere: true, pedido: 'openai/gpt-6.1-sol#medium', real: 'openai/gpt-6-astra#xhigh' }),
  ], fila: { lidoEm: 0, semAgy: false, fila: [{ fonte: 'OpenRouter', folga: 1, trava: false }] }, lidoEm: 0 }, 2 * 3_600_000)
  expect(texto.startsWith('Fila  OpenRouter +1')).toBe(true)
  expect(texto).toMatch(/  a\n    ⚠️ revisão · quem\? · feito\n      modelo Astra 6 xhigh ⚠️ pedido Sol 6.1 medium\n      nova.md/)
  expect(texto).toMatch(/\+1 feitos há mais de 1 h/)
  expect(texto).not.toMatch(/revisao.md/)
})

test('tentativas: a rodada, o número e a família pelo nome da saída', async () => {
  expect(lerTentativa('revisao2.md.tentativa-1-gpt.md')).toEqual({ rodada: 'revisao2.md', tentativa: 1, familia: 'gpt' })
  expect(lerTentativa('gpt-review.md.tentativa-12-Claude.md')).toEqual({ rodada: 'gpt-review.md', tentativa: 12, familia: 'claude' })
  for (const n of ['revisao.md', 'revisao.md.tentativa-1-gpt.md.cmd', 'revisao.md.tentativa-x-gpt.md']) expect(lerTentativa(n)).toBeUndefined()
})

test('tentativa com .cmd tira o falso "revisor não chamado"; sem .cmd vira trabalho feito', async () => {
  const arquivos = [
    { nome: 'pacote2.md', mtime: 1 },
    { nome: 'revisao2.md.tentativa-1-gpt.md.cmd', mtime: 2 },
    { nome: 'revisao2.md.tentativa-1-gpt.md', mtime: 3 },
    { nome: 'pacote3.md', mtime: 4 },
    { nome: 'revisao3.md.tentativa-1-claude.md', mtime: 5 },
    { nome: 'pacote4.md', mtime: 6 },
  ]
  const textos = {
    'revisao2.md.tentativa-1-gpt.md.cmd': 'codex exec -m gpt-6-astra',
    'revisao2.md.tentativa-1-gpt.md': '## Veredito\naprovado',
    'revisao3.md.tentativa-1-claude.md': '## Veredito\nnão comprovado',
  }
  expect(arquivosParaLer(arquivos).sort()).toEqual(['revisao2.md.tentativa-1-gpt.md', 'revisao2.md.tentativa-1-gpt.md.cmd', 'revisao3.md.tentativa-1-claude.md'])
  const lista = trabalhosDaPasta('p', arquivos, textos, 10)
  expect(lista.map(t => [t.saida, t.estado, t.rodada, t.familia, t.veredito])).toEqual([
    ['revisao2.md.tentativa-1-gpt.md', 'feito', 'revisao2.md', 'gpt', 'aprovado'],
    ['revisao3.md.tentativa-1-claude.md', 'feito', 'revisao3.md', 'claude', 'não comprovado'],
    ['revisao4.md', 'esperando', undefined, undefined, undefined],
  ])
  expect(resumoTrabalho(lista[1]!)).toBe('revisão · Claude · não comprovado')
})

test('juntarRodadas: uma linha por rodada, com o estado mais novo', async () => {
  const t = (campos: Partial<Trabalho>) => trabalho({ pasta: 'p', ...campos })
  const tent = (n: number, campos: Partial<Trabalho>) => t({ saida: `revisao.md.tentativa-${n}-gpt.md`, rodada: 'revisao.md', tentativa: n, familia: 'gpt', quem: 'codex gpt-6-astra', ...campos })
  // A cópia final depois da última tentativa dá o veredito; quem rodou vem da tentativa.
  const [final] = juntarRodadas([tent(1, { veredito: 'refazer', desde: 1 }), tent(2, { veredito: 'aprovado', desde: 3 }), t({ veredito: 'aprovado com correções', desde: 4 })])
  expect([final!.saida, final!.quem, final!.tentativa, final!.veredito, final!.desde]).toEqual(['revisao.md.tentativa-2-gpt.md', 'codex gpt-6-astra', 2, 'aprovado com correções', 4])
  // Uma tentativa nova rodando vence a cópia final antiga.
  const [rodando] = juntarRodadas([t({ veredito: 'refazer', desde: 1 }), tent(2, { estado: 'rodando', desde: 2 })])
  expect([rodando!.estado, rodando!.tentativa]).toEqual(['rodando', 2])
  // Tentativa terminada depois da cópia: o veredito é o dela.
  const [nova] = juntarRodadas([t({ veredito: 'refazer', desde: 1 }), tent(2, { veredito: 'aprovado', desde: 2 })])
  expect(nova!.veredito).toBe('aprovado')
  // Revisão cruzada: uma linha por família, e o "refazer" do GPT não some atrás do "aprovado" do Gemini.
  const gemini = t({ saida: 'revisao.md.tentativa-1-gemini.md', rodada: 'revisao.md', tentativa: 1, familia: 'gemini', veredito: 'aprovado', desde: 5 })
  const cruzada = juntarRodadas([tent(1, { veredito: 'refazer', desde: 2 }), gemini, t({ veredito: 'aprovado', desde: 6 })])
  expect(cruzada.map(x => [x.familia, x.veredito])).toEqual([['gpt', 'refazer'], ['gemini', 'aprovado']])
  // Pastas e rodadas diferentes não se juntam; sem tentativa, nada muda.
  const soltos = [t({ saida: 'revisao2.md' }), t({ pasta: 'q' }), t({})]
  expect(juntarRodadas(soltos)).toEqual(soltos)
})

test('assunto da pasta: sem projeto, data nem executor', async () => {
  const p = ['mods', 'projeto-teste', 'teste']
  for (const [pasta, assunto] of [
    ['mods-m2-agy-20261031-1412', 'm2'],
    ['mods-fable-20261031-133026', 'fable'],
    ['mods-20261031-reparo-rotas', 'reparo-rotas'],
    ['projeto-teste-codex-login-20261019', 'login'],
    ['projeto-teste-20261019-1200', 'projeto-teste'],
    ['outra-coisa-20261019', 'outra-coisa'],
    ['mods-issue-1234-20261031-1412', 'issue-1234'],
    ['mods-painel-sol-20261031', 'painel-sol'],
  ]) expect(assuntoDaPasta(pasta!, p)).toBe(assunto)
})

test('rotuloRodada, nomeQuem e nomeProximo', async () => {
  expect(rotuloRodada(trabalho())).toBe('rodada 1')
  expect(rotuloRodada(trabalho({ saida: 'revisao2.md.tentativa-1-gpt.md', rodada: 'revisao2.md' }))).toBe('rodada 2')
  expect(rotuloRodada(trabalho({ saida: 'gpt-review.md.tentativa-1-gpt.md', rodada: 'gpt-review.md' }))).toBe('gpt-review')
  expect(rotuloRodada(trabalho({ tipo: 'execução', saida: 'relatorio3.md' }))).toBe('execução 3')
  expect(nomeQuem(trabalho())).toBeUndefined()
  expect(nomeQuem(trabalho({ familia: 'gpt' }))).toBe('GPT')
  expect(nomeQuem(trabalho({ familia: 'kimi' }))).toBe('Kimi')
  expect(nomeQuem(trabalho({ quem: 'claude fable' }))).toBe('Fable')
  expect(nomeQuem(trabalho({ quem: 'codex gpt-6-astra xhigh' }))).toBe('GPT Astra 6')
  expect(nomeQuem(trabalho({ quem: 'agy gemini-4-argon-high' }))).toBe('agy Gemini 4 Argon')
  expect(nomeQuem(trabalho({ quem: 'agy' }))).toBe('agy')
  expect(tituloTrabalho(trabalho({ quem: 'claude fable' }))).toBe('Revisão do Fable')
  expect(nomeProximo('agy Gemini')).toBe('Gemini (agy)')
  expect(nomeProximo('ChatGPT')).toBe('ChatGPT')
})

test('ramos da árvore de sessões', async () => {
  expect(ramos([])).toEqual([])
  expect(ramos([1, 1])).toEqual(['├─ ', '└─ '])
  expect(ramos([1, 2, 2, 1, 2])).toEqual(['├─ ', '│  ├─ ', '│  └─ ', '└─ ', '   └─ '])
  expect(ramos([1, 2, 3, 1])).toEqual(['├─ ', '│  └─ ', '│     └─ ', '└─ '])
})
