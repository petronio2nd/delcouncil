// Lógica pura do painel: lê o arquivo de sessão do app, o emoji do título e as pastas da dupla.
// Nada aqui toca disco; o register.tsx lê os arquivos e passa o texto.

import type { Fila, Linha, Mapa, Trabalho } from '../types'

export type Sessao = {
  id: string
  cli: string
  titulo: string
  modelo: string
  esforco: string
  arquivada: boolean
  criada: number
  mae?: string
  pasta?: string
}

// O app desktop guarda cada sessão em claude-code-sessions\<conta>\<org>\local_<id>.json.
export function lerSessao(texto: string): Sessao | undefined {
  let d: Record<string, unknown>
  try {
    d = JSON.parse(texto) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (typeof d?.sessionId !== 'string') return undefined
  const texto_ = (v: unknown) => (typeof v === 'string' ? v : '')
  const origem = d.spawnedFrom as { sessionId?: unknown } | undefined
  return {
    id: d.sessionId,
    cli: texto_(d.cliSessionId),
    titulo: texto_(d.title),
    modelo: texto_(d.model),
    esforco: texto_(d.effort),
    arquivada: d.isArchived === true,
    criada: typeof d.createdAt === 'number' ? d.createdAt : 0,
    mae: typeof origem?.sessionId === 'string' ? origem.sessionId : undefined,
    pasta: texto_(d.cwd) || undefined,
  }
}

// Os emojis do nome da sessão (CLAUDE.md global). Os seis primeiros esperam o usuário.
const ESTADOS: ReadonlyArray<[string, string, boolean]> = [
  ['🔥', 'prazo', true],
  ['👍', 'espera seu OK', true],
  ['▶', 'espera ação sua', true],
  ['📨', 'mensagem para mandar', true],
  ['📖', 'para você ler', true],
  ['🧠', 'espera decisão', true],
  ['⚙', 'trabalhando', false],
  ['🤝', 'com outra pessoa', false],
  ['💤', 'pausada', false],
  ['✅', 'concluída', false],
  ['🗄', 'arquivável', false],
]

export function estado(titulo: string, arquivada = false): { emoji: string; rotulo: string; esperaUsuario: boolean } {
  if (arquivada) return { emoji: '🗄️', rotulo: 'arquivada', esperaUsuario: false }
  const t = titulo.trimStart()
  for (const [base, rotulo, esperaUsuario] of ESTADOS) {
    if (t.startsWith(base)) {
      const comVs = t.startsWith(base + '️')
      return { emoji: comVs ? base + '️' : base, rotulo, esperaUsuario }
    }
  }
  return { emoji: '·', rotulo: 'sem emoji', esperaUsuario: false }
}

// "claude-opus-5-5" vira "Opus 5.5"; o que não casa fica como veio.
export function nomeModelo(id: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id)
  if (!m) return id
  const familia = m[1][0].toUpperCase() + m[1].slice(1)
  return `${familia} ${m[2]}${m[3] ? '.' + m[3] : ''}`
}

