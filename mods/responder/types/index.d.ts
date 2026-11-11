export type Item = { n: number; text: string }

declare module 'claude-code' {
  interface PluginState {
    responder: {
      items: Item[]
      answers: Record<string, string>
      isHidden: boolean
    }
  }
}
