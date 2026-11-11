import { expect, test } from 'claude-code/testing'

type App = {
  nomes: string[]
  durante: string[]
  titulo: () => string
  renomearDeFora: (t: string) => void
  abrirPorta: () => void
}

// O app desktop, simulado: guarda o nome, anota cada troca e o nome visto durante cada ferramenta.
// Um Bash com `rm` pede permissão (como o app faz, dentro da chamada) e espera a porta abrir.
function app(engine: any, on: any, inicial: string, opcoes: { semDesktop?: boolean; permissaoNaPropria?: boolean } = {}): App {
  const nomes: string[] = []
  const durante: string[] = []
  let titulo = inicial
  let abrir = () => {}
  const porta = new Promise<void>(r => (abrir = r))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', async (_: any, e: any) => {
    if (e.tool.startsWith('mcp__ccd_session_mgmt__')) {
      if (opcoes.semDesktop) throw new Error('no such tool')
      if (e.tool.endsWith('get_session')) return { result: {}, text: JSON.stringify({ sessionId: 'local_eu', title: titulo }) }
      if (opcoes.permissaoNaPropria) await engine.classic.PermissionRequest({ tool_name: e.tool, tool_input: {} })
      if (e.session_id === 'self' || e.session_id === 'local_eu') {
        titulo = e.title
        nomes.push(e.title)
      }
      return { result: {}, text: 'ok' }
    }
    if (e.tool === 'Bash' && String(e.command).startsWith('rm')) {
      await engine.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: e.command } })
      await porta
    }
    durante.push(titulo)
    return { result: {}, text: '' }
  })
  return { nomes, durante, titulo: () => titulo, renomearDeFora: t => (titulo = t), abrirPorta: () => abrir() }
}

const fim = (turnId: string, agentId?: string) => ({ turnId, reason: 'completed', durationMs: 1, answer: '', agentId }) as any
const RENOMEAR = 'mcp__ccd_session_mgmt__set_session_title'
// Deixa a fila do mod andar: as trocas sem await terminam em algumas voltas de microtarefa.
const espera = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

test('pergunta mostra 🧠 durante e o nome do Claude fica no fim', async ($, on) => {
  const a = app($, on, '👍 selo: fazer mod')
  await $.turn.start({ text: 'faz', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await espera()
  await $.tool.call({ tool: RENOMEAR, session_id: 'self', title: '✅ selo: mod pronto' } as any)
  await $.turn.complete(fim('t1'))
  expect(a.durante).toEqual(['🧠 selo: fazer mod'])
  expect(a.nomes).toEqual(['⚙️ selo: fazer mod', '🧠 selo: fazer mod', '⚙️ selo: fazer mod', '✅ selo: mod pronto'])
})

test('turno sem renomear volta ao nome de antes', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  await $.turn.complete(fim('t1'))
  expect(a.nomes).toEqual(['⚙️ revisar doc', '📖 revisar doc'])
})

test('🧠 que o Claude dá no fim do turno fica', async ($, on) => {
  const a = app($, on, '👍 selo: fazer mod')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.tool.call({ tool: RENOMEAR, session_id: 'self', title: '🧠 projeto: qual frente 1º' } as any)
  await $.turn.complete(fim('t1'))
  expect(a.titulo()).toBe('🧠 projeto: qual frente 1º')
})

test('⚙️ do Claude no meio do turno vira só o texto no fim', async ($, on) => {
  const a = app($, on, '✅ tarefa anterior')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.tool.call({ tool: RENOMEAR, session_id: 'self', title: '⚙️ rodando ocr' } as any)
  await $.turn.complete(fim('t1'))
  expect(a.titulo()).toBe('rodando ocr')
})

test('nome dado de fora entre dois turnos é respeitado', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete(fim('t1'))
  a.renomearDeFora('💤 cv canva: parou')
  await $.turn.start({ text: 'oi', turnId: 't2' })
  await $.turn.complete(fim('t2'))
  expect(a.titulo()).toBe('💤 cv canva: parou')
  expect(a.nomes.slice(-2)).toEqual(['⚙️ cv canva: parou', '💤 cv canva: parou'])
})

test('renomear outra sessão não muda o nome desta', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.tool.call({ tool: RENOMEAR, session_id: 'local_filha', title: '🗄️ filha: feita' } as any)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await $.turn.complete(fim('t1'))
  expect(a.nomes.every(n => n.endsWith('revisar doc'))).toBe(true)
  expect(a.titulo()).toBe('📖 revisar doc')
})

test('permissão pedida pela chamada do próprio mod não trava', async ($, on) => {
  const a = app($, on, 'Nome dado à mão', { permissaoNaPropria: true })
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete(fim('t1'))
  expect(a.nomes).toEqual(['⚙️ Nome dado à mão', 'Nome dado à mão'])
})

test('permissão mostra 🧠 e fecha quando a ferramenta (de subagente) termina', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  const bash = $.tool.call({ tool: 'Bash', command: 'rm x', agentId: 'ag' } as any)
  await espera()
  expect(a.titulo()).toBe('🧠 revisar doc')
  a.abrirPorta()
  await bash
  await espera()
  expect(a.titulo()).toBe('⚙️ revisar doc')
  await $.turn.complete(fim('t1'))
})

test('outra chamada em paralelo, da mesma ferramenta ou não, não apaga o 🧠', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  const rm = $.tool.call({ tool: 'Bash', command: 'rm x' } as any)
  await espera()
  await $.tool.call({ tool: 'Read', file_path: 'a.md' } as any)
  await $.tool.call({ tool: 'Bash', command: 'git status', agentId: 'ag' } as any)
  await espera()
  expect(a.titulo()).toBe('🧠 revisar doc')
  a.abrirPorta()
  await rm
  await espera()
  expect(a.titulo()).toBe('⚙️ revisar doc')
  await $.turn.complete(fim('t1'))
})

test('fora do desktop o mod fica quieto', async ($, on) => {
  const a = app($, on, 'x', { semDesktop: true })
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as any)
  await $.turn.complete(fim('t1'))
  expect(a.nomes).toEqual([])
})

test('um ⚙️ velho não fica parado no fim do turno', async ($, on) => {
  const a = app($, on, '⚙ rodando ocr')
  await $.turn.start({ text: 'oi', turnId: 't1' })
  await $.turn.complete(fim('t1'))
  expect(a.nomes).toEqual(['⚙️ rodando ocr', 'rodando ocr'])
})

test('subagente não mexe no nome', async ($, on) => {
  const a = app($, on, '📖 revisar doc')
  await $.turn.start({ text: 'x', turnId: 'a1', agentId: 'ag' })
  await $.turn.complete(fim('a1', 'ag'))
  expect(a.nomes).toEqual([])
})
