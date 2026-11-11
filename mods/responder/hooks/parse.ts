import type { Item } from '../types'

const NUMBERED = /^(\d+)[.)]\s+(.+)$/

// Limpa o markdown do item para caber numa linha da faixa.
const clean = (text: string) =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim()

// Itens numerados da resposta: os da seção "Sua vez" quando ela existe;
// senão, a última lista numerada de primeiro nível.
export function parseItems(answer: string): Item[] {
  const lines = answer.split(/\r?\n/)
  const start = lines.findIndex(line => /sua vez/i.test(line))
  if (start >= 0) {
    const items: Item[] = []
    for (const line of lines.slice(start + 1)) {
      if (/^\s*(---|#)/.test(line)) break
      const m = NUMBERED.exec(line)
      if (m) items.push({ n: Number(m[1]), text: clean(m[2] ?? "") })
    }
    if (items.length > 0) return items
  }

  const blocks: Item[][] = []
  let current: Item[] = []
  for (const line of lines) {
    const m = NUMBERED.exec(line)
    if (m) {
      current.push({ n: Number(m[1]), text: clean(m[2] ?? "") })
    } else if (line.trim() !== '' && !/^\s/.test(line)) {
      if (current.length > 0) blocks.push(current)
      current = []
    }
  }
  if (current.length > 0) blocks.push(current)
  return blocks.at(-1) ?? []
}

// Junta as respostas num texto só, cada uma com o começo do item que responde.
// Com `withEmpty`, os itens sem resposta também entram, para o usuário completar no prompt.
export function compose(items: Item[], answers: Record<string, string>, withEmpty = false): string {
  const lines = items
    .filter(item => withEmpty || (answers[item.n] ?? '').trim() !== '')
    .map(item => {
      const quote = item.text.length > 60 ? item.text.slice(0, 57) + '...' : item.text
      return `${item.n}. (${quote}) ${(answers[item.n] ?? "").trim()}`
    })
  return lines.join('\n')
}

// Item de sim ou não: o 👍 da "Sua vez", ou o texto que oferece as duas opções.
export const isYesNo = (text: string) =>
  text.startsWith('👍') || /\bsim\b[^.]*\bnão\b|\bsim\/não\b/i.test(text)

// Item que só o usuário roda (comando, login, UAC): o ▶️ da "Sua vez".
export const isRun = (text: string) => text.startsWith('▶️') || text.startsWith('▶')

export const RAN = 'rodei, lê o terminal'
