# Instruções globais: trecho para o seu CLAUDE.md / AGENTS.md

Cole o que fizer sentido. Troque `<você>` pelo seu nome e ajuste os caminhos. Este trecho é genérico; o texto completo das regras mora nas skills.

```markdown
## Agentes: orquestração e revisão

- **Chaves globais de consumo.** Antes de chamar outro modelo, abrir sessão filha, usar subagente
  ou tentar uma reserva, consulte `~/.agents/skills/dupla/scripts/fontes.ps1`. Fonte travada fica
  fora de tudo, inclusive chamadas diretas e consultas que enviam prompt. Só pedido explícito de
  <você> libera. Avise com ⚠️ (ex.: "⚠️ Assinatura Claude travada") e use outra fonte já autorizada
  mantendo capacidade, esforço e revisão; sem alternativa, registre a etapa pendente. Estado
  ilegível não libera consumo. Nunca edite o estado para contornar a trava.
- **N1/N2/N3.** Antes de tarefa nova ou despacho, julgue a capacidade pela skill `orquestrador`
  e sua `politica-modelos.json`. Capacidade e esforço são dimensões separadas; economia não reduz
  o piso de nenhuma. Registre com `rotear_tarefa` (fatia, nível, família, papel, motivo). Não
  classifique por palavra do prompt. Modelo e esforço ficam fixos na fatia; escalada exige nova
  tentativa.
- **Decida sozinho, sem perguntar:** orquestrar ou não, abrir filha e em que modelo, despachar a
  executores ou reservas, mandar à revisão cruzada e em que nível, usar subagentes. Diga em uma
  linha o que decidiu e siga.
- **Com <você> ficam só duas coisas:** o produto (o que a coisa deve fazer, regra de negócio, dado
  que só <você> tem) e a ação fora do repositório (mensagem, dinheiro, produção, apagar fora do
  git, conta, credencial).
- **Produto ou ferramenta nova:** antes da primeira fatia, <você> usa a coisa por uns 20 minutos
  (seção 0 do `orquestrador`). Nada de plano revisado, conversor ou script antes do veredito.
- **Revisão por outra família, não por harness.** O revisor é de família diferente da do autor e
  nunca abaixo dele; o nível (L0/L1/L2) segue o risco da entrega (skill `dupla`, seção 0).
  `/code-review` no diff quando há código, como camada a mais: `low` no comum, `medium` em risco
  elevado; texto sem código dispensa.
- **STATUS.md** na raiz do projeto é o quadro que as sessões dividem. Se existir, leia no começo
  da sessão e atualize ao fim de cada etapa concluída; só a orquestradora escreve nele.

## Git

- Commit e push ao fim de cada etapa conferida (testes passando, revisão feita quando a skill
  `dupla` manda). Só os seus arquivos, listados por caminho no `git add` (nunca `-A`). Nada
  pessoal nem segredo no git. Push que dispara deploy em produção espera o OK de <você>.
```

> Estas linhas são a versão genérica das regras do autor. Se você preferir que o agente **pergunte** antes de commitar ou de despachar, troque os trechos "decida sozinho" e "commit e push" pela sua preferência: o método funciona com as duas.
