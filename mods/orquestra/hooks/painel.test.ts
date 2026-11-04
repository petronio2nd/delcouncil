import { expect, mock, test } from 'claude-code/testing'
import type { FsEntry } from 'claude-code'

// Sessões e dupla de mentira num disco em memória: uma orquestradora (esta sessão de teste),
// duas filhas, uma sessão estranha, revisão do OpenCode, fila e trabalho antigo.
// Confere também a atualização da filha, do veredito e da fila sem reler o que não mudou.

const PANE = { component: 'Pane', requestId: 'orquestra' } as const
const PROPS = { title: 'Orquestra', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const
const SESSOES = 'C:\\fake\\sessoes'
const DUPLA = 'C:\\fake\\dupla'
const REV = `${DUPLA}\\projeto-teste-20261019-1200`
const AGORA = 1_792_400_000_000
const CRIADA = AGORA - 3_600_000

function disco(relogio: () => number) {
  const arquivos = new Map<string, { texto: string; mtime: number }>()
  return {
    escrever: (caminho: string, texto: string, mtime = relogio()) => arquivos.set(caminho, { texto, mtime }),
    ler: (caminho: string) => {
      if (caminho.endsWith('fontes.json')) return '{"versao":1,"bloqueadas":[]}'
      const a = arquivos.get(caminho)
      if (!a) throw new Error(`ENOENT ${caminho}`)
      return a.texto
    },
    listar: (pasta: string): FsEntry[] => {
      const vistos = new Map<string, FsEntry>()
      for (const [caminho, a] of arquivos) {
        if (!caminho.startsWith(pasta + '\\')) continue
        const [nome, ...resto] = caminho.slice(pasta.length + 1).split('\\')
        if (!nome) continue
        vistos.set(nome, resto.length ? { name: nome, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name: nome, kind: 'file', size: a.texto.length, mtimeMs: a.mtime, isLink: false })
      }
      return [...vistos.values()]
    },
  }
}

const sessao = (c: Record<string, unknown>) =>
  JSON.stringify({ cwd: 'D:\\codigos\\projeto-teste', model: 'claude-sonnet-5-5', effort: 'high', isArchived: false, ...c })

test('painel com a orquestradora, duas filhas e OpenCode com modelo pedido × real, e atualização sozinho', async ($, on) => {
  const clock = mock.clock(on, { now: AGORA })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/fake', ORQUESTRA_SESSOES: SESSOES, ORQUESTRA_DUPLA: DUPLA })
  const fs = disco(clock.now)
  const leituras = new Map<string, number>()
  // O que fica abaixo dos plugins responde `{ value }`.
  on('fs.list', (_$, e) => ({ value: fs.listar(e.path) }))
  on('fs.read', (_$, e) => {
    leituras.set(e.path, (leituras.get(e.path) ?? 0) + 1)
    return { value: fs.ler(e.path) }
  })
  on('session.id', () => ({ value: 'cli-mae' }))
  on('session.cwd', () => ({ value: 'D:\\codigos\\projeto-teste' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__orquestra__${e.name}` } }))
  const abertos: string[] = []
  on('ui.open', (_$, e) => {
    abertos.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: abertos.map(id => ({ id, title: 'Orquestra', isShown: true, isFocused: false, isPlaced: true })) }))

  fs.escrever(`${SESSOES}\\local_mae.json`, sessao({ sessionId: 'local_mae', cliSessionId: 'cli-mae', createdAt: CRIADA, model: 'claude-opus-5-5', title: '⚙️ teste: orquestrando' }))
  fs.escrever(`${SESSOES}\\local_f1.json`, sessao({ sessionId: 'local_f1', cliSessionId: 'f1', createdAt: CRIADA + 1000, model: 'claude-haiku-5-5', effort: 'medium', title: '👍 filha um: ok p/ commit', spawnedFrom: { sessionId: 'local_mae' } }))
  fs.escrever(`${SESSOES}\\local_f2.json`, sessao({ sessionId: 'local_f2', cliSessionId: 'f2', createdAt: CRIADA + 2000, title: '⚙️ filha dois: testando', spawnedFrom: { sessionId: 'local_mae' } }))
  fs.escrever(`${SESSOES}\\local_x.json`, sessao({ sessionId: 'local_x', cliSessionId: 'x', createdAt: CRIADA + 3000, title: '🧠 sessão estranha', spawnedFrom: { sessionId: 'local_outra' } }))
  fs.escrever(`${REV}\\pacote.md`, '# pacote de mentira')
  fs.escrever(`${REV}\\revisao.md.cmd`, '"C:\\fake\\opencode-cli.exe" run --standalone --auto --format json -m openai/gpt-6-astra#xhigh')
  fs.escrever(`${REV}\\revisao.md.modelo`, 'pedido: openai/gpt-6-sol#high\nreal: openai/gpt-6-astra#xhigh')
  fs.escrever(`${REV}\\revisao.md.arquivar.cmd`, '"C:\\fake\\opencode-cli.exe" api patch /session/abc')
  fs.escrever(`${REV}\\tarefa-antiga.md`, '# tarefa antiga')
  fs.escrever(`${REV}\\relatorio-antiga.md`, '# pronto', AGORA - 2 * 3_600_000)
  const fila = { lidoEm: AGORA - 180_000, semAgy: true, fila: [
    { fonte: 'ChatGPT (OpenCode/Codex)', folga: 4, trava: false },
    { fonte: 'API Anthropic (opencode)', folga: -5, trava: true },
  ] }
  fs.escrever(`${DUPLA}\\_fila.json`, JSON.stringify(fila))
  fs.escrever(`${DUPLA}\\outro-projeto-20261019-1200\\pacote.md`, '# outro')

  await $.session.start({ cwd: 'D:\\codigos\\projeto-teste', surface: 'desktop', isInteractive: true })

  // Text dentro de Text é um trecho da mesma linha.
  type Desenho = { drawn: () => Promise<unknown> }
  const plano = (no: unknown, dentroTexto = false): string => {
    if (typeof no === 'string' || typeof no === 'number') return String(no)
    const n = no as { type?: string; children?: unknown[] }
    const dentro = (n?.children ?? []).map(filho => plano(filho, dentroTexto || n?.type === 'Text')).join('')
    return n?.type === 'Text' && !dentroTexto ? dentro + '\n' : dentro
  }
  const texto = async (ui: Desenho) => plano(await ui.drawn())
  const esperar = async (ui: Desenho, re: RegExp) => {
    for (let i = 0; i < 20 && !re.test(await texto(ui)); i++) await clock.advance(4_000)
    return texto(ui)
  }

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'orquestra', surface, ...PANE, props: PROPS })
    const antes = await esperar(ui, /filha dois/)
    // Uma linha por sessão: título, depois modelo e tempo (a coluna da direita).
    expect(antes.startsWith('Esperando você\n👍 filha um: ok p/ commit\nHaiku 5.5 medium · ')).toBe(true)
    expect(antes).toMatch(/Sessões\n⚙️ teste: orquestrando\nOpus 5\.5 high · /)
    // As filhas em árvore; a que espera o usuário diz "espera você" no lugar do modelo.
    expect(antes).toMatch(/├─ 👍 filha um: ok p\/ commit\nespera você\n└─ ⚙️ filha dois: testando\nSonnet 5\.5 high · /)
    // O que roda fica à parte do que acabou, agrupado pelo assunto da pasta (aqui, só o projeto).
    expect(antes).toMatch(/Rodando fora daqui\nprojeto-teste\n⏳ rodada 1 · GPT Astra 6\nrodando · [^\n]+\nmodelo Astra 6 xhigh ⚠️ pedido Sol 6 high\n/)
    expect(antes).toMatch(/Prontos\n\+1 mais antigo · \/orquestra texto\n/)
    // A fila vira "próximo": a primeira sem trava; a API travada não aparece como "depois".
    expect(antes).toMatch(/Próximo trabalho vai para ChatGPT\nsem agy · todas as cotas: \/orquestra cotas\n$/)
    expect(antes).not.toMatch(/API|Fila|\+4|relatorio-antiga.md|_fila.json|revisao\.md|projeto-teste-20261019-1200|arquivar|sessão estranha|outro-projeto/)
    const espera = await ui.find({ key: 'espera' })
    expect(espera?.text).toMatch(/filha um/)
    expect(espera?.text).not.toMatch(/orquestrando/)
    await ui.unmount()
  }
  // Abriu sozinho, uma vez, quando viu as filhas.
  expect(abertos).toEqual(['orquestra'])
  expect(leituras.get(`${DUPLA}\\_fila.json`)).toBe(1)

  const ui = await $.ui.mount({ plugin: 'orquestra', surface: 'desktop', ...PANE, props: PROPS })
  await esperar(ui, /filha dois/)
  await clock.advance(60_000)
  expect(leituras.get(`${DUPLA}\\_fila.json`)).toBe(1)
  fs.escrever(`${DUPLA}\\_fila.json`, JSON.stringify({ ...fila, lidoEm: AGORA - 7 * 3_600_000 }))
  fs.escrever(`${SESSOES}\\local_f2.json`, sessao({ sessionId: 'local_f2', cliSessionId: 'f2', createdAt: CRIADA + 2000, title: '🧠 filha dois: qual caminho', spawnedFrom: { sessionId: 'local_mae' } }))
  fs.escrever(`${REV}\\revisao.md`, '## Veredito\n\naprovado com correções — detalhe que não vai para o painel')
  const depois = await esperar(ui, /com correções/)
  expect(depois).toMatch(/Rodando fora daqui\nNada rodando agora\.\nProntos\nprojeto-teste\n⚠️ rodada 1 · GPT Astra 6\ncom correções\nmodelo Astra 6 xhigh ⚠️ pedido Sol 6 high/)
  expect(depois).toMatch(/Próximo trabalho vai para ChatGPT\nfila de há 7 h · rode recursos.ps1 \(sem agy\)\n$/)
  expect(leituras.get(`${DUPLA}\\_fila.json`)).toBe(2)
  expect(depois).not.toMatch(/detalhe que não vai/)
  expect((await ui.find({ key: 'espera' }))?.text).toMatch(/filha um[\s\S]*filha dois/)
  // filha um foi vista pela primeira vez já com o título: piso. filha dois mudou com o painel vendo.
  expect(depois).toMatch(/👍 filha um: ok p\/ commit\nHaiku 5\.5 medium · ≥ 1 min/)
  expect(depois).toMatch(/🧠 filha dois: qual caminho\nSonnet 5\.5 high · agora/)
  await clock.advance(4_000)
  fs.escrever(`${DUPLA}\\_fila.json`, 'inválido')
  await clock.advance(4_000)
  const semFila = await texto(ui)
  expect(semFila.startsWith('Esperando você')).toBe(true)
  expect(semFila).not.toMatch(/Próximo trabalho|rode recursos.ps1/)
  // Arquivada no app: sai da caixa do topo e da árvore, e vira "+1 arquivada".
  fs.escrever(`${SESSOES}\\local_f2.json`, sessao({ sessionId: 'local_f2', cliSessionId: 'f2', createdAt: CRIADA + 2000, title: '🧠 filha dois: qual caminho', isArchived: true, spawnedFrom: { sessionId: 'local_mae' } }))
  const arquivada = await esperar(ui, /\+1 arquivada/)
  expect(arquivada).not.toMatch(/filha dois/)
  expect((await ui.find({ key: 'espera' }))?.text).not.toMatch(/filha dois/)
  expect(arquivada).toMatch(/└─ 👍 filha um: ok p\/ commit\nespera você\n\+1 arquivada/)
  await ui.unmount()
})

test('revisões por rodada: tentativas juntas, sem "quem?", por assunto, e a cota em frase', async ($, on) => {
  const clock = mock.clock(on, { now: AGORA })
  mock.store(on)
  const HIST = 'C:\\fake\\local\\dupla\\cotas.jsonl'
  mock.env(on, { USERPROFILE: 'C:/fake', ORQUESTRA_SESSOES: SESSOES, ORQUESTRA_DUPLA: DUPLA, ORQUESTRA_COTAS: HIST })
  const fs = disco(clock.now)
  on('fs.list', (_$, e) => ({ value: fs.listar(e.path) }))
  on('fs.read', (_$, e) => ({ value: fs.ler(e.path) }))
  on('session.id', () => ({ value: 'cli-mae' }))
  on('session.cwd', () => ({ value: 'D:\\codigos\\projeto-teste' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__orquestra__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [{ id: 'orquestra', title: 'Orquestra', isShown: true, isFocused: false, isPlaced: true }] }))
  fs.escrever(`${SESSOES}\\local_mae.json`, sessao({ sessionId: 'local_mae', cliSessionId: 'cli-mae', createdAt: CRIADA, model: 'claude-opus-5-5', title: '⚙️ teste: dupla' }))
  const min = (n: number) => AGORA - n * 60_000
  const codex = '"C:\\fake\\codex.exe" exec -m gpt-6-astra -c model_reasoning_effort=xhigh'
  // m2: a rodada 1 com duas tentativas e a cópia final, a rodada 2 numa tentativa, um gpt-review solto e
  // um pacote3 que ninguém revisou ainda.
  const M2 = `${DUPLA}\\projeto-teste-m2-agy-20261019-1412`
  fs.escrever(`${M2}\\pacote.md`, '# pacote', min(40))
  fs.escrever(`${M2}\\revisao.md.tentativa-1-gpt.md.cmd`, codex, min(39))
  fs.escrever(`${M2}\\revisao.md.tentativa-1-gpt.md`, '## Veredito\n\nrefazer', min(35))
  fs.escrever(`${M2}\\revisao.md.tentativa-2-gpt.md.cmd`, codex, min(30))
  fs.escrever(`${M2}\\revisao.md.tentativa-2-gpt.md`, '## Veredito\n\naprovado com correções', min(25))
  fs.escrever(`${M2}\\revisao.md`, '## Veredito\n\naprovado com correções', min(24))
  fs.escrever(`${M2}\\pacote2.md`, '# pacote 2', min(20))
  fs.escrever(`${M2}\\revisao2.md.tentativa-1-gpt.md.cmd`, codex, min(19))
  fs.escrever(`${M2}\\revisao2.md.tentativa-1-gpt.md`, '## Veredito\n\naprovado', min(15))
  fs.escrever(`${M2}\\gpt-review.md.tentativa-1-gpt.md.cmd`, codex, min(10))
  fs.escrever(`${M2}\\gpt-review.md.tentativa-1-gpt.md`, '## Veredito\n\naprovado com correções', min(8))
  fs.escrever(`${M2}\\pacote3.md`, '# pacote 3', min(3))
  // fable: a tentativa do Claude e a cópia final, que antes saíam como "fable" e "quem?".
  const FABLE = `${DUPLA}\\projeto-teste-fable-20261019-133026`
  fs.escrever(`${FABLE}\\pacote.md`, '# pacote', min(14))
  fs.escrever(`${FABLE}\\revisao.md.tentativa-1-fable.md.cmd`, '"C:\\fake\\claude.exe" -p --model fable', min(13))
  fs.escrever(`${FABLE}\\revisao.md.tentativa-1-fable.md`, '## Veredito\n\naprovado', min(12))
  fs.escrever(`${FABLE}\\revisao.md`, '## Veredito\n\naprovado', min(12))
  // reparo-rotas: tentativa sem .cmd; a família vem do nome.
  const REPARO = `${DUPLA}\\projeto-teste-20261019-reparo-rotas`
  fs.escrever(`${REPARO}\\pacote.md`, '# pacote', min(7))
  fs.escrever(`${REPARO}\\revisao.md.tentativa-1-claude.md`, '## Veredito\n\nnão comprovado — falta o teste', min(5))
  fs.escrever(`${DUPLA}\\_fila.json`, JSON.stringify({ lidoEm: AGORA - 60_000, semAgy: false, fila: [
    { fonte: 'agy Gemini Models', folga: 75, trava: false },
    { fonte: 'API Anthropic (opencode)', folga: 5, trava: false },
  ] }))
  // A semanal do Gemini: 1% usado, 76% da semana passou.
  fs.escrever(HIST, JSON.stringify({ em: AGORA - 600_000, semAgy: false, fontes: [
    { fonte: 'agy Gemini Models', limite: 'semanal', usado: 1, volta: AGORA + 0.24 * 168 * 3_600_000, horas: 168, folga: 75 },
  ] }) + '\n')

  await $.session.start({ cwd: 'D:\\codigos\\projeto-teste', surface: 'desktop', isInteractive: true })
  const plano = (no: unknown, dentroTexto = false): string => {
    if (typeof no === 'string' || typeof no === 'number') return String(no)
    const n = no as { type?: string; children?: unknown[] }
    const dentro = (n?.children ?? []).map(filho => plano(filho, dentroTexto || n?.type === 'Text')).join('')
    return n?.type === 'Text' && !dentroTexto ? dentro + '\n' : dentro
  }
  const ui = await $.ui.mount({ plugin: 'orquestra', surface: 'desktop', ...PANE, props: PROPS })
  let txt = ''
  for (let i = 0; i < 20 && !/Renova/.test(txt); i++) {
    txt = plano(await ui.drawn())
    if (!/Renova/.test(txt)) await clock.advance(4_000)
  }
  // Só o pacote3 está de fato sem revisor.
  expect(txt).toMatch(/Rodando fora daqui\nm2\n⌛ rodada 3\nrevisor não chamado\nRevisões prontas\n/)
  expect(txt.match(/não chamado/g)?.length).toBe(1)
  expect(txt).toMatch(/\nreparo-rotas\n❔ rodada 1 · Claude\nnão comprovado\n/)
  expect(txt).toMatch(/\nm2\n☑️ gpt-review · GPT Astra 6\ncom correções\n✅ rodada 2 · GPT Astra 6\naprovado\n☑️ rodada 1 · GPT Astra 6 · 2ª tentativa\ncom correções\n/)
  expect(txt).toMatch(/\nfable\n✅ rodada 1 · Fable\naprovado\n/)
  expect(txt).not.toMatch(/quem\?|tentativa-|\.md|refazer|20261019/)
  expect(txt).toMatch(/Próximo trabalho vai para Gemini \(agy\)\nsobra muito\n▱▱▱▱▱▱▱▱│▱▱\n/)
  expect(txt).toMatch(/Cota semanal quase toda livre: usou 1%, e 76% da semana já passou \(│\)\. Renova (domingo|segunda|terça|quarta|quinta|sexta|sábado)\.\ndepois: API · todas as cotas: \/orquestra cotas\n$/)
  // As barras "uso" e "tempo" ficam só no painel Cotas.
  expect(txt).not.toMatch(/^(uso|tempo)\b/m)
  await ui.unmount()
})

test('sem ORQUESTRA_SESSOES, acha as sessões em %LOCALAPPDATA%\\Claude-Data\\claude_<id>', async ($, on) => {
  const clock = mock.clock(on, { now: AGORA })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/fake', LOCALAPPDATA: 'C:\\fake\\local', APPDATA: 'C:\\fake\\roaming', ORQUESTRA_DUPLA: DUPLA })
  const fs = disco(clock.now)
  on('fs.list', (_$, e) => ({ value: fs.listar(e.path) }))
  on('fs.read', (_$, e) => ({ value: fs.ler(e.path) }))
  on('session.id', () => ({ value: 'cli-mae' }))
  on('session.cwd', () => ({ value: 'D:\\codigos\\projeto-teste' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__orquestra__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  const pasta = 'C:\\fake\\local\\Claude-Data\\claude_abc\\claude-code-sessions\\conta\\org'
  fs.escrever(`${pasta}\\local_mae.json`, sessao({ sessionId: 'local_mae', cliSessionId: 'cli-mae', createdAt: CRIADA, title: '⚙️ teste: na pasta nova' }))
  fs.escrever(`${pasta}\\local_f1.json`, sessao({ sessionId: 'local_f1', cliSessionId: 'f1', createdAt: CRIADA + 1000, title: '⚙️ filha nova', spawnedFrom: { sessionId: 'local_mae' } }), CRIADA + 5000)
  // Cópia velha da mesma filha na pasta do app antigo, gravada depois: não pode passar por cima.
  fs.escrever('C:\\fake\\roaming\\Claude\\claude-code-sessions\\conta\\org\\local_f1.json', sessao({ sessionId: 'local_f1', cliSessionId: 'f1', createdAt: CRIADA + 1000, title: '⚙️ filha velha', spawnedFrom: { sessionId: 'local_mae' } }), CRIADA + 9000)
  await $.session.start({ cwd: 'D:\\codigos\\projeto-teste', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'orquestra', surface: 'desktop', ...PANE, props: PROPS })
  let txt = ''
  for (let i = 0; i < 20; i++) {
    txt = JSON.stringify(await ui.drawn())
    if (/filha nova/.test(txt)) break
    await clock.advance(4_000)
  }
  expect(txt).toMatch(/teste: na pasta nova/)
  expect(txt).toMatch(/filha nova/)
  expect(txt).not.toMatch(/Não achei esta sessão|filha velha/)
  await ui.unmount()
})

test('painel das cotas: histórico do recursos.ps1, Claude Max ao vivo guardado no store e releitura pelo mtime', async ($, on) => {
  const clock = mock.clock(on, { now: AGORA })
  // O store em memória, à mão, para o teste ler o que o painel guardou.
  const guardado = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: guardado.get(e.key) }))
  on('store.set', (_$, e) => {
    guardado.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...guardado.keys()] }))
  on('store.delete', (_$, e) => {
    guardado.delete(e.key)
    return { value: undefined }
  })
  // Outra sessão guardou uma janela do Max que já fechou com 90%: entra no perdido.
  guardado.set('max:outra', [{ kind: 'seven_day', volta: AGORA - 50 * 3_600_000, usado: 90, visto: AGORA - 52 * 3_600_000 }])
  // E uma chave só com janela de mais de 180 dias: sai do store.
  guardado.set('max:velha', [{ kind: 'seven_day', volta: AGORA - 200 * 24 * 3_600_000, usado: 50, visto: AGORA - 201 * 24 * 3_600_000 }])
  // Valor estranho não autoriza apagar.
  guardado.set('max:quebrada', 'lixo')
  const store = { get: async (k: string) => guardado.get(k) }
  const HIST = 'C:\\fake\\local\\dupla\\cotas.jsonl'
  mock.env(on, { USERPROFILE: 'C:/fake', ORQUESTRA_SESSOES: SESSOES, ORQUESTRA_DUPLA: DUPLA, ORQUESTRA_COTAS: HIST })
  const fs = disco(clock.now)
  const leituras = new Map<string, number>()
  on('fs.list', (_$, e) => ({ value: fs.listar(e.path) }))
  on('fs.read', (_$, e) => {
    leituras.set(e.path, (leituras.get(e.path) ?? 0) + 1)
    return { value: fs.ler(e.path) }
  })
  on('session.id', () => ({ value: 'cli-mae' }))
  on('session.cwd', () => ({ value: 'D:\\codigos\\projeto-teste' }))
  on('session.repo', () => ({ value: null }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__orquestra__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [{ id: 'orquestra-cotas', title: 'Cotas', isShown: true, isFocused: false, isPlaced: true }] }))
  let usoMax = 30
  on('session.usage', () => ({
    value: {
      startedAt: CRIADA,
      rateLimits: [{ kind: 'seven_day', percentUsed: usoMax, resetsAt: new Date(AGORA + 24 * 3_600_000).toISOString() }],
    } as never,
  }))
  fs.escrever(`${SESSOES}\\local_mae.json`, sessao({ sessionId: 'local_mae', cliSessionId: 'cli-mae', createdAt: CRIADA, title: '⚙️ teste: cotas' }))
  const linha = (em: number, usado: number, volta: number) =>
    JSON.stringify({ em, semAgy: false, fontes: [
      { fonte: 'Claude Max', limite: '5 h e semanal', usado: null, volta: null, horas: 5, folga: null },
      { fonte: 'ChatGPT (OpenCode/Codex)', limite: 'semanal', usado, volta, horas: 168, folga: 2 },
    ] })
  // Uma janela do ChatGPT que fechou ontem com 75% usados e a de agora.
  fs.escrever(HIST, [linha(AGORA - 30 * 3_600_000, 75, AGORA - 26 * 3_600_000), linha(AGORA - 600_000, 4, AGORA + 140 * 3_600_000)].join('\n') + '\n')

  await $.session.start({ cwd: 'D:\\codigos\\projeto-teste', surface: 'desktop', isInteractive: true })
  const plano = (no: unknown, dentroTexto = false): string => {
    if (typeof no === 'string' || typeof no === 'number') return String(no)
    const n = no as { type?: string; children?: unknown[] }
    const dentro = (n?.children ?? []).map(filho => plano(filho, dentroTexto || n?.type === 'Text')).join('')
    return n?.type === 'Text' && !dentroTexto ? dentro + '\n' : dentro
  }
  const ui = await $.ui.mount({ plugin: 'orquestra', surface: 'desktop', component: 'Pane', requestId: 'orquestra-cotas', props: { ...PROPS, title: 'Cotas' } })
  let txt = ''
  for (let i = 0; i < 20 && !/ChatGPT/.test(txt); i++) {
    txt = plano(await ui.drawn())
    if (!/ChatGPT/.test(txt)) await clock.advance(4_000)
  }
  expect(txt).toMatch(/^lidas há 10 min\n/)
  // Rótulo à direita do título; os nomes "uso" e "tempo" numa coluna, as barras na outra.
  expect(txt).toMatch(/Claude Max · semanal\nsobra muito\nuso\ntempo\n▰▰▰▱▱▱▱▱▱▱ 30%\n▰▰▰▰▰▰▰▰▰▱ 86% · volta \S+\nperdeu \d\d\/\d\d 10%/)
  expect(txt).toMatch(/ChatGPT · semanal\nno ritmo\nuso\ntempo\n▱▱▱▱▱▱▱▱▱▱ 4%\n▰▰▱▱▱▱▱▱▱▱ 17% · volta \S+\nperdeu \d\d\/\d\d 25%/)
  expect(txt).toMatch(/uso abaixo do tempo = vai sobrar/)
  expect(txt).not.toMatch(/sem leitura nesta sessão|5 h e semanal/)
  expect(leituras.get(HIST)).toBe(1)
  // Guardou a janela do Max para as próximas sessões.
  expect((await store.get('max:cli-mae')) as unknown).toEqual([{ kind: 'seven_day', volta: AGORA + 24 * 3_600_000, usado: 30, visto: AGORA }])
  expect(guardado.has('max:velha')).toBe(false)
  expect(guardado.has('max:outra')).toBe(true)
  expect(guardado.has('max:quebrada')).toBe(true)

  // Sem mudança no arquivo, não relê; o uso do Max sobe e o store acompanha.
  usoMax = 45
  await clock.advance(8_000)
  expect(leituras.get(HIST)).toBe(1)
  txt = plano(await ui.drawn())
  expect(txt).toMatch(/Claude Max · semanal\nsobra muito\nuso\ntempo\n▰▰▰▰▰▱▱▱▱▱ 45%/)
  expect(((await store.get('max:cli-mae')) as Array<{ usado: number }>)[0]?.usado).toBe(45)

  // Histórico novo, 7 h depois: relê e avisa que está velho.
  fs.escrever(HIST, linha(AGORA - 7 * 3_600_000, 9, AGORA + 140 * 3_600_000) + '\n')
  await clock.advance(4_000)
  txt = plano(await ui.drawn())
  expect(leituras.get(HIST)).toBe(2)
  expect(txt).toMatch(/^histórico de há 7 h · rode recursos.ps1\n/)
  await ui.unmount()
})
