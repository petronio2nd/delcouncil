# O método

Este documento explica **o que o delcouncil faz e por quê**. Para instalar, vá a [`instalacao.md`](instalacao.md). O texto normativo, com todos os detalhes e casos de borda, está nas skills: [`orquestrador`](../skills/orquestrador/SKILL.md), [`dupla`](../skills/dupla/SKILL.md) e [`revisor`](../skills/revisor/SKILL.md). A fonte única dos números é [`politica-modelos.json`](../skills/orquestrador/politica-modelos.json).

## 1. A ideia

Um agente de IA bom em tudo e caro em tudo é um desperdício; um barato em tudo erra onde importa. O método trata isso como suporte de TI: cada tarefa entra no nível que a resolve e **sobe um degrau só quando falha de verdade**. E, como quem escreve não deve ser o único a conferir, a entrega de risco passa por um modelo de outra família.

Quatro dimensões, que **não se misturam**:

| Dimensão | Valores | Quem decide |
|---|---|---|
| **Capacidade** | N1, N2, N3 | o orquestrador, pela dificuldade conhecida da fatia |
| **Esforço** | `low`, `medium`, `high` | a política (padrão por nível); sobe em nova tentativa |
| **Risco** | L0, L1, L2 | o script de revisão calcula pelo diff; o orquestrador pode forçar |
| **Fonte de consumo** | assinatura, API, créditos | a **trava global**; só o dono libera |

Economia nunca reduz o piso de capacidade nem de esforço; falta de cota nunca autoriza baixar o nível. Sem parecer de revisão, a etapa fica **pendente**, não "aprovada por omissão".

## 2. Execução: N1, N2, N3

| Capacidade | Modelos (exemplo do autor) | Esforço inicial | Escalada | Uso |
|---|---|---|---|---|
| **N1 — simples** | Haiku, Luna, Gemini Flash-Lite | `low` | `medium` | leitura, busca, triagem, tarefa simples com aceite claro |
| **N2 — comum** | Sonnet, Terra, Gemini Flash | `low` | `medium` | implementação comum, diagnóstico, integração delimitada |
| **N3 — difícil** | Opus, Sol | `medium` | `high` | arquitetura, desenho, migração, problema difícil, orquestração |

Regras:

- **Sempre a versão mais nova de cada família.** O id citado é só exemplo.
- Entre direto no nível adequado quando a dificuldade já é conhecida; **escale um degrau por falha real, em nova tentativa**. Não gaste chamadas só para "passar pelos três".
- Modelo e esforço ficam **fixos durante a fatia**. Escalar é abrir outra tentativa (outra fatia), nunca trocar no meio.
- Uma reserva (outro modelo quando falta cota) **mantém a capacidade exigida ou sobe**.
- Contexto enxuto e **sessão nova por fatia**: ninguém relê um histórico enorme para começar.

## 3. Revisão: L0, L1, L2

Revisor e árbitro vêm de um conjunto próprio de famílias (`revisao.familias` na política; no ambiente do autor: Astra, Fable, Argon), **todas N3**, e elas **não executam nem orquestram**. A regra de ouro: **o revisor é de outra família que o autor** e nunca abaixo dele em força.

| Nível | Quando | Revisão |
|---|---|---|
| **L0** | texto/docs, rename, menos de ~30 linhas sem dado | sem outra família; `/code-review` só se houver código |
| **L1** | o comum: código novo, mais de ~30 linhas, suposição não testada | outra família N3 em `low` |
| **L2** | dado, dinheiro, produção, segredo, apagar/sobrescrever, migração, irreversível | outra família N3 em `medium`; testes obrigatórios; árbitro em qualquer `bloqueia` recusado |

Camadas e limites:

- **`/code-review`** (revisão do próprio agente sobre o diff) vem **antes**, como camada a mais: `low` no comum, `medium` em risco elevado; texto sem código dispensa.
- **Teto de duas rodadas cruzadas por fatia.** Sem terceira: o que continua em disputa vai ao **árbitro** (outra rodada, outra família); o que falta é decisão do dono vai a ele.
- **Delta pequeno** (correção dos achados, até ~30 linhas, sem mudar o desenho) vai só ao `/code-review`, sem nova rodada cruzada.
- **Configuração e código inativo descem um degrau.** O L2 fica para a publicação ou ativação.
- **Uma camada por papel.** Revisão extra que repete o mesmo pedido e diff na mesma família foi retirada (a camada `gpt-review.ps1` continua no repositório, **desativada** pela política: `gptExtra: false`).
- O revisor é **somente leitura**: só `Read`, `Grep` e `Glob`, presos à pasta do projeto, sem MCP de escrita nem configuração do projeto. Segredo nunca entra no pacote.
- Cada achado é julgado pelo autor (aceita ou recusa com evidência) e **registrado** no `STATUS.md`, para calibrar a régua.

Os achados têm formato fixo (severidade `bloqueia` / `importante` / `sugestão`, evidência e como verificar); veja [`revisor/SKILL.md`](../skills/revisor/SKILL.md).

## 4. A trava de fontes

Cada forma de gastar tem uma chave global, **sem vencimento**:

