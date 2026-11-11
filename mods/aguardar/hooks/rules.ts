// Frases do usuário que ligam e desligam o modo.
export const ASKS_WAIT = /n[ãa]o (execute|executa|rode|mexa|fa[çc]a nada)(?![a-zà-ú])|s[óo] aguarde|me aguarde|aguarde e n[ãa]o/i
export const RELEASES = /vamos come[çc]ar|pode (executar|come[çc]ar|seguir|rodar|fazer)|pode ir|est[áa] liberad[oa]/i

// Ferramentas que só leem.
const READ_TOOLS = new Set([
  'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'ToolSearch', 'Skill',
  'TaskList', 'TaskGet', 'TaskOutput', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  'ReadMcpResourceDirTool', 'AskUserQuestion', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode',
])

// Ferramentas MCP de leitura, pelo verbo do nome; mais as do nome da sessão.
const READ_MCP =
  /__(get|list|read|search|fetch|query|find|buscar|ler|onde|pastas|conteudo|copias|lacunas|entidades|vizinhos|caminho|coocorrentes|top_entidades|por_entidade|status|briefing|recent|explore|tabs_context|read_page|get_page_text|read_terminal|read_console|read_network|guide)[a-z_-]*$|__set_session_title$|__set_pinned$/i

// Primeira palavra de cada trecho de um comando de shell que só lê.
const READ_COMMANDS = new Set([
  'ls', 'dir', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'find', 'fd', 'wc', 'pwd',
  'echo', 'printf', 'which', 'where', 'type', 'file', 'stat', 'du', 'df', 'tree', 'diff', 'cmp', 'sort',
  'uniq', 'cut', 'awk', 'jq', 'date', 'whoami', 'hostname', 'uname', 'ps',
  'Get-ChildItem', 'Get-Content', 'Get-Item', 'Get-ItemProperty', 'Test-Path', 'Select-String',
  'Select-Object', 'Where-Object', 'Measure-Object', 'Format-Table', 'Format-List', 'Get-Process',
  'Get-Service', 'Get-ScheduledTask', 'Get-Command', 'Get-Date', 'Resolve-Path', 'Get-Location', 'gci', 'gc',
])
const GIT_READ = /^git\s+(status|log|diff|show|branch\s*$|remote\s+-v|rev-parse|ls-files|blame|describe)/

// Escrita escondida dentro de um comando de leitura: redirecionamento, edição no lugar, subcomando.
const WRITES = /(^|[^0-9&])>|\b(sed|perl)\s+-i|-delete\b|-exec\b|\bxargs\b|Out-File|Set-Content|Add-Content|Remove-Item|\$\(|`/

export function isReadOnlyShell(command: string): boolean {
  const bare = command.replace(/2>\s*\/dev\/null|2>\$null|2>&1/g, '')
  if (WRITES.test(bare)) return false
  return bare
    .split(/&&|\|\||[;|\n]/)
    .map(part => part.trim())
    .filter(part => part !== '')
    .every(part => {
      const word = part.split(/\s+/)[0] ?? ''
      if (word === 'git') return GIT_READ.test(part)
      return READ_COMMANDS.has(word)
    })
}

export function isAllowedWhileWaiting(tool: string, input: unknown): boolean {
  if (READ_TOOLS.has(tool)) return true
  if (tool.startsWith('mcp__')) return READ_MCP.test(tool)
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = (input as { command?: unknown }).command
    return typeof command === 'string' && isReadOnlyShell(command)
  }
  return false
}
