// O cache do prompt vale 1 hora a partir da última chamada ao modelo
// (promptCacheTtl "1h" no ~/.claude/settings.json).
export const CACHE_TTL_MS = 60 * 60 * 1000

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  contextPercent?: number
  limits: Limit[]
  lastRequestAt?: number
  now: number
}

// Os dois limites da assinatura, sempre nesta ordem; outros entram pelo nome cru.
const LIMITS: [kind: string, name: string][] = [
  ['five_hour', '5h'],
  ['seven_day', 'sem'],
]

// Uma bolinha por item. ⚪ = sem leitura.
const DOTS = ['🟢', '🟡', '🔴']
const NO_READING = '⚪'

// Limiares de cada medida, sobre o número que aparece na linha: [🟡 a partir de, 🔴 a partir de].
export const CONTEXT_LEVELS: [number, number] = [60, 80]
export const LIMIT_LEVELS: [number, number] = [60, 85]
// Cache: 🟡 a 5 minutos de esfriar; 🔴 frio.
export const CACHE_WARN_MIN = 5

export function dot(pct: number, [warn, alarm]: [number, number]): string {
  return DOTS[pct >= alarm ? 2 : pct >= warn ? 1 : 0]
}

// "45min", "2h10", "3d": quanto falta para a janela zerar.
export function untilReset(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined) return undefined
  const minutes = Math.ceil((Date.parse(resetsAt) - now) / 60000)
  if (Number.isNaN(minutes) || minutes <= 0) return undefined
  if (minutes < 60) return `${minutes}min`
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
  }
  return `${Math.round(minutes / (24 * 60))}d`
}

function limitText(name: string, limit: Limit | undefined): string {
  if (limit === undefined) return `${NO_READING} ${name} –`
  const pct = Math.round(limit.percentUsed)
  return `${dot(pct, LIMIT_LEVELS)} ${name} ${pct}%`
}

function cacheText(left: number): string {
  if (left <= 0) return `${DOTS[2]} cache frio`
  return `${DOTS[left <= CACHE_WARN_MIN ? 1 : 0]} cache ${left}min`
}

// Uma linha, do que mais pesa na escolha do modelo para o que menos pesa, porque o
// app corta o fim: 5h e semana, outros limites, contexto, cache e, por último,
// quanto falta para 5h e semana zerarem.
export function formatStatus(r: Reading): string {
  const parts: string[] = []
  const resets: (string | undefined)[] = []
  if (r.limits.length > 0) {
    for (const [kind, name] of LIMITS) {
      const limit = r.limits.find(l => l.kind === kind)
      parts.push(limitText(name, limit))
      resets.push(untilReset(limit?.resetsAt, r.now))
    }
    for (const limit of r.limits.filter(l => !LIMITS.some(([kind]) => kind === l.kind))) {
      parts.push(limitText(limit.kind, limit))
    }
  }
  if (r.contextPercent !== undefined) {
    const pct = Math.round(r.contextPercent)
    parts.push(`${dot(pct, CONTEXT_LEVELS)} ctx ${pct}%`)
  }
  if (r.lastRequestAt !== undefined) {
    parts.push(cacheText(Math.ceil((r.lastRequestAt + CACHE_TTL_MS - r.now) / 60000)))
  }
  if (resets.some(t => t !== undefined)) {
    parts.push(`zera ${resets.map(t => t ?? '–').join(' / ')}`)
  }
  return parts.join(' · ')
}
