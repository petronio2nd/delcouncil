import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item } from '../types'
import { compose, isRun, isYesNo, parseItems, RAN } from './parse'

const items = atom({ plugin: 'responder', key: 'items' } as const, [] as Item[])
const answers = atom({ plugin: 'responder', key: 'answers' } as const, {} as Record<string, string>)
const isHidden = atom({ plugin: 'responder', key: 'isHidden' } as const, false)

// O que o usuário digita nos campos. Fica fora do estado de propósito: gravar no estado
// redesenha a faixa a cada letra, e o campo pisca.
let drafts: Record<string, string> = {}

// Turnos que o usuário não pediu (aviso de tarefa em segundo plano, rotina, outra sessão).
// A resposta a eles não apaga as perguntas que ainda estão na faixa.
const AUTOMATIC = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay'])
let isAutomaticTurn = false

// Os botões (sim, não, rodei) gravam no estado; o digitado, nos rascunhos. O digitado vale mais.
async function given($: EngineInterface): Promise<Record<string, string>> {
  return { ...(await read($, answers)), ...drafts }
}

// Esconde a faixa e manda as respostas como mensagem do usuário; nada a mandar, nada acontece.
async function send($: EngineInterface) {
  const text = compose(await read($, items), await given($))
  if (text === '') return
  await update($, isHidden, () => true)
  await $.prompt.submit({ text, asUser: true })
}

// Leva todos os itens para a caixa grande, respondidos ou não, para completar lá.
async function toPrompt($: EngineInterface) {
  const text = compose(await read($, items), await given($), true)
  if (text === '') return
  await update($, isHidden, () => true)
  await $.prompt.fill({ text, mode: 'append' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'responder',
      description: 'Mostra de novo a faixa para responder os itens da última resposta',
    })
    return next(e)
  })

  on('command.run', { command: 'responder' }, async $ => {
    await update($, isHidden, () => false)
    const list = await read($, items)
    return { text: list.length > 0 ? `Faixa aberta com ${list.length} itens.` : 'A última resposta não tem itens numerados.' }
  })

  on('prompt.submit', ($, e, next) => {
    isAutomaticTurn = AUTOMATIC.has(e.origin.kind)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Ao fim de cada turno da conversa principal, lê os itens da resposta.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      const found = parseItems(e.answer)
      if (found.length === 0 && isAutomaticTurn) return next(e)
      drafts = {}
      await update($, items, () => found)
      await update($, answers, () => ({}))
      await update($, isHidden, () => false)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const list = await read($, items)
    if (e.props.hasSurvey || e.props.isWorking || list.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const current = await given($)
    const done = list.filter(item => (current[item.n] ?? '').trim() !== '').length
    // Botão: grava no estado (redesenha para marcar o botão) e substitui o digitado.
    const choose = (n: number, value: string) => {
      drafts = { ...drafts, [n]: value }
      return update($, answers, all => ({ ...all, [n]: value }))
    }
    const hide = () => update($, isHidden, () => true)

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          Responder · {done} de {list.length} · Tab vai para o próximo · Enter envia · resposta longa: "Pôr no prompt"
        </Text>
        {list.map(item => {
          const value = current[item.n] ?? ''
          return (
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text>
                  <Text bold>{item.n}. </Text>
                  {item.text}
                </Text>
                {isYesNo(item.text) && (
                  <Button
                    key={`yes-${item.n}`}
                    label="sim"
                    variant={value === 'sim' ? 'primary' : 'secondary'}
                    onPress={() => choose(item.n, 'sim')}
                  />
                )}
                {isYesNo(item.text) && (
                  <Button
                    key={`no-${item.n}`}
                    label="não"
                    variant={value === 'não' ? 'primary' : 'secondary'}
                    onPress={() => choose(item.n, 'não')}
                  />
                )}
                {isRun(item.text) && (
                  <Button
                    key={`ran-${item.n}`}
                    label="rodei"
                    variant={value === RAN ? 'primary' : 'secondary'}
                    onPress={() => choose(item.n, RAN)}
                  />
                )}
              </Box>
              <Input
                key={`item-${item.n}`}
                placeholder={isYesNo(item.text) ? 'ou escreva a resposta' : 'sua resposta'}
                value={value}
                submitLabel="enviar"
                onInput={text => {
                  drafts = { ...drafts, [item.n]: text }
                }}
                onSubmit={text => {
                  drafts = { ...drafts, [item.n]: text }
                  return send($)
                }}
              />
            </Box>
          )
        })}
        <Box flexDirection="row" gap={1} justifyContent="flex-end">
          <Button key="close" label="Fechar" role="dismiss" onPress={hide} />
          <Button key="fill" label="Pôr no prompt" onPress={() => toPrompt($)} />
          <Button key="send" label="Enviar" variant="primary" onPress={() => send($)} />
        </Box>
      </Box>
    )
  })
}
