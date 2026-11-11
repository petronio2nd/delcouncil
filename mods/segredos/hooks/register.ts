import type { Register } from 'claude-code'

import { refusal } from './rules'

export const register: Register = on => {
  on('tool.call', ($, e, next) => {
    const why = refusal(String(e.tool), e as unknown as Record<string, unknown>)
    if (why === undefined) return next(e)
    $.ui.toast('🔒 segredos: leitura de arquivo de senha recusada')
    return { deny: why }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'segredos: a guarda falhou; recusado por segurança.' }))
}
