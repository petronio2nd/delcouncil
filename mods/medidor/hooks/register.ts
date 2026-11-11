import type { EngineInterface, Register } from 'claude-code'

import { formatStatus } from './format'

// Hora da última chamada ao modelo; um reload zera até o próximo turno.
let lastRequestAt: number | undefined

async function refresh($: EngineInterface) {
  const usage = await $.session.usage()
  const text = formatStatus({
    contextPercent: usage.context.percent,
    limits: usage.rateLimits,
    lastRequestAt,
    now: await $.clock.now(),
  })
  $.ui.status(text === '' ? undefined : text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(30_000, () => void refresh($))
    await refresh($)
    return next(e)
  })

  // Cada passo do turno é uma chamada ao modelo: o relógio do cache recomeça.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    lastRequestAt = await $.clock.now()
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($)
    return result
  })
}
