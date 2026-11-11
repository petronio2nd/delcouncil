export const SECTION_ID = 'portugues:idioma'

export const RULE =
  'Idioma: responda ao usuário sempre em português do Brasil, em toda mensagem, inclusive depois de um resumo ' +
  'de contexto escrito em inglês. Nomes de código, comandos e citações literais ficam como estão.'

export const COMPACT_RULE = 'Escreva o resumo inteiro em português do Brasil.'

// Junta a regra do resumo às instruções que o /compact já trouxer.
export function withCompactRule(instructions: string | undefined): string {
  if (instructions === undefined || instructions.trim() === '') return COMPACT_RULE
  if (instructions.includes(COMPACT_RULE)) return instructions
  return `${instructions.trim()}\n\n${COMPACT_RULE}`
}
