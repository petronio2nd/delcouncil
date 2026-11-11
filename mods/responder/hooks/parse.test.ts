import { describe, expect, test } from 'claude-code/testing'

import { compose, isRun, isYesNo, parseItems } from './parse'

describe('parseItems', () => {
  test('prefere a seção Sua vez', async () => {
    const answer = [
      '👍 pronto.',
      '',
      '1. item solto de antes',
      '',
      '**Sua vez**',
      '1. 👍 Posso commitar? **sim** ou não',
      '2. ▶️ rodar `npm test`',
      '',
      '---',
      '1. detalhe que não é pergunta',
    ].join('\n')
    expect(parseItems(answer)).toEqual([
      { n: 1, text: '👍 Posso commitar? sim ou não' },
      { n: 2, text: '▶️ rodar npm test' },
    ])
  })

  test('sem Sua vez, pega a última lista', async () => {
    const answer = 'Opções:\n1. a\n2. b\n\nDúvidas:\n1. qual pasta?\n2. qual prazo?'
    expect(parseItems(answer).map(i => i.text)).toEqual(['qual pasta?', 'qual prazo?'])
  })

  test('sem lista, nada', async () => {
    expect(parseItems('só texto')).toEqual([])
  })
})

test('compose junta só o que foi respondido', async () => {
  const items = [{ n: 1, text: 'qual pasta?' }, { n: 2, text: 'qual prazo?' }]
  expect(compose(items, { 2: 'sexta' })).toBe('2. (qual prazo?) sexta')
})

test('isYesNo reconhece 👍 e "sim ou não"', async () => {
  expect(isYesNo('👍 Posso commitar?')).toBe(true)
  expect(isYesNo('🧠 quer botões de "sim" e "não"?')).toBe(true)
  expect(isYesNo('🧠 qual pasta?')).toBe(false)
})

test('isRun reconhece ▶️', async () => {
  expect(isRun('▶️ rodar a compactação no PowerShell elevado')).toBe(true)
  expect(isRun('👍 Posso commitar?')).toBe(false)
})

test('compose com os itens sem resposta, para o prompt', async () => {
  const items = [
    { n: 1, text: 'Primeira' },
    { n: 2, text: 'Segunda' },
  ]
  expect(compose(items, { 1: 'sim' }, true)).toBe('1. (Primeira) sim\n2. (Segunda) ')
  expect(compose(items, { 1: 'sim' })).toBe('1. (Primeira) sim')
})
