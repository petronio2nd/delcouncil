import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'
import { iniciarRota, registrarRota } from './rota-claude'
import { FONTES, NOMES, avisosFontes, textoFontes, impedimento, type Fontes, fonteDaFila } from './fontes'
import { lerFontesClaude, executarFontesClaude } from './fontes-claude'

import type { Cota, Cotas, JanelaMax, Linha, Mapa, Retrato, Trabalho } from '../types'
import {
  AVISO_MAX,
  cotasEmTexto,
  fraseCota,
  juntarMax,
  leiturasDoMax,
  lerHistorico,
  lerMax,
  linhasCota,
  maxAbandonado,
  mesclarMax,
  montarCotas,
  proximaFonte,
  rotulo,
  topoCotas,
} from './cotas'
import {
  agruparTrabalhos,
  arquivosParaLer,
  assuntoDaPasta,
  casaProjeto,
  descendentes,
  detalheCurto,
  estadoTrabalho,
  faixaFila,
  ha,
  iconeTrabalho,
  juntarRodadas,
  lerSessao,
  lerFila,
  linha,
  linhaModelo,
  mapaEmTexto,
  nomeDoRemoto,
  nomeProximo,
  nomeQuem,
  prefixosDaPasta,
  ordenarTrabalhos,
  ramos,
  rotuloRodada,
  semEmoji,
  trabalhosDaPasta,
  type Sessao,
} from './leitura'

const PANE = 'orquestra'
const TITULO = 'Orquestra'
const PANE_FONTES = 'orquestra-fontes'
const PANE_COTAS = 'orquestra-cotas'
const TITULO_COTAS = 'Cotas'
const VAZIO: Mapa = { filhas: [], trabalhos: [], lidoEm: 0 }
const SEM_COTAS: Cotas = { lidoEm: 0, semAgy: false, cotas: [], maxAoVivo: false }

const fontesErro = atom({ plugin: 'orquestra', key: 'fontesErro' } as const, '')
const fontesRef = atom({ plugin: 'orquestra', key: 'fontes' } as const, '')
const mapa = atom({ plugin: 'orquestra', key: 'mapa' } as const, VAZIO)
const cotas = atom({ plugin: 'orquestra', key: 'cotas' } as const, SEM_COTAS)
const agoraRef = atom({ plugin: 'orquestra', key: 'agora' } as const, 0)
const abriu = atom({ plugin: 'orquestra', key: 'abriu' } as const, false)

// Com o painel aberto, varre a cada 4 s; fechado, a cada 30 s (só para abrir sozinho).
const PASSO_MS = 4_000
const FECHADO_MS = 30_000
const LIMITE_BYTES = 4 * 1024 * 1024
const SEMANA_MS = 7 * 24 * 3_600_000

type Desde = Record<string, { t: string; d: number; a?: true }>

function juntar(pasta: string, nome: string): string {
  const sep = pasta.includes('\\') || !pasta.includes('/') ? '\\' : '/'
  return pasta.replace(/[\\/]+$/, '') + sep + nome
}