`claude-max` (assinatura Claude) · `chatgpt` (assinatura ChatGPT) · `anthropic-api` · `antigravity` · `openrouter`

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1                          # lista
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1 -Acao travar  -Fonte openrouter
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1 -Acao liberar -Fonte openrouter
```

- **Fonte travada fica fora de tudo**: despacho, revisão, arbitragem, reserva, subagente e até consulta que apenas envia prompt. Os plugins aplicam a trava dentro do harness (Claude: nas requisições `turn.step`, compactação e `model.complete`, incluindo subagentes; OpenCode: prompts e inferência HTTP/WebSocket).
- **Falha fechada.** Estado ilegível, inválido ou ausente com marcador (`fontes.json.lock`) **bloqueia todo consumo**. Ninguém edita o estado à mão para contornar; só pelo comando.
- **Só o dono libera.** Nenhum agente destrava por conta própria, nem por "estar tudo certo".
- O estado fica em `%USERPROFILE%\.local\share\dupla\fontes.json`, **fora da virtualização MSIX** de `LOCALAPPDATA`; a leitura une travas de locais legados.
- O agente avisa quando uma trava muda o plano (ex.: "⚠️ Assinatura Claude travada") e usa **outra fonte já autorizada** mantendo capacidade, esforço e revisão; sem alternativa, registra a etapa pendente.

## 5. O orquestrador

A sessão que recebe o pedido **vira orquestradora**: não faz tudo sozinha. Ela:

1. **Classifica** a fatia em N1/N2/N3 (por julgamento, não por palavra-chave) e registra com `rotear_tarefa` (fatia, nível, família, papel, motivo).
2. **Fatia por área de arquivos**: leitura em paralelo, escrita serial; uma fatia por conjunto de arquivos.
3. **Despacha** para o papel mais barato que dá conta:

   | Papel | Quem |
   |---|---|
   | Orquestradora | N3 em `medium` (`high` só quando ela mesma desenha algo difícil) |
   | Sessão filha | N1/N2/N3 conforme a fatia, com brief autossuficiente |
   | Subagente | N1/N2, leitura e conferência mecânica |
   | Executor | `despachar.ps1` → agy ou OpenCode, por nível |
   | Revisor / árbitro | `revisar.ps1`, outra família, pelo nível de risco |

4. **Escolhe a fonte pela folga**: a cada despacho, `recursos.ps1` calcula a fila (quanto sobra da janela − quanto da janela já passou). Gasta-se primeiro o que sobra e se perde no reset; fonte com janela curta quase no fim vai para o fim da fila.
5. **Confere** cada relatório (diff, testes, parecer) antes de aceitar; **registra** no `STATUS.md` (só a orquestradora escreve; as filhas relatam).
6. **Versiona** e fecha a fatia. Premissa mudou? A fatia fecha e a próxima nasce em sessão nova.

Duas separações que valem o método:

- **Do dono ficam só duas coisas**: o *produto* (o que a coisa deve fazer, regra de negócio, dado que só ele tem) e a *ação fora do repositório* (mensagem, dinheiro, produção, apagar fora do git, conta, credencial). O resto o orquestrador decide e diz em uma linha.
- **Produto novo: o dono usa antes de planejar.** A primeira fatia é o dono usar a coisa uns 20 minutos; plano, conversor e revisão só depois do veredito (seção 0 do orquestrador).

## 6. A política: um arquivo, vários leitores

[`politica-modelos.json`](../skills/orquestrador/politica-modelos.json) (versão 2) guarda capacidades, famílias, esforços, a regra de revisão e os limites. É lido pelos scripts (`politica-modelos.ps1`) e pelos plugins (`orquestra`, `gemeo`), e **recusado por qualquer leitor que não entenda a versão** (falha fechada, sem rotear errado). Ao mudar o arquivo, rode as suítes de teste (`testar-politica-modelos.ps1` e os testes dos mods).

## 7. Os plugins

- **`orquestra`** (Claude Code): painel ao vivo (`/orquestra`) com a sessão, as filhas, o que espera o dono, as revisões prontas e a folga das cotas; a ferramenta `rotear_tarefa` (consultar/preparar); aplicação da rota por fatia nas requisições do próprio harness; e `/orquestra fontes` para travar e liberar.
- **`gemeo`** (OpenCode): replica no OpenCode as ferramentas do Claude Code com os mesmos nomes (`set_session_title`, `start_session`, `rotear_tarefa`, `list_events`, `get_usage`...), aplica e **confere** modelo/variante antes do primeiro prompt, resolve o canal Antigravity e respeita a trava.

Os dois só conseguem aplicar o que o harness permite; a skill orienta, o código aplica, e o relatório distingue **pedido** de **aplicado**.

## 8. Fluxo de uma entrega

```
pedido ─▶ orquestradora classifica (N1/N2/N3) ─▶ confere trava de fontes
      ─▶ fatia ─▶ executa (filha / executor / subagente) ─▶ testes
      ─▶ /code-review (código) ─▶ nível de risco (L0/L1/L2)
      ─▶ revisão cruzada (outra família) ─▶ autor julga cada achado
      ─▶ [disputa? árbitro] ─▶ registra no STATUS.md ─▶ commit
```

## 9. O que o método não promete

- Não prova correção: **testes e leitura do diff continuam sendo do autor**; a revisão cruzada reduz ponto cego, não o elimina.
- Não substitui o dono nas decisões de produto e nas ações externas.
- A qualidade depende dos modelos que você tem: a tabela de famílias é um *exemplo* a ser trocado.
