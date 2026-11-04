// Uma sessão no painel: a desta janela (nivel 0) ou uma descendente dela.
export type Linha = {
  id: string
  titulo: string
  emoji: string
  rotulo: string
  esperaUsuario: boolean
  modelo: string
  esforco: string
  arquivada: boolean
  // Desde quando o título está como está (ms).
  desde: number
  // Na primeira leitura só se sabe um piso (a última gravação do arquivo): "há ≥ N".
  aprox: boolean
  nivel: number
}

// Uma execução ou revisão da dupla, lida de %TEMP%\dupla\<pasta>.
export type Trabalho = {
  pasta: string
  saida: string
  tipo: 'revisão' | 'execução'
  quem: string
  pedido?: string
  real?: string
  difere?: boolean
  estado: 'rodando' | 'parado' | 'esperando' | 'feito'
  veredito?: string
  desde: number
  // Saída "revisao2.md.tentativa-1-gpt.md": a rodada é revisao2.md, a tentativa 1, a família gpt.
  rodada?: string
  tentativa?: number
  familia?: string
  // O assunto da pasta, sem o projeto e a data ("mods-m2-agy-20261031-1412" vira "m2").
  assunto?: string
}

export type Fila = {
  lidoEm: number
  semAgy: boolean
  fila: Array<{ fonte: string; folga: number; trava: boolean }>
}

// Uma fonte e janela num retrato do recursos.ps1 (cotas.jsonl): números só, null quando não deu para ler.
export type Leitura = {
  fonte: string
  limite: string
  usado: number | null
  // Quando a janela volta (ms); null quando a volta é estimada ou desconhecida.
  volta: number | null
  horas: number | null
  folga: number | null
  // Quando o percentual foi medido, se não foi na hora do retrato (o ChatGPT pode vir de um retrato velho).
  medido?: number
}

// fuso: minutos do Windows em relação ao UTC (Brasília = -180), para as datas do painel.
export type Retrato = { em: number; semAgy: boolean; fuso?: number; fontes: Leitura[] }

// Uma janela que já fechou: o maior uso lido nela e o que sobrou, perdido no reset.
export type Fechada = {
  volta: number
  usado: number
  // A última leitura antes do reset (ms).
  ultima: number
  perdido: number
  // A última leitura foi mais de 6 h antes do reset: o perdido é um teto.
  aprox: boolean
}

// Claude Max lido pelo painel ($.session.usage), guardado no $.store: uma entrada por janela.
export type JanelaMax = { kind: string; volta: number; usado: number; visto: number }

export type Cota = Leitura & { fechadas: Fechada[]; media?: number; mediaDe: number; mediaAprox: boolean }

export type Cotas = {
  // Quando foi o último retrato do recursos.ps1 (ms); 0 sem histórico.
  lidoEm: number
  semAgy: boolean
  // O fuso do último retrato; sem ele, as datas saem no fuso do ambiente do mod.
  fuso?: number
  cotas: Cota[]
  maxAoVivo: boolean
}

export type Mapa = {
  raiz?: Linha
  // Título da sessão que abriu a desta janela, quando ela foi aberta por outra.
  mae?: string
  filhas: Linha[]
  trabalhos: Trabalho[]
  fila?: Fila
  aviso?: string
  lidoEm: number
}

declare module 'claude-code' {
  interface PluginState {
    orquestra: { mapa: Mapa; agora: number; abriu: boolean; cotas: Cotas; fontes: string; fontesErro: string }
  }
}