export const register: Register = on => {
  registrarRota(on, {})
  // Cache por caminho: só relê o arquivo cujo mtime mudou.
  const sessoesLidas = new Map<string, { mtime: number; sessao?: Sessao }>()
  const textosLidos = new Map<string, { mtime: number; texto?: string }>()
  let pastasDeSessao: string[] | undefined
  let propria: string | undefined
  let desde: Desde = {}
  let desdeMudou = false
  let emCurso: Promise<void> | undefined
  let ultimaVarredura = 0
  let varrerAgora: (() => Promise<void>) | undefined
  let historico: { mtime: number; retratos: Retrato[] } | undefined
  // O Max que esta sessão viu (na chave dela no $.store) e o de todas as sessões juntas.
  let meuMax: JanelaMax[] = []
  let todosMax: JanelaMax[] = []
  let maxJuntadoEm = 0
  let chaveMax = 'max:'

  on('session.start', async ($, e, next) => {
    await iniciarRota($)
    await $.command.register({ name: 'orquestra', description: 'Abre ou fecha o painel da orquestração (sessões filhas e dupla); "cotas" abre cotas; "fontes" controla as travas globais' })
    const guardado = (await $.store.get('desde').catch(() => undefined)) as Desde | undefined
    const agora = await $.clock.now()
    desde = Object.fromEntries(Object.entries(guardado ?? {}).filter(([, v]) => agora - v.d < SEMANA_MS))
    chaveMax = `max:${await $.session.id()}`
    meuMax = lerMax(await $.store.get(chaveMax).catch(() => undefined))

    // Cotas: o histórico do recursos.ps1 (ORQUESTRA_COTAS, ou %LOCALAPPDATA%\dupla\cotas.jsonl) e o Claude Max.
    // Cada sessão grava o Max que viu numa chave só dela (max:<id>), para duas sessões não apagarem o maior
    // uso uma da outra; a leitura junta todas as chaves.
    const lerCotas = async (agora_: number): Promise<Cotas> => {
      const caminho = (await $.env.get('ORQUESTRA_COTAS')) ?? juntar(juntar((await $.env.get('LOCALAPPDATA')) ?? '', 'dupla'), 'cotas.jsonl')
      const pasta = caminho.replace(/[\\/][^\\/]*$/, '')
      const nome = caminho.slice(pasta.length + 1)
      const arq = (await $.fs.list(pasta).catch(() => [])).find(x => x.kind === 'file' && x.name === nome)
      if (!arq) historico = undefined
      else if (historico?.mtime !== arq.mtimeMs) {
        const texto = arq.size > LIMITE_BYTES ? undefined : await $.fs.read(caminho).catch(() => undefined)
        historico = { mtime: arq.mtimeMs, retratos: typeof texto === 'string' ? lerHistorico(texto) : [] }
      }
      const limites = (await $.session.usage().catch(() => undefined))?.rateLimits ?? []
      const novoMax = juntarMax(meuMax, limites, agora_)
      const mudou = JSON.stringify(novoMax) !== JSON.stringify(meuMax)
      if (mudou) {
        meuMax = novoMax
        // Só esta sessão escreve na própria chave: sem janela, a chave sai em vez de ficar vazia.
        await (meuMax.length ? $.store.set(chaveMax, meuMax) : $.store.delete(chaveMax)).catch(() => undefined)
      }
      // As outras sessões: a cada minuto, e sempre que esta grava. Leitura que falha pula a chave.
      if (mudou || agora_ - maxJuntadoEm >= 60_000) {
        maxJuntadoEm = agora_
        const listas: JanelaMax[][] = [meuMax]
        for (const k of await $.store.keys().catch(() => [] as string[])) {
          if (!k.startsWith('max:') || k === chaveMax) continue
          const lido = await $.store.get(k).then(v => ({ v }), () => undefined)
          if (!lido) continue
          const lista = juntarMax(lerMax(lido.v), [], agora_)
          if (lista.length) listas.push(lista)
          else if (maxAbandonado(lido.v, agora_)) await $.store.delete(k).catch(() => undefined)
        }
        todosMax = mesclarMax(...listas)
      }
      return montarCotas(historico?.retratos ?? [], todosMax, leiturasDoMax(limites, agora_), agora_)
    }

    // Pasta(s) do app desktop com os local_<id>.json: ORQUESTRA_SESSOES, ou claude-code-sessions\<conta>\<org> em
    // %LOCALAPPDATA%\Claude-Data\claude_<id> (app atual) ou %APPDATA%\Claude (app antigo).
    const acharPastas = async (): Promise<string[]> => {
      const temJson = async (p: string) => (await $.fs.list(p).catch(() => [])).some(x => /^local_.*\.json$/.test(x.name))
      const fixa = await $.env.get('ORQUESTRA_SESSOES')
      const bases: string[] = []
      if (fixa) bases.push(fixa)
      else {
        const dados = juntar((await $.env.get('LOCALAPPDATA')) ?? '', 'Claude-Data')
        for (const d of await $.fs.list(dados).catch(() => []))
          if (d.kind === 'dir' && d.name.startsWith('claude_')) bases.push(juntar(juntar(dados, d.name), 'claude-code-sessions'))
        bases.push(juntar(juntar((await $.env.get('APPDATA')) ?? '', 'Claude'), 'claude-code-sessions'))
      }
      // Fica na primeira base que tem sessões (a do app atual vem antes): misturar com cópias velhas da
      // mesma sessão na pasta antiga deixaria o título velho por cima do novo.
      const achadas: string[] = []
      for (const base of bases) {
        if (achadas.length) break
        if (await temJson(base)) { achadas.push(base); continue }
        for (const conta of await $.fs.list(base).catch(() => [])) {
          if (conta.kind !== 'dir') continue
          for (const org of await $.fs.list(juntar(base, conta.name)).catch(() => [])) {
            const p = juntar(juntar(base, conta.name), org.name)
            if (org.kind === 'dir' && (await temJson(p))) achadas.push(p)
          }
        }
      }
      return achadas
    }

    const lerTexto = async (caminho: string, mtime: number): Promise<string | undefined> => {
      const c = textosLidos.get(caminho)
      if (c && c.mtime === mtime) return c.texto
      const texto = await $.fs.read(caminho).catch(() => undefined)
      textosLidos.set(caminho, { mtime, texto: typeof texto === 'string' ? texto : undefined })
      return typeof texto === 'string' ? texto : undefined
    }

    // Na primeira leitura não sei quando o título mudou: a última gravação do arquivo é um piso
    // (o título mudou antes dela), e o painel mostra "há ≥ N".
    const marcarDesde = (s: Sessao, mtime: number, agora_: number): { d: number; aprox: boolean } => {
      const visto = desde[s.id]
      if (visto && visto.t === s.titulo) return { d: visto.d, aprox: visto.a === true }
      const novo = visto ? { t: s.titulo, d: agora_ } : { t: s.titulo, d: Math.min(mtime || agora_, agora_), a: true as const }
      desde[s.id] = novo
      desdeMudou = true
      return { d: novo.d, aprox: !visto }
    }

    // Uma varredura por vez: quem pede durante uma recebe a que está em curso.
    const varrer = (): Promise<void> => (emCurso ??= varrerUmaVez().finally(() => (emCurso = undefined)))
    const varrerUmaVez = async () => {
      const fontesAtuais = JSON.stringify(await lerFontesClaude($))
      if (fontesAtuais !== await read($, fontesRef)) await update($, fontesRef, () => fontesAtuais)
      const agora_ = await $.clock.now()
      ultimaVarredura = agora_
      const cli = await $.session.id()
      if (!pastasDeSessao || pastasDeSessao.length === 0) pastasDeSessao = await acharPastas()

      type Entrada = { caminho: string; mtime: number; size: number }
      const entradas: Entrada[] = []
      for (const p of pastasDeSessao) {
        for (const x of await $.fs.list(p).catch(() => [])) {
          if (x.kind === 'file' && /^local_.*\.json$/.test(x.name)) entradas.push({ caminho: juntar(p, x.name), mtime: x.mtimeMs, size: x.size })
        }
      }
      const ler = async (x: Entrada): Promise<Sessao | undefined> => {
        const c = sessoesLidas.get(x.caminho)
        if (c && c.mtime === x.mtime) return c.sessao
        if (x.size > LIMITE_BYTES) {
          sessoesLidas.set(x.caminho, { mtime: x.mtime })
          return undefined
        }
        const texto = await $.fs.read(x.caminho).catch(() => undefined)
        const sessao = typeof texto === 'string' ? lerSessao(texto) : undefined
        sessoesLidas.set(x.caminho, { mtime: x.mtime, sessao })
        return sessao
      }

      // A raiz é esta sessão: o arquivo cujo cliSessionId é o $.session.id(), procurado entre os
      // mais recentes. ORQUESTRA_RAIZ=local_<id> mostra outra orquestradora no lugar.
      const alvo = await $.env.get('ORQUESTRA_RAIZ')
      const ehRaiz = (s: Sessao | undefined) => (alvo ? s?.id === alvo : s?.cli === cli)
      let raiz: Sessao | undefined
      if (propria) {
        const x = entradas.find(y => y.caminho === propria)
        raiz = x && (await ler(x))
        if (!ehRaiz(raiz)) raiz = propria = undefined
      }
      if (!raiz) {
        const candidatas = alvo
          ? entradas.filter(x => x.caminho.endsWith(`${alvo}.json`))
          : [...entradas].sort((a, b) => b.mtime - a.mtime).slice(0, 30)
        for (const x of candidatas) {
          const s = await ler(x)
          if (ehRaiz(s)) {
            raiz = s
            propria = x.caminho
            break
          }
        }
      }

      // Filha nasce depois da mãe: só interessa arquivo gravado depois que a raiz começou.
      const inicio =
        raiz?.criada || (await $.session.usage().then(u => u.startedAt).catch(() => agora_ - 12 * 3_600_000))
      const sessoes = new Map<string, Sessao>()
      const mtimeDe = new Map<string, number>()
      for (const x of entradas) {
        if (x.mtime < inicio - 60_000 && x.caminho !== propria) continue
        const s = await ler(x)
        if (s) {
          sessoes.set(s.id, s)
          mtimeDe.set(s.id, x.mtime)
        }
      }

      let mae: string | undefined
      if (raiz?.mae) {
        const x = entradas.find(y => y.caminho.endsWith(`${raiz!.mae}.json`))
        mae = x ? (await ler(x))?.titulo : undefined
      }

      const desc = raiz ? descendentes(raiz.id, sessoes.values()) : []
      const linhaDe = (s: Sessao, nivel: number) => {
        const { d, aprox } = marcarDesde(s, mtimeDe.get(s.id) ?? 0, agora_)
        return linha(s, d, nivel, aprox)
      }

      // Dupla: %TEMP%\dupla\<projeto>-*, o projeto tirado das pastas das sessões e do remoto do git.
      const prefixos = new Set<string>()
      const pastas = [...[raiz, ...desc.map(d => d.s)].map(s => s?.pasta), await $.session.cwd()]
      for (const p of pastas) for (const n of prefixosDaPasta(p ?? '')) prefixos.add(n)
      for (const n of ((await $.env.get('ORQUESTRA_PREFIXOS')) ?? '').split(',')) if (n.trim()) prefixos.add(n.trim().toLowerCase())
      const remoto = nomeDoRemoto((await $.session.repo().catch(() => null))?.remote)
      if (remoto) prefixos.add(remoto)
      const baseDupla = (await $.env.get('ORQUESTRA_DUPLA')) ?? juntar((await $.env.get('TEMP')) ?? '', 'dupla')
      const trabalhos: Trabalho[] = []
      const entradasDupla = await $.fs.list(baseDupla).catch(() => [])
      const arquivoFila = entradasDupla.find(p => p.kind === 'file' && p.name === '_fila.json')
      const textoFila = arquivoFila ? await lerTexto(juntar(baseDupla, arquivoFila.name), arquivoFila.mtimeMs) : undefined
      const fila = textoFila === undefined ? undefined : lerFila(textoFila)
      for (const p of entradasDupla) {
        if (p.kind !== 'dir' || !casaProjeto(p.name, [...prefixos])) continue
        const caminho = juntar(baseDupla, p.name)
        const arquivos = (await $.fs.list(caminho).catch(() => []))
          .filter(a => a.kind === 'file')
          .map(a => ({ nome: a.name, mtime: a.mtimeMs }))
        if (Math.max(0, ...arquivos.map(a => a.mtime)) < inicio - 10 * 60_000) continue
        const textos: Record<string, string> = {}
        for (const n of arquivosParaLer(arquivos)) {
          const t = await lerTexto(juntar(caminho, n), arquivos.find(a => a.nome === n)?.mtime ?? 0)
          if (t !== undefined) textos[n] = t
        }
        const assunto = assuntoDaPasta(p.name, [...prefixos])
        trabalhos.push(...trabalhosDaPasta(p.name, arquivos, textos, agora_).map(t => ({ ...t, assunto })))
      }

      const novo: Mapa = {
        raiz: raiz ? linhaDe(raiz, 0) : undefined,
        mae,
        filhas: desc.map(d => linhaDe(d.s, d.nivel)),
        trabalhos: ordenarTrabalhos(trabalhos),
        fila,
        aviso: raiz ? undefined : 'Não achei esta sessão entre as do app desktop: mostro só a dupla.',
        lidoEm: agora_,
      }
      const antes = await read($, mapa)
      if (JSON.stringify({ ...antes, lidoEm: 0 }) !== JSON.stringify({ ...novo, lidoEm: 0 })) await update($, mapa, () => novo)
      const novasCotas = await lerCotas(agora_).catch(() => undefined)
      if (novasCotas && JSON.stringify(novasCotas) !== JSON.stringify(await read($, cotas))) await update($, cotas, () => novasCotas)
      if (agora_ - (await read($, agoraRef)) >= 30_000) await update($, agoraRef, () => agora_)
      if (desdeMudou) {
        desdeMudou = false
        await $.store.set('desde', desde).catch(() => undefined)
      }

      // Abre sozinho uma vez por sessão, quando aparece a primeira filha ou um trabalho da dupla rodando.
      const temOQueMostrar = novo.filhas.length > 0 || novo.trabalhos.some(t => t.estado !== 'feito')
      if (temOQueMostrar && !(await read($, abriu))) {
        await update($, abriu, () => true)
        void $.ui.open({ id: PANE, title: TITULO }).catch(() => undefined)
      }
    }

    $.clock.every(PASSO_MS, async () => {
      const aberto = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE || p.id === PANE_COTAS || p.id === PANE_FONTES)
      if (!aberto && (await $.clock.now()) - ultimaVarredura < FECHADO_MS) return
      await varrer().catch(() => undefined)
    })
    varrerAgora = varrer
    void varrer().catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'orquestra' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/)
    if (args[0] === 'fontes') {
      try {
        if (args.length > 1 && args[1] !== 'listar' && e.origin?.kind !== 'composer') return { text: 'Só o usuário pode alterar as travas pelo comando local ou pelos botões.' }
        const text = await executarFontesClaude($, args.slice(1).join(' '))
        const novo = JSON.stringify(await lerFontesClaude($))
        await update($, fontesRef, () => novo)
        if (args.length === 1) await $.ui.open({ id: PANE_FONTES, title: 'Fontes de consumo' })
        return { text }
      } catch (erro) { return { text: String(erro) } }
    }
    if (args[0] === 'cotas') {
      if (args[1] === 'texto') {
        await varrerAgora?.()
        return { text: [avisosFontes(await lerFontesClaude($)), cotasEmTexto(await read($, cotas), await $.clock.now(), ha)].filter(Boolean).join('\n') }
      }
      if ((await $.ui.panes().catch(() => [])).some(p => p.id === PANE_COTAS)) {
        await $.ui.close({ id: PANE_COTAS })
        return { text: 'Painel das cotas fechado.' }
      }
      await $.ui.open({ id: PANE_COTAS, title: TITULO_COTAS })
      void varrerAgora?.().catch(() => undefined)
      return { text: 'Painel das cotas aberto.' }
    }
    if (args[0] === 'texto') {
      await varrerAgora?.()
      const fontes = await lerFontesClaude($)
      const m = await read($, mapa)
      return { text: [avisosFontes(fontes), mapaEmTexto({ ...m, fila: filtrarFila(m.fila, fontes) }, await $.clock.now())].filter(Boolean).join('\n') }
    }
    if ((await $.ui.panes().catch(() => [])).some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Painel da orquestração fechado.' }
    }
    await update($, abriu, () => true)
    await $.ui.open({ id: PANE, title: TITULO })
    return { text: 'Painel da orquestração aberto.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    await read($, fontesRef)
    const fontes = await lerFontesClaude($)
    const avisoFontes = avisosFontes(fontes)
    const m = await read($, mapa)
    const c = await read($, cotas)
    const agora = Math.max(await read($, agoraRef), m.lidoEm)
    if (m.lidoEm === 0) return <Text dimColor>Lendo as sessões e a dupla…</Text>

    // Uma linha por sessão: o ramo da árvore, emoji e título à esquerda; modelo e tempo à direita. Na árvore,
    // a que espera o usuário diz "espera você" no lugar do modelo (o detalhe está na caixa do topo).
    const sessao = (l: Linha, chave: string, ramo = '', naArvore = false) => (
      <Box key={chave} flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1}>
          <Text wrap="truncate-end" bold={l.nivel === 0} dimColor={l.arquivada}>
            {ramo && <Text dimColor>{ramo}</Text>}
            {`${l.emoji} ${semEmoji(l)}`}
          </Text>
        </Box>
        {naArvore && l.esperaUsuario ? <Text color="warning">espera você</Text> : <Text dimColor>{detalheCurto(l, agora)}</Text>}
      </Box>
    )

    // Um trabalho da dupla: ícone, rodada e quem à esquerda; o estado em palavras à direita; o modelo só quando diverge.
    const trabalho = (t: Trabalho) => {
      const st = estadoTrabalho(t, agora)
      const texto = st.texto === 'aprovado com correções' ? 'com correções' : st.texto
      const nome = [rotuloRodada(t), nomeQuem(t)].filter(Boolean).join(' · ')
      const extra = t.tentativa !== undefined && t.tentativa > 1 ? ` · ${t.tentativa}ª tentativa` : ''
      return (
        <Box key={`t:${t.pasta}/${t.saida}`} flexDirection="column" paddingLeft={2}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>
              <Text wrap="truncate-end" bold={t.estado === 'rodando'}>
                {`${iconeTrabalho(t)} ${nome}`}
                {extra && <Text dimColor bold={false}>{extra}</Text>}
              </Text>
            </Box>
            <Text color={st.tom}>{texto}</Text>
          </Box>
          {t.difere && <Text color="warning" wrap="truncate-end">{linhaModelo(t)}</Text>}
        </Box>
      )
    }

    // Os trabalhos agrupados pelo assunto da pasta, em negrito; dois assuntos iguais mostram a pasta inteira.
    const porAssunto = (lista: Trabalho[], prefixo: string) => {
      const grupos = new Map<string, Trabalho[]>()
      for (const t of lista) grupos.set(t.pasta, [...(grupos.get(t.pasta) ?? []), t])
      const nomes = [...grupos.keys()].map(p => grupos.get(p)![0]!.assunto ?? p)
      return [...grupos.entries()].map(([pasta, ts], i) => (
        <Box key={`${prefixo}:${pasta}`} flexDirection="column">
          <Text bold wrap="truncate-end">{nomes.filter(n => n === nomes[i]).length > 1 ? pasta : nomes[i]}</Text>
          {ts.map(trabalho)}
        </Box>
      ))
    }

    const esperando = [...(m.raiz ? [m.raiz] : []), ...m.filhas].filter(l => l.esperaUsuario)
    // A arquivada some, a menos que tenha descendente ativa logo abaixo (senão a neta fica sem mãe).
    const temAtiva = (i: number) => {
      for (let j = i + 1; j < m.filhas.length && m.filhas[j]!.nivel > m.filhas[i]!.nivel; j++) if (!m.filhas[j]!.arquivada) return true
      return false
    }
    const filhas = m.filhas.filter((l, i) => !l.arquivada || temAtiva(i))
    const arvore = ramos(filhas.map(l => l.nivel))
    const arquivadas = m.filhas.length - filhas.length
    const juntados = juntarRodadas(m.trabalhos)
    const grupos = agruparTrabalhos(juntados, agora)
    const ativos = grupos.flatMap(g => g.trabalhos)
    const rodando = ativos.filter(t => t.estado !== 'feito')
    const prontos = ativos.filter(t => t.estado === 'feito')
    const antigos = grupos.reduce((s, g) => s + g.antigos, 0)
    const soRevisoes = juntados.every(t => t.estado !== 'feito' || t.tipo === 'revisão')
    const fila = filtrarFila(m.fila, fontes)
    const faixa = fila ? faixaFila(fila, agora) : undefined
    const prox = proximaFonte(fila, c)
    const cota = prox?.cota ? fraseCota(prox.cota, agora, c.fuso) : undefined
    const rotuloCota = prox?.cota ? rotulo(prox.cota) : undefined

    return (
      <Box flexDirection="column" gap={1}>
        {avisoFontes && <Text color="warning">{avisoFontes}</Text>}
        {esperando.length > 0 && (
          <Box key="espera" flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text bold color="warning">Esperando você</Text>
            {esperando.map(l => sessao(l, `e:${l.id}`))}
          </Box>
        )}
        <Box key="sessoes" flexDirection="column">
          <Text dimColor>Sessões</Text>
          {m.mae && <Text dimColor wrap="truncate-end">aberta por {m.mae}</Text>}
          {m.raiz ? sessao(m.raiz, `s:${m.raiz.id}`, '', true) : <Text dimColor>{m.aviso ?? 'Sessão não achada.'}</Text>}
          {filhas.map((l, i) => sessao(l, `s:${l.id}`, arvore[i], true))}
          {arquivadas > 0 && <Text dimColor>{`+${arquivadas} ${arquivadas > 1 ? 'arquivadas' : 'arquivada'}`}</Text>}
          {m.raiz && m.filhas.length === 0 && <Text dimColor>Nenhuma sessão filha.</Text>}
        </Box>
        {m.trabalhos.length > 0 && (
          <Box key="fora" flexDirection="column">
            <Text dimColor>Rodando fora daqui</Text>
            {rodando.length > 0 ? porAssunto(rodando, 'r') : <Text dimColor>Nada rodando agora.</Text>}
          </Box>
        )}
        {(prontos.length > 0 || antigos > 0) && (
          <Box key="prontos" flexDirection="column">
            <Text dimColor>{soRevisoes ? 'Revisões prontas' : 'Prontos'}</Text>
            {porAssunto(prontos, 'p')}
            {antigos > 0 && <Text dimColor>{`+${antigos} mais ${soRevisoes ? 'antiga' : 'antigo'}${antigos > 1 ? 's' : ''} · /orquestra texto`}</Text>}
          </Box>
        )}
        {faixa && (
          <Box key="prox" flexDirection="column">
            {!prox
              ? <Text color="warning">Próximo trabalho: nenhuma fonte livre (todas com trava)</Text>
              : (
                <Box flexDirection="row" justifyContent="space-between" gap={1}>
                  <Box flexShrink={1}>
                    <Text wrap="truncate-end">
                      <Text dimColor>Próximo trabalho vai para </Text>
                      <Text bold>{nomeProximo(prox.nome)}</Text>
                    </Text>
                  </Box>
                  {rotuloCota?.texto && <Text color={rotuloCota.tom} dimColor={!rotuloCota.tom}>{rotuloCota.texto}</Text>}
                </Box>
              )}
            {cota?.barra && (
              <Text>
                {cota.barra.map((b, i) =>
                  b.tipo === 'cheia'
                    ? <Text key={i} color={rotuloCota?.tom}>{b.texto}</Text>
                    : b.tipo === 'vazia' ? <Text key={i} dimColor>{b.texto}</Text> : <Text key={i} bold>{b.texto}</Text>)}
              </Text>
            )}
            {cota && <Text>{cota.frase}</Text>}
            {faixa.velha
              ? <Text color="warning">{faixa.fim.trim()}</Text>
              : <Text dimColor>{[prox?.depois && `depois: ${prox.depois}`, m.fila!.semAgy && 'sem agy', 'todas as cotas: /orquestra cotas'].filter(Boolean).join(' · ')}</Text>}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE_COTAS }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    await read($, fontesRef)
    const fontes = await lerFontesClaude($)
    const avisoFontes = avisosFontes(fontes)
    const c = await read($, cotas)
    const m = await read($, mapa)
    const agora = Math.max(await read($, agoraRef), m.lidoEm)
    const topo = topoCotas(c, agora, ha)
    const prox = proximaFonte(filtrarFila(m.fila, fontes), c)
    return (
      <Box flexDirection="column" gap={1}>
        {avisoFontes && <Text color="warning">{avisoFontes}</Text>}
        <Button key="fontes" label="Fontes: ligar / desligar" onPress={() => $.ui.open({ id: PANE_FONTES, title: 'Fontes de consumo' })} />
        <Box key="topo" flexDirection="column">
          {prox && <Text>Próximo trabalho vai para <Text bold color="success">{prox.nome}</Text></Text>}
          <Text color={topo.velha ? 'warning' : undefined} dimColor={!topo.velha}>{topo.texto}</Text>
        </Box>
        {c.cotas.map((cota, i) => blocoCota(ui, cota, agora, c.fuso, `c:${i}:${cota.fonte}|${cota.limite}`))}
        {c.cotas.length > 0 && <Text key="legenda" dimColor>uso abaixo do tempo = vai sobrar · acima = vai faltar</Text>}
        {!c.maxAoVivo && <Text key="max" dimColor>{AVISO_MAX}</Text>}
      </Box>
    )
  })
  on('ui.render', { component: 'Pane', requestId: PANE_FONTES }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, fontesRef)
    const fontes = await lerFontesClaude($)
    return <Box flexDirection="column" gap={1}>
      <Text>{textoFontes(fontes)}</Text>
      <Text key="fontes-erro" color="warning">{await read($, fontesErro)}</Text>
      {FONTES.map(f => <Button key={`fonte:${f}`} label={`${fontes.bloqueadas.includes(f) ? 'Ligar' : 'Desligar'} ${NOMES[f]}`} onPress={async () => {
        let erro = ''
        try { await executarFontesClaude($, `${fontes.bloqueadas.includes(f) ? 'ligar' : 'desligar'} ${f}`) }
        catch (e) { erro = `⚠️ ${e instanceof Error ? e.message : String(e)}` }
        await update($, fontesErro, () => erro)
        const novo = JSON.stringify(await lerFontesClaude($))
        await update($, fontesRef, () => novo)
      }} />)}
    </Box>
  })
}

