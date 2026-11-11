import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { ASKS_WAIT, isAllowedWhileWaiting, RELEASES } from './rules'

const isWaiting = atom({ plugin: 'aguardar', key: 'isWaiting' } as const, false)

const STATUS = '⏸️ aguardando: só leitura'
const NOTE =
  'Modo aguardar ligado: o usuário pediu para não executar nada. Só leia, pesquise e planeje; ' +
  'ferramentas que mudam algo serão recusadas até ele liberar (/liberar ou "vamos começar").'

async function setWaiting($: EngineInterface, value: boolean) {
  await update($, isWaiting, () => value)
  $.ui.status(value ? STATUS : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'aguardar', description: 'Trava tudo que muda algo até /liberar' })
    await $.command.register({ name: 'liberar', description: 'Desliga o modo aguardar' })
    if (await read($, isWaiting)) $.ui.status(STATUS)
    return next(e)
  })

  on('command.run', { command: 'aguardar' }, async $ => {
    await setWaiting($, true)
    return { text: 'Modo aguardar ligado: só leitura até /liberar.', context: [NOTE] }
  })

  on('command.run', { command: 'liberar' }, async $ => {
    await setWaiting($, false)
    return { text: 'Modo aguardar desligado.', context: ['Modo aguardar desligado: pode executar.'] }
  })

  // As frases do usuário ligam e desligam o modo; enquanto ligado, cada prompt leva o aviso ao modelo.
  on('prompt.submit', async ($, e, next) => {
    if (ASKS_WAIT.test(e.text)) {
      await setWaiting($, true)
      $.ui.toast('⏸️ Modo aguardar ligado: só leitura até /liberar')
    } else if (RELEASES.test(e.text) && (await read($, isWaiting))) {
      await setWaiting($, false)
      $.ui.toast('🔓 Modo aguardar desligado')
    }
    if (!(await read($, isWaiting))) return next(e)
    return next({ ...e, context: [...(e.context ?? []), NOTE] })
  })

  on('tool.call', async ($, e, next) => {
    if (!(await read($, isWaiting))) return next(e)
    if (isAllowedWhileWaiting(String(e.tool), e)) return next(e)
    return { deny: `${NOTE} Recusado: ${String(e.tool)}.` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'aguardar: a guarda falhou; recusado por segurança.' }))
}
