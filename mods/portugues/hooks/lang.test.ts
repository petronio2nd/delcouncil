import { expect, test } from 'claude-code/testing'

import { COMPACT_RULE, withCompactRule } from './lang'

test('regra do resumo', async () => {
  expect(withCompactRule(undefined)).toBe(COMPACT_RULE)
  expect(withCompactRule('foque no deploy')).toBe(`foque no deploy\n\n${COMPACT_RULE}`)
  expect(withCompactRule(`x\n\n${COMPACT_RULE}`)).toBe(`x\n\n${COMPACT_RULE}`)
})
