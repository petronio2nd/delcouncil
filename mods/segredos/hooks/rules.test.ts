import { expect, test } from 'claude-code/testing'

import { isSecretPath, refusal, revealsSecret } from './rules'

test('nomes de arquivo secretos', async () => {
  for (const path of ['.env', 'D:\\proj\\.env.local', '/home/p/.ssh/id_vm', '~/.ssh/id_ed25519', 'cert.pem', 'restic-recovery-key.txt', 'credentials.json']) {
    expect(isSecretPath(path)).toBe(true)
  }
  for (const path of ['.env.example', 'id_vm.pub', 'README.md', 'environment.md', 'keys.ts']) {
    expect(isSecretPath(path)).toBe(false)
  }
})

test('shell: mostrar não, usar sim', async () => {
  expect(revealsSecret('cat .env')).toBe(true)
  expect(revealsSecret('ls && Get-Content "C:\\x\\restic-recovery-key.txt"')).toBe(true)
  expect(revealsSecret('grep DB_PASSWORD /srv/app/.env.production')).toBe(true)
  expect(revealsSecret('echo $(cat ~/.ssh/id_vm)')).toBe(true)
  expect(revealsSecret('ssh -i ~/.ssh/id_vm vm uptime')).toBe(false)
  expect(revealsSecret('echo "DB_PASSWORD=x" >> .env')).toBe(false)
  expect(revealsSecret('cp .env .env.bak')).toBe(false)
  expect(revealsSecret('cat .env.example')).toBe(false)
  expect(revealsSecret('cat README.md | grep env')).toBe(false)
})

test('ferramentas', async () => {
  expect(refusal('Read', { file_path: 'D:\\p\\.env' })).toBeDefined()
  expect(refusal('Read', { file_path: 'D:\\p\\app.ts' })).toBeUndefined()
  expect(refusal('Grep', { pattern: 'KEY', path: '.env' })).toBeDefined()
  expect(refusal('Edit', { file_path: '.env' })).toBeUndefined()
  expect(refusal('Bash', { command: 'cat .env' })).toBeDefined()
})
