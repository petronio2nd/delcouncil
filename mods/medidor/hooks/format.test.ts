import { expect, test } from 'claude-code/testing'

import { CACHE_TTL_MS, CONTEXT_LEVELS, LIMIT_LEVELS, dot, formatStatus, untilReset } from './format'

const now = Date.parse('2026-10-09T12:00:00Z')
const limits = [
  { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-09T14:10:00Z' },
  { kind: 'seven_day', percentUsed: 61, resetsAt: '2026-10-12T12:00:00Z' },
]

test('linha completa: limites primeiro, uma bolinha por item, zera no fim', async () => {
  expect(formatStatus({ contextPercent: 41.2, limits, lastRequestAt: now - 23 * 60000, now })).toBe(
    '🟢 5h 24% · 🟡 sem 61% · 🟢 ctx 41% · 🟢 cache 37min · zera 2h10 / 3d',
  )
})

test('limiares do contexto: 🟡 a partir de 60%, 🔴 a partir de 80%', async () => {
  expect(dot(59, CONTEXT_LEVELS)).toBe('🟢')
  expect(dot(60, CONTEXT_LEVELS)).toBe('🟡')
  expect(dot(79, CONTEXT_LEVELS)).toBe('🟡')
  expect(dot(80, CONTEXT_LEVELS)).toBe('🔴')
})

test('limiares de 5h e semana: 🟡 a partir de 60%, 🔴 a partir de 85%', async () => {
  expect(dot(59, LIMIT_LEVELS)).toBe('🟢')
  expect(dot(60, LIMIT_LEVELS)).toBe('🟡')
  expect(dot(84, LIMIT_LEVELS)).toBe('🟡')
  expect(dot(85, LIMIT_LEVELS)).toBe('🔴')
  expect(
    formatStatus({
      limits: [
        { kind: 'five_hour', percentUsed: 85 },
        { kind: 'seven_day', percentUsed: 62 },
      ],
      now,
    }),
  ).toBe('🔴 5h 85% · 🟡 sem 62%')
})

test('a bolinha segue o número arredondado da linha', async () => {
  expect(formatStatus({ limits: [{ kind: 'five_hour', percentUsed: 59.6 }], now })).toBe('🟡 5h 60% · ⚪ sem –')
  expect(formatStatus({ contextPercent: 79.4, limits: [], now })).toBe('🟡 ctx 79%')
})

test('cache: 🟡 a 5 minutos de esfriar, 🔴 frio', async () => {
  expect(formatStatus({ limits: [], lastRequestAt: 0, now: CACHE_TTL_MS - 6 * 60000 })).toBe('🟢 cache 6min')
  expect(formatStatus({ limits: [], lastRequestAt: 0, now: CACHE_TTL_MS - 5 * 60000 })).toBe('🟡 cache 5min')
  expect(formatStatus({ limits: [], lastRequestAt: 0, now: CACHE_TTL_MS })).toBe('🔴 cache frio')
})

test('limite sem leitura aparece com ⚪ e traço', async () => {
  expect(formatStatus({ contextPercent: 9, limits: [{ kind: 'seven_day', percentUsed: 30 }], now })).toBe(
    '⚪ 5h – · 🟢 sem 30% · 🟢 ctx 9%',
  )
})

test('limite de outro tipo entra pelo nome cru, com bolinha', async () => {
  expect(formatStatus({ limits: [...limits, { kind: 'opus_week', percentUsed: 90 }], now })).toBe(
    '🟢 5h 24% · 🟡 sem 61% · 🔴 opus_week 90% · zera 2h10 / 3d',
  )
})

test('zera: traço para o limite sem horário', async () => {
  expect(
    formatStatus({ limits: [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 20, resetsAt: '2026-10-12T12:00:00Z' }], now }),
  ).toBe('🟢 5h 10% · 🟢 sem 20% · zera – / 3d')
})

test('tempo até zerar', async () => {
  expect(untilReset('2026-10-09T12:45:00Z', now)).toBe('45min')
  expect(untilReset('2026-10-09T15:00:00Z', now)).toBe('3h')
  expect(untilReset('2026-10-09T11:00:00Z', now)).toBeUndefined()
})

test('sem leitura, nada', async () => {
  expect(formatStatus({ limits: [], now: 0 })).toBe('')
})
