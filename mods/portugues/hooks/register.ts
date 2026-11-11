import type { Register } from 'claude-code'

import { RULE, SECTION_ID, withCompactRule } from './lang'

export const register: Register = on => {
  // Uma seção fixa no fim das instruções de cada turno.
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return {
      sections: [...sections.filter(s => s.id !== SECTION_ID), { id: SECTION_ID, text: RULE, scope: 'session' }],
    }
  })

  // O resumo do /compact também sai em português.
  on('session.compact', ($, e, next) => next({ ...e, instructions: withCompactRule(e.instructions) })).catch(
    ($, e, next) => next(e),
  )
}