function filtrarFila(fila: Mapa['fila'], fontes: Fontes): Mapa['fila'] {
  return fila && { ...fila, fila: fila.fila.map(f => ({ ...f, trava: f.trava || Boolean(impedimento(fontes, fonteDaFila(f.fonte))) })) }
}

// Uma cota: título e rótulo na primeira linha; as barras de uso e de tempo lado a lado, para comparar de relance.
function blocoCota({ Box, Text }: ElementTable, cota: Cota, agora: number, fuso: number | undefined, chave: string) {
  const l = linhasCota(cota, agora, fuso)
  const alto = (cota.fechadas[0]?.perdido ?? 0) >= 30
  return (
    <Box key={chave} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1}>
          <Text bold wrap="truncate-end">{l.titulo}</Text>
        </Box>
        {l.rotulo.texto && <Text color={l.rotulo.tom} dimColor={!l.rotulo.tom}>{l.rotulo.texto}</Text>}
      </Box>
      {l.uso && (
        <Box flexDirection="row" gap={1}>
          <Box flexDirection="column">
            <Text dimColor>uso</Text>
            {l.tempo && <Text dimColor>tempo</Text>}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text>{l.uso}</Text>
            {l.tempo && <Text dimColor wrap="truncate-end">{l.tempo}</Text>}
          </Box>
        </Box>
      )}
      {l.perdeu && <Text color={alto ? 'warning' : undefined} dimColor={!alto} wrap="truncate-end">{l.perdeu}</Text>}
    </Box>
  )
}