export function nomeCurto(id: string): string {
  const claude = /^(?:anthropic\/)?claude-[a-z]+-\d+(?:-\d+)?(?:[#-](\w+))?$/.exec(id)
  if (claude) return [nomeModelo(id), claude[1]].filter(Boolean).join(' ')
  const gpt = /^(?:openai\/)?gpt-(\d+(?:\.\d+)?)-(sol|astra)(?:#(\w+))?$/.exec(id)
  if (gpt) return [gpt[2][0].toUpperCase() + gpt[2].slice(1), gpt[1], gpt[3]].filter(Boolean).join(' ')
  const gemini = /^gemini-(\d+(?:\.\d+)?)-(argon|flash)(?:-(\w+))?$/.exec(id)
  if (gemini) return ['Gemini', gemini[1], gemini[2][0].toUpperCase() + gemini[2].slice(1), gemini[3]].filter(Boolean).join(' ')
  return id
}

export function linhaModelo(t: Trabalho): string | undefined {
  if (!t.real) return undefined
  if (t.real === 'não informado' || t.real === 'não lido') return `modelo ${nomeCurto(t.pedido ?? '?')} (real ${t.real})`
  return `modelo ${nomeCurto(t.real)}${t.difere ? ` ⚠️ pedido ${nomeCurto(t.pedido ?? '?')}` : ''}`
}

export function lerFila(texto: string): Fila | undefined {
  try {
    const f = JSON.parse(texto.trim())
    if (!f || typeof f.lidoEm !== 'number' || !Number.isFinite(f.lidoEm) || f.lidoEm < 0 ||
      typeof f.semAgy !== 'boolean' || !Array.isArray(f.fila)) return undefined
    if (!f.fila.every((x: unknown) => {
      if (!x || typeof x !== 'object') return false
      const item = x as Record<string, unknown>
      return typeof item.fonte === 'string' && item.fonte.trim() !== '' &&
        typeof item.folga === 'number' && Number.isFinite(item.folga) && typeof item.trava === 'boolean'
    })) return undefined
    return { lidoEm: f.lidoEm, semAgy: f.semAgy, fila: f.fila.map(({ fonte, folga, trava }: Fila['fila'][number]) => ({ fonte, folga, trava })) }
  } catch {
    return undefined
  }
}

export function nomeFonte(fonte: string): string {
  const nomes: Record<string, string> = {
    'agy Claude and GPT models': 'agy Claude',
    'agy Gemini 4 Argon': 'Argon',
    'agy Gemini Models': 'agy Gemini',
    'ChatGPT (OpenCode/Codex)': 'ChatGPT',
    'API Anthropic (opencode)': 'API',
    OpenRouter: 'OpenRouter',
  }
  return Object.prototype.hasOwnProperty.call(nomes, fonte) ? nomes[fonte] : fonte
}

export function faixaFila(f: Fila, agora: number): { texto: string; velha: boolean; fontes: string[]; fim: string } {
  const idade = Math.max(0, agora - f.lidoEm)
  const velha = idade > 6 * 3_600_000
  const fontes = f.fila.map(x => `${nomeFonte(x.fonte)} ${x.folga < 0 ? '−' : '+'}${Math.abs(x.folga)}${x.trava ? ' 🔒' : ''}`)
  const fim = `   ${velha ? `fila de há ${Math.floor(idade / 3_600_000)} h · rode recursos.ps1` : ha(idade)}${f.semAgy ? ' (sem agy)' : ''}`
  return { texto: `Fila  ${fontes.join(' › ')}${fim}`, velha, fontes, fim }
}

export function linha(s: Sessao, desde: number, nivel: number, aprox = false): Linha {
  const e = estado(s.titulo, s.arquivada)
  return {
    id: s.id,
    titulo: s.titulo || s.id,
    ...e,
    modelo: nomeModelo(s.modelo),
    esforco: s.esforco,
    arquivada: s.arquivada,
    desde,
    aprox,
    nivel,
  }
}

// Descendentes da raiz, em profundidade, filhas em ordem de criação, até 3 níveis.
export function descendentes(raiz: string, sessoes: Iterable<Sessao>): Array<{ s: Sessao; nivel: number }> {
  const porMae = new Map<string, Sessao[]>()
  for (const s of sessoes) {
    if (!s.mae) continue
    const lista = porMae.get(s.mae) ?? []
    lista.push(s)
    porMae.set(s.mae, lista)
  }
  const saida: Array<{ s: Sessao; nivel: number }> = []
  const visitar = (id: string, nivel: number) => {
    if (nivel > 3) return
    const filhas = [...(porMae.get(id) ?? [])].sort((a, b) => a.criada - b.criada)
    for (const f of filhas) {
      if (f.id === raiz) continue
      saida.push({ s: f, nivel })
      visitar(f.id, nivel + 1)
    }
  }
  visitar(raiz, 1)
  return saida
}

export function nomeDaPasta(caminho: string): string {
  return caminho.replace(/[\\/]+$/, '').split(/[\\/]/).pop()?.toLowerCase() ?? ''
}

// O nome da pasta e, para "projeto-exemplo", também "exemplo": a dupla usa o nome curto.
export function prefixosDaPasta(caminho: string): string[] {
  const n = nomeDaPasta(caminho)
  if (!n) return []
  return n.startsWith('projeto-') && n.length > 8 ? [n, n.slice(8)] : [n]
}

// "git@github.com:dono/claude-mods.git" ou "https://github.com/dono/claude-mods" vira "claude-mods".
export function nomeDoRemoto(remoto: string | null | undefined): string | undefined {
  if (!remoto) return undefined
  const n = remoto.replace(/\.git$/, '').split(/[\\/:]/).pop()
  return n ? n.toLowerCase() : undefined
}

// A dupla nomeia a pasta <projeto>-<data> ou <projeto>-<executor>-<assunto>-<data>.
export function casaProjeto(pasta: string, prefixos: readonly string[]): boolean {
  const n = pasta.toLowerCase()
  return prefixos.some(p => p !== '' && (n === p || n.startsWith(p + '-')))
}

export type Arquivo = { nome: string; mtime: number }

// Quem o .cmd chama: codex (modelo e esforço), agy, openrouter, opencode ou claude.
export function quemRoda(cmd: string | undefined): string {
  if (!cmd) return '?'
  const modelo = (re: RegExp) => re.exec(cmd)?.[1]
  if (/codex(\.exe)?"?\s+exec\b/i.test(cmd)) {
    const m = modelo(/\s-m\s+"?([\w.\-]+)/)
    const e = modelo(/model_reasoning_effort=(\w+)/)
    return ['codex', m, e].filter(Boolean).join(' ')
  }
  if (/openrouter\.ps1/i.test(cmd)) return ['openrouter', modelo(/-Modelo\s+"?([\w.\-\/:]+)/i)].filter(Boolean).join(' ')
  if (/[\\/]agy(\.exe)?"/i.test(cmd) || /\bagy-fazer\b/i.test(cmd)) {
    return ['agy', modelo(/(?:--model[= ]|\s-m\s+)"?([\w.\-]+)/)].filter(Boolean).join(' ')
  }
  if (/opencode-cli(\.exe)?"?\s+run\b/i.test(cmd)) {
    return ['opencode', modelo(/\s-m\s+"?([^\s"]+)/)].filter(Boolean).join(' ')
  }
  if (/claude(\.exe)?"?\s/i.test(cmd)) return ['claude', modelo(/--model[= ]"?([\w.\-]+)/)].filter(Boolean).join(' ')
  return '?'
}

// Só compara a variante quando os dois lados a informam.
export function lerModelo(texto: string): { pedido: string; real: string; difere: boolean } | undefined {
  const linhas = texto.split(/\r?\n/).map(l => l.trim())
  const pedido = linhas.find(l => l.startsWith('pedido:'))?.slice(7).trim()
  const real = linhas.find(l => l.startsWith('real:'))?.slice(5).trim()
  if (!pedido || !real) return undefined
  const [modeloPedido, variantePedida] = pedido.split('#', 2)
  const [modeloReal, varianteReal] = real.split('#', 2)
  const difere =
    real !== 'não lido' && real !== 'não informado' &&
    (modeloPedido !== modeloReal || (variantePedida !== undefined && varianteReal !== undefined && variantePedida !== varianteReal))
  return { pedido, real, difere }
}

// Só a palavra do veredito ("aprovado", "aprovado com correções", "refazer"): o resto da
// linha fala do projeto e fica fora do painel.
export function lerVeredito(texto: string | undefined): string {
  if (!texto) return '?'
  const linhas = texto.split(/\r?\n/).map(l => l.trim())
  const titulo = linhas.findIndex(l => /^#+\s*veredito/i.test(l))
  const depois = titulo >= 0 ? linhas.slice(titulo + 1) : linhas
  const primeira = depois.find(l => l !== '' && !l.startsWith('#')) ?? ''
  const palavra = primeira.split(/\s+[—–-]\s+|[.:;]/)[0].replace(/[*_`]/g, '').trim().toLowerCase()
  return palavra.slice(0, 40) || '?'
}

const PARADO_MS = 30 * 60_000

function ehExecucao(saida: string): boolean {
  // relatorio.md, relatorio-b.md, cx-relatorio.md, or-relatorio.md, agy-a.md.
  return /relatorio|^agy-/i.test(saida)
}

// Os trabalhos de uma pasta da dupla. `textos` traz o conteúdo dos .cmd e das saídas que existem.
export function trabalhosDaPasta(
  pasta: string,
  arquivos: readonly Arquivo[],
  textos: Readonly<Record<string, string>>,
  agora: number,
): Trabalho[] {
  const hora = new Map(arquivos.map(a => [a.nome, a.mtime]))
  const saidas = new Set<string>()
  const lista: Trabalho[] = []

  // Rodadas que têm tentativa (revisao2.md.tentativa-1-gpt.md): o revisor foi chamado.
  const comTentativa = new Set<string>()
  for (const a of arquivos) {
    if (!a.nome.endsWith('.md.cmd')) continue
    const saida = a.nome.slice(0, -4)
    saidas.add(saida)
    const tipo = ehExecucao(saida) ? 'execução' : 'revisão'
    const quem = quemRoda(textos[a.nome])
    const modelo = hora.has(saida + '.modelo') ? lerModelo(textos[saida + '.modelo'] ?? '') : undefined
    const tent = lerTentativa(saida)
    if (tent) comTentativa.add(tent.rodada)
    const pronto = hora.get(saida)
    if (pronto !== undefined) {
      const veredito = tipo === 'revisão' ? lerVeredito(textos[saida]) : 'relatório pronto'
      lista.push({ pasta, saida, tipo, quem, ...modelo, estado: 'feito', veredito, desde: pronto, ...tent })
    } else {
      const ultima = Math.max(hora.get(saida + '.log') ?? 0, a.mtime)
      const estado_ = agora - ultima > PARADO_MS ? 'parado' : 'rodando'
      lista.push({ pasta, saida, tipo, quem, ...modelo, estado: estado_, desde: a.mtime, ...tent })
    }
  }

  // Tentativa sem .cmd (um Claude, que não deixa .cmd): já terminou.
  for (const a of arquivos) {
    const tent = lerTentativa(a.nome)
    if (!tent || saidas.has(a.nome)) continue
    saidas.add(a.nome)
    comTentativa.add(tent.rodada)
    const tipo = ehExecucao(a.nome) ? 'execução' : 'revisão'
    const modelo = hora.has(a.nome + '.modelo') ? lerModelo(textos[a.nome + '.modelo'] ?? '') : undefined
    const veredito = tipo === 'revisão' ? lerVeredito(textos[a.nome]) : 'relatório pronto'
    lista.push({ pasta, saida: a.nome, tipo, quem: '?', ...modelo, estado: 'feito', veredito, desde: a.mtime, ...tent })
  }

  // pacoteN.md sem revisaoN.md nem .cmd: o revisor ainda não foi chamado (ou é um Claude, que
  // não deixa .cmd). Idem tarefaN.md sem relatorioN.md.
  const pares: ReadonlyArray<[RegExp, string, Trabalho['tipo']]> = [
    [/^pacote(.*)\.md$/, 'revisao', 'revisão'],
    [/^tarefa(.*)\.md$/, 'relatorio', 'execução'],
  ]
  for (const a of arquivos) {
    for (const [re, saidaBase, tipo] of pares) {
      const m = re.exec(a.nome)
      if (!m) continue
      const saida = `${saidaBase}${m[1]}.md`
      if (saidas.has(saida)) continue
      const modelo = hora.has(saida + '.modelo') ? lerModelo(textos[saida + '.modelo'] ?? '') : undefined
      const pronto = hora.get(saida)
      if (pronto !== undefined) {
        const veredito = tipo === 'revisão' ? lerVeredito(textos[saida]) : 'relatório pronto'
        lista.push({ pasta, saida, tipo, quem: '?', ...modelo, estado: 'feito', veredito, desde: pronto })
      } else if (!comTentativa.has(saida)) {
        lista.push({ pasta, saida, tipo, quem: '?', ...modelo, estado: 'esperando', desde: a.mtime })
      }
    }
  }
  return lista
}

// "revisao2.md.tentativa-1-gpt.md": a rodada revisao2.md, tentativa 1, família gpt.
export function lerTentativa(saida: string): { rodada: string; tentativa: number; familia: string } | undefined {
  const m = /^(.+\.md)\.tentativa-(\d+)-([a-z0-9]+)\.md$/i.exec(saida)
  return m ? { rodada: m[1], tentativa: Number(m[2]), familia: m[3].toLowerCase() } : undefined
}

// Uma linha por rodada (pasta + revisaoN.md): as tentativas e a cópia final viram uma só, com o estado
// mais novo. A cópia final (revisaoN.md sem .cmd) dá o veredito se não houver tentativa depois dela;
// quem rodou e o modelo vêm da última tentativa. Revisão cruzada (tentativas de famílias diferentes na
// mesma rodada) dá uma linha por família, cada uma com a própria última tentativa: a cópia final não
// diz de qual família é, e nenhum veredito pode sumir.
export function juntarRodadas(lista: readonly Trabalho[]): Trabalho[] {
  const grupos = new Map<string, Trabalho[]>()
  for (const t of lista) {
    const chave = `${t.pasta}\u0000${t.rodada ?? t.saida}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), t])
  }
  const saida: Trabalho[] = []
  for (const g of grupos.values()) {
    const tentativas = g.filter(t => t.tentativa !== undefined).sort((a, b) => a.tentativa! - b.tentativa! || a.desde - b.desde)
    const ultima = tentativas[tentativas.length - 1]
    if (!ultima) {
      saida.push(...g)
      continue
    }
    const familias = new Set(tentativas.map(t => t.familia))
    if (familias.size > 1) {
      for (const f of familias) saida.push(tentativas.filter(t => t.familia === f).pop()!)
      continue
    }
    const final = g.find(t => t.tentativa === undefined && t.estado === 'feito')
    if (ultima.estado !== 'feito' || !final || final.desde < ultima.desde) saida.push(ultima)
    else saida.push({ ...ultima, veredito: final.veredito, desde: final.desde })
  }
  return saida
}

// O assunto da pasta da dupla: sem o projeto, a data e o executor ("mods-m2-agy-20261031-1412" → "m2").
// Se só sobrar o executor, fica ele ("mods-fable-20261031-133026" → "fable").
// A data é AAAAMMDD, às vezes seguida da hora (HHMM ou HHMMSS); outros números ficam ("issue-1234").
const EXECUTORES = new Set(['agy', 'codex', 'opencode', 'openrouter', 'gpt', 'gemini', 'claude', 'fable', 'opus', 'sonnet', 'haiku', 'argon', 'astra'])
export function assuntoDaPasta(pasta: string, prefixos: readonly string[]): string {
  const n = pasta.toLowerCase()
  const projeto = prefixos.filter(p => p !== '' && n.startsWith(p + '-')).sort((a, b) => b.length - a.length)[0]
  const tokens = (projeto ? pasta.slice(projeto.length + 1) : pasta).split('-')
  const partes = tokens.filter((x, i) => x !== '' && !/^\d{8}$/.test(x) && !(/^\d{4}(\d{2})?$/.test(x) && /^\d{8}$/.test(tokens[i - 1] ?? '')))
  const semExecutor = partes.filter(x => !EXECUTORES.has(x.toLowerCase()))
  return (semExecutor.length ? semExecutor : partes).join('-') || projeto || pasta
}

// "rodada 2" para revisao2.md, "execução 1" para relatorio.md; outro nome fica sem o .md.
export function rotuloRodada(t: Trabalho): string {
  const base = t.rodada ?? t.saida
  const m = /^(revisao|relatorio)(\d*)\.md$/.exec(base)
  if (m) return `${m[1] === 'revisao' ? 'rodada' : 'execução'} ${m[2] || '1'}`
  return base.replace(/\.md$/, '')
}

// A árvore das sessões: "├─ ", "└─ " e, para as netas, "│  " embaixo da mãe que ainda tem irmã adiante.
export function ramos(niveis: readonly number[]): string[] {
  return niveis.map((nivel, i) => {
    let s = ''
    for (let k = 1; k <= nivel; k++) {
      let segue = false
      for (let j = i + 1; j < niveis.length && niveis[j]! >= k; j++) {
        if (niveis[j] === k) {
          segue = true
          break
        }
      }
      s += k < nivel ? (segue ? '│  ' : '   ') : segue ? '├─ ' : '└─ '
    }
    return s
  })
}

// "agy Gemini" vira "Gemini (agy)": primeiro o modelo, depois por onde roda.
export function nomeProximo(nome: string): string {
  return nome.startsWith('agy ') ? `${nome.slice(4)} (agy)` : nome
}

// O que o register precisa ler: os .cmd, os modelos e as revisões que já existem.
export function arquivosParaLer(arquivos: readonly Arquivo[]): string[] {
  const nomes = new Set(arquivos.map(a => a.nome))
  const ler: string[] = []
  for (const n of nomes) {
    if (n.endsWith('.md.cmd')) {
      ler.push(n)
      const saida = n.slice(0, -4)
      if (nomes.has(saida + '.modelo')) ler.push(saida + '.modelo')
      if (nomes.has(saida) && !ehExecucao(saida)) ler.push(saida)
    }
    if (lerTentativa(n)) {
      if (!ehExecucao(n)) ler.push(n)
      if (nomes.has(n + '.modelo')) ler.push(n + '.modelo')
    }
    const m = /^pacote(.*)\.md$/.exec(n)
    if (m && nomes.has(`revisao${m[1]}.md`)) ler.push(`revisao${m[1]}.md`)
    const par = /^(pacote|tarefa)(.*)\.md$/.exec(n)
    if (par) {
      const modelo = `${par[1] === 'pacote' ? 'revisao' : 'relatorio'}${par[2]}.md.modelo`
      if (nomes.has(modelo)) ler.push(modelo)
    }
  }
  return [...new Set(ler)]
}

// Rodando primeiro, depois o mais recente.
export function ordenarTrabalhos(lista: readonly Trabalho[]): Trabalho[] {
  const peso = { rodando: 0, esperando: 1, parado: 2, feito: 3 } as const
  return [...lista].sort((a, b) => peso[a.estado] - peso[b.estado] || b.desde - a.desde)
}

export function agruparTrabalhos(lista: readonly Trabalho[], agora: number): Array<{ pasta: string; trabalhos: Trabalho[]; antigos: number }> {
  const grupos = new Map<string, { pasta: string; trabalhos: Trabalho[]; antigos: number }>()
  for (const t of ordenarTrabalhos(lista)) {
    const grupo = grupos.get(t.pasta) ?? { pasta: t.pasta, trabalhos: [], antigos: 0 }
    grupos.set(t.pasta, grupo)
    if (t.estado === 'feito' && agora - t.desde > 3_600_000 && !t.difere && !/refazer|reprovad|não comprovad/.test(t.veredito ?? '')) grupo.antigos++
    else grupo.trabalhos.push(t)
  }
  return [...grupos.values()]
}

// --- Formatação comum ao painel e ao /orquestra texto ---

export function semEmoji(l: Linha): string {
  return l.emoji === '·' ? l.titulo : l.titulo.trimStart().slice(l.emoji.length).trim() || l.titulo
}

export function detalheSessao(l: Linha, agora: number): string {
  const tempo = ha(agora - l.desde)
  const quando = l.aprox && tempo !== 'agora' ? tempo.replace('há ', 'há ≥ ') : tempo
  return [l.rotulo, [l.modelo, l.esforco].filter(Boolean).join(' '), quando].filter(Boolean).join(' · ')
}

// Para a coluna da direita do painel: "Opus 5.5 high · 12 min".
export function detalheCurto(l: Linha, agora: number): string {
  const tempo = ha(agora - l.desde).replace('há ', '')
  const quando = l.aprox && tempo !== 'agora' ? `≥ ${tempo}` : tempo
  return [[l.modelo, l.esforco].filter(Boolean).join(' '), quando].filter(Boolean).join(' · ')
}

const FAMILIAS: Record<string, string> = { gpt: 'GPT', claude: 'Claude', gemini: 'Gemini', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Quem rodou, sem o esforço: "GPT Astra 6", "agy Gemini 4 Argon", "Fable". Sem .cmd, a família da
// tentativa (-gpt vira "GPT"); sem nada, undefined.
export function nomeQuem(t: Trabalho): string | undefined {
  const [motor, modelo] = t.quem.split(' ')
  if (t.quem === '?' || !motor) {
    if (!t.familia) return undefined
    return Object.prototype.hasOwnProperty.call(FAMILIAS, t.familia) ? FAMILIAS[t.familia] : maiuscula(t.familia)
  }
  if (!modelo) return motor
  const curto = nomeCurto(modelo).replace(/ (minimal|low|medium|high|xhigh|max|ultra)$/, '')
  const nome = /^[a-z]+$/.test(curto) ? maiuscula(curto) : curto
  const gpt = /^(Astra|Sol|Luna) /.test(nome) ? 'GPT ' : ''
  const via = motor === 'agy' ? 'agy ' : ''
  return `${via}${gpt}${nome}`
}

// "Revisão do GPT Astra 6", "Execução no agy Sonnet 5.5": quem, sem o esforço.
export function tituloTrabalho(t: Trabalho): string {
  const nome = nomeQuem(t) ?? 'quem?'
  return t.tipo === 'revisão' ? `Revisão do ${nome}` : `Execução no ${nome}`
}

// O estado em palavras e a cor: o que pede ação fica amarelo ou vermelho.
export function estadoTrabalho(t: Trabalho, agora: number): { texto: string; tom?: 'success' | 'warning' | 'error' } {
  const tempo = ha(agora - t.desde).replace('há ', '')
  if (t.estado === 'rodando') return { texto: `rodando · ${tempo}` }
  if (t.estado === 'esperando') return { texto: `${t.tipo === 'revisão' ? 'revisor' : 'executor'} não chamado`, tom: 'warning' }
  if (t.estado === 'parado') return { texto: 'parado há +30 min', tom: 'warning' }
  const v = t.veredito ?? (t.tipo === 'execução' ? 'relatório pronto' : 'feito')
  if (/refazer/.test(v)) return { texto: 'pediu refazer', tom: 'error' }
  if (/reprovad/.test(v)) return { texto: 'reprovou', tom: 'error' }
  if (/não comprovad/.test(v)) return { texto: 'não comprovado', tom: 'warning' }
  if (/^aprovado/.test(v)) return { texto: v, tom: 'success' }
  return { texto: v }
}

export function iconeTrabalho(t: Trabalho): string {
  if (t.estado === 'rodando') return '⏳'
  if (t.estado === 'esperando') return '⌛'
  if (t.estado === 'parado') return '⚠️'
  if (/refazer|reprovad/.test(t.veredito ?? '')) return '❌'
  if (/não comprovad/.test(t.veredito ?? '')) return '❔'
  if (t.difere) return '⚠️'
  if (/com corre/.test(t.veredito ?? '')) return '☑️'
  return '✅'
}

export function resumoTrabalho(t: Trabalho): string {
  const situacao =
    t.estado === 'feito'
      ? (t.veredito ?? 'feito')
      : t.estado === 'esperando'
        ? `${t.tipo === 'revisão' ? 'revisor' : 'executor'} não chamado`
        : t.estado === 'parado'
          ? 'log parado há mais de 30 min'
          : 'rodando'
  const [motor, modelo, ...esforco] = t.quem.split(' ')
  const quem = t.quem === '?' ? (nomeQuem(t) ?? 'quem?') : [motor, nomeCurto(modelo ?? ''), ...esforco].filter(Boolean).join(' ')
  return `${t.tipo} · ${quem} · ${situacao}`
}

export function mapaEmTexto(m: Mapa, agora: number): string {
  const todas = [...(m.raiz ? [m.raiz] : []), ...m.filhas]
  const esperando = todas.filter(l => l.esperaUsuario)
  const sessao = (l: Linha, recuo = l.nivel) =>
    `${'  '.repeat(recuo)}${l.emoji} ${semEmoji(l)}${l.nivel === 0 ? ' (esta)' : ''} — ${detalheSessao(l, agora)}`
  const linhas: string[] = []
  if (m.fila) linhas.push(faixaFila(m.fila, agora).texto)
  if (esperando.length) linhas.push(`Esperando você (${esperando.length})`, ...esperando.map(l => sessao(l, 1)), '')
  linhas.push('Sessões')
  if (m.mae) linhas.push(`  aberta por: ${m.mae}`)
  linhas.push(m.raiz ? sessao(m.raiz) : `  ${m.aviso ?? 'Sessão não achada.'}`)
  linhas.push(...m.filhas.map(l => sessao(l)))
  if (m.raiz && m.filhas.length === 0) linhas.push('  Nenhuma sessão filha.')
  linhas.push('', 'Executores e revisões')
  if (m.trabalhos.length === 0) linhas.push('  Nada na dupla desde que a sessão começou.')
  for (const grupo of agruparTrabalhos(juntarRodadas(m.trabalhos), agora)) {
    linhas.push(`  ${grupo.pasta}`)
    for (const t of grupo.trabalhos) {
      linhas.push(`    ${iconeTrabalho(t)} ${resumoTrabalho(t)}`)
      const modelo = linhaModelo(t)
      if (modelo) linhas.push(`      ${modelo}`)
      linhas.push(`      ${t.saida} · ${ha(agora - t.desde)}`)
    }
    if (grupo.antigos) linhas.push(`    +${grupo.antigos} feitos há mais de 1 h`)
  }
  return linhas.join('\n')
}

export function ha(ms: number): string {
  if (ms < 60_000) return 'agora'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h${String(min % 60).padStart(2, '0')}`
  return `há ${Math.floor(h / 24)} d`
}
