export type Waiting = boolean

declare module 'claude-code' {
  interface PluginState {
    aguardar: { isWaiting: Waiting }
  }
}
