// Arquivos de senha e chave, pelo nome. Os modelos (.env.example) e as chaves públicas ficam de fora.
const SECRET_NAMES = [
  /^\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?$/i,
  /^id_[a-z0-9_-]+$/i,
  /\.(pem|key|p12|pfx|kdbx|ppk)$/i,
  /recovery-key/i,
  /^credentials(\.[\w]+)?$/i,
  /^secrets?\.(json|ya?ml|toml|txt|env)$/i,
]

function baseName(path: string): string {
  const clean = path.replace(/^['"]|['"]$/g, '').replace(/[\\/]+$/, '')
  return clean.split(/[\\/]/).pop() ?? clean
}

export function isSecretPath(path: string): boolean {
  const name = baseName(path)
  return name !== '' && SECRET_NAMES.some(re => re.test(name))
}

// Comandos que mostram o conteúdo de um arquivo.
const SHOWS_CONTENT =
  /^(cat|type|more|less|head|tail|nl|tac|grep|egrep|fgrep|rg|sed|awk|cut|sort|uniq|strings|xxd|od|hexdump|base64|diff|cmp|jq|yq|bat|gc|Get-Content|Select-String|Format-Hex|Import-Csv|ConvertFrom-Json)$/i

// Cada trecho do comando (separado por pipe, ;, &&, $( ) e crases) que lê um arquivo secreto.
export function revealsSecret(command: string): boolean {
  return command
    .split(/&&|\|\||[;|\n`()]|\$\(/)
    .map(part => part.trim())
    .some(part => {
      const words = part.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
      const verb = (words[0] ?? '').replace(/^.*[\\/]/, '')
      if (!SHOWS_CONTENT.test(verb)) return false
      return words.slice(1).some(word => !word.startsWith('-') && isSecretPath(word))
    })
}

const REFUSAL =
  'segredos: o conteúdo de arquivos de senha e chave não é lido nem mostrado. ' +
  'Dá para usar o arquivo (ssh -i, carregar o .env num comando), gravar, copiar e mover; para conferir um valor, peça ao usuário.'

// A recusa, ou undefined quando a chamada pode seguir.
export function refusal(tool: string, input: Record<string, unknown>): string | undefined {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  if (tool === 'Read' || tool === 'NotebookRead') return isSecretPath(text('file_path')) ? REFUSAL : undefined
  if (tool === 'Grep') return isSecretPath(text('path')) || isSecretPath(text('glob')) ? REFUSAL : undefined
  if (tool === 'Bash' || tool === 'PowerShell') return revealsSecret(text('command')) ? REFUSAL : undefined
  return undefined
}
