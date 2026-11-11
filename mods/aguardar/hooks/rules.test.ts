import { expect, test } from 'claude-code/testing'

import { ASKS_WAIT, isAllowedWhileWaiting, isReadOnlyShell, RELEASES } from './rules'

test('frases que ligam e desligam', async () => {
  expect(ASKS_WAIT.test('quero fazer uma faxina. nao execute e me aguarde')).toBe(true)
  expect(ASKS_WAIT.test('vamos fazer uma faxina? só aguarde e não execute nada')).toBe(true)
  expect(ASKS_WAIT.test('pode commitar')).toBe(false)
  expect(RELEASES.test('acabei de desabilitar... entao vamos começar')).toBe(true)
  expect(RELEASES.test('me explica melhor')).toBe(false)
})

test('shell só de leitura', async () => {
  expect(isReadOnlyShell('ls -la /c/Users && git status')).toBe(true)
  expect(isReadOnlyShell('cat a.txt | grep foo | wc -l')).toBe(true)
  expect(isReadOnlyShell('Get-ChildItem D:\\ 2>$null')).toBe(true)
  expect(isReadOnlyShell('git commit -m x')).toBe(false)
  expect(isReadOnlyShell('echo x > a.txt')).toBe(false)
  expect(isReadOnlyShell('rm -rf build')).toBe(false)
  expect(isReadOnlyShell('find . -name "*.tmp" -delete')).toBe(false)
  expect(isReadOnlyShell('ls $(rm x)')).toBe(false)
})

test('ferramentas', async () => {
  expect(isAllowedWhileWaiting('Read', { file_path: 'a' })).toBe(true)
  expect(isAllowedWhileWaiting('Edit', { file_path: 'a' })).toBe(false)
  expect(isAllowedWhileWaiting('Write', { file_path: 'a' })).toBe(false)
  expect(isAllowedWhileWaiting('mcp__acervo__buscar', {})).toBe(true)
  expect(isAllowedWhileWaiting('mcp__trello__add_card_to_list', {})).toBe(false)
  expect(isAllowedWhileWaiting('mcp__ccd_session_mgmt__set_session_title', {})).toBe(true)
  expect(isAllowedWhileWaiting('Bash', { command: 'git push' })).toBe(false)
})
