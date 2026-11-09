---
name: orquestrador
description: "Orquestrar trabalho com várias frentes: dividir por arquivos, escolher executores e revisores, acompanhar entregas e conferir resultados. Use quando o usuário pedir orquestração ou quando dividir entre agentes trouxer ganho real. Inclui reservas de modelos e fontes, sem pular revisão por falta de cota; produto e ações externas não autorizadas ficam com o usuário."
---

# Orquestrador: trabalho de porte em níveis

A sessão que recebe o pedido não faz tudo sozinha: vira orquestradora, fatia, despacha para níveis mais
baratos ou especializados e fica com o que só ela pode fazer: conferir, registrar e versionar. Ela decide
sozinha quando orquestrar, abrir filha, despachar, revisar e em que nível: nenhuma dessas decisões vai ao
usuário (usuário, 2026-10-19: "algumas tomadas de decisão podem ser feitas por toda essa IA, com acerto muito
grande e dependendo pouco de mim"). A revisão cruzada, o executor e o árbitro estão na skill `dupla`;
aqui só o que é da orquestração.

## 0. Antes da primeira fatia, o usuário usa a coisa

Produto, ferramenta ou sistema novo (um app, uma biblioteca, um fluxo que o usuário ainda não usou): a
primeira fatia é o usuário usando a coisa de verdade por uns 20 minutos, antes de plano revisado, conversor
ou script. A orquestradora prepara o teste (sobe a instância, carrega uma amostra, aponta o que olhar) e
para na **Sua vez** com ▶️. O plano só nasce depois do veredito dele.

Por quê: num caso real, um conversor, 43 tarefas agendadas e três revisões de plano foram jogados fora
depois que o usuário usou o sistema de destino por meia hora e preferiu o de origem. Cinco horas de
orquestração polida sobre uma premissa que vinte minutos dele derrubaram.

Quando a premissa muda no meio (o sistema troca, o usuário muda o que quer), a fatia fecha: STATUS.md, commit e
push, HANDOFF.md, sessão nova. Não atravesse a mudança na mesma sessão.

## 1. O que é do usuário e o que é seu

Do usuário, e só isto:

- **Produto:** o que a coisa deve fazer, o que fica e o que sai, regra de negócio e dado que só ele tem.
  Pergunta dessas vira 🧠 na **Sua vez**; as outras fatias não param esperando.
- **Ação fora do repositório:** mensagem, dinheiro, produção, apagar ou sobrescrever fora do git, conta,
  credencial, compartilhamento. Push que dispara deploy em produção entra aqui.

Seu, sem perguntar: commit e push de cada entrega conferida, direto no `main` (usuário, 2026-10-19: "não
quero que pergunte mais, simplesmente sempre commit e push"; regra de projeto que diz "commit só quando o
usuário pedir" não vale mais; nos repositórios de time, commit e push vão na branch de trabalho, e PR e merge
só com pedido do usuário, seção Git do `CLAUDE.md` global); orquestrar ou não; abrir filha, em que modelo e raciocínio; despachar aos
executores (agy, opencode); mandar à revisão cruzada e em que nível (`dupla`, seção 0); subagentes em qualquer nível; grupo na
barra lateral. Diga em uma linha o que decidiu e siga. Errar barato e corrigir é melhor do que parar o usuário.

## Trava global por fonte de consumo

Antes de qualquer despacho, revisão, arbitragem, reserva ou subagente (inclusive nativo do
Codex), consulte `dupla/scripts/fontes.ps1 -Json`. A fonte precisa estar liberada. O estado é
global em `%USERPROFILE%\.local\share\dupla\fontes.json`, fora da virtualização MSIX de
`LOCALAPPDATA`. Sem USERPROFILE, usa HOME explícito; sem home absoluto, bloqueia consumo,
com `{ "versao": 1, "bloqueadas": [] }`. Ausência inicial só libera quando estado e marcador `fontes.json.lock` estão ausentes.
Com marcador persistente, estado ausente, inválido ou ilegível bloqueia todo consumo.
A atualização é serializada, seguida da publicação do arquivo; uma falha de publicação que
remova o estado mantém o bloqueio pelo marcador. Não apague o marcador para recuperar o estado.
Não tente provar permissões, atualizar cota por modelo nem ignorar a chave em estado inválido.

Antes de existir estado ou marcador canônico, a leitura une as travas legadas de
`USERPROFILE/AppData/Local/dupla`, `LOCALAPPDATA/dupla` e
`USERPROFILE/AppData/Local/Packages/Claude_*/LocalCache/Local/dupla` (arquivo `fontes.json`).
Qualquer legado ilegível, inválido ou ausente com marcador bloqueia. Ler não grava; a primeira
mutação pedida consolida a união antes da alteração, sem apagar os legados. `-Arquivo` permanece
isolado e não importa legados. Depois, o canônico tem autoridade exclusiva: liberar uma fonte
não reimporta trava antiga; perda do canônico com marcador não o recria. Clientes antigos só
usam o caminho novo após atualização/recarga; não prometa controle global antes disso.

Fontes não são famílias: `claude-max` é a assinatura Claude; `chatgpt` inclui Codex, subagentes
e OpenCode com GPT; `anthropic-api` é o crédito da API; `antigravity` inclui Claude e Gemini via
agy/Antigravity; `openrouter` é o canal pago próprio. Travar assinatura Claude não trava API ou agy.
A trava não vence. Só pedido explícito do usuário autoriza `-Acao liberar`; nenhuma reserva, reset de
cota, perfil, teste ou instalação libera sozinha. O aviso da assinatura é **⚠️ Assinatura Claude travada por você.**

```powershell
# Sem argumentos lista; exemplos só se o usuário pedir a alteração:
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1 -Acao travar -Fonte claude-max
powershell -NoProfile -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\fontes.ps1 -Acao liberar -Fonte claude-max
```

`-Json` produz só JSON em stdout, com `valido`, `bloqueadas`, `avisos`, `arquivo` e `motivo`;
falha retorna 3. `-Arquivo` é para testes isolados. Não altere o estado real para testar.
Scripts de consumo relêem a chave antes de cada tentativa; a rota registra `fonte-travada`
ou `estado-invalido`. Saída 3 permite outra fonte já autorizada, mantendo capacidade, piso de
esforço, família distinta na revisão e limites de gasto. Não há fonte elegível: execução/revisão
pendente, sem reduzir o piso, inventar aprovação nem pedir desbloqueio por conveniência.
A trava impede novas chamadas nos pontos integrados; não cancela inferência já iniciada nem
intercepta, por si só, ferramentas nativas dos apps. Nessas ferramentas, a sessão deve consultar
a chave antes de chamar; não prometa um bloqueio mecânico onde existe apenas esta instrução.

## 2. Quando orquestrar

Por julgamento, não por regra (usuário, 2026-10-18). Orquestre quando dividir rende mais do que custa:

- frentes que andam sozinhas: arquivos disjuntos, nenhuma consome o resultado da outra;
- leitura larga (varredura, inventário, busca em muitos arquivos) que um Haiku faz mais barato e em
  paralelo;
- tarefa fechada e testável que um executor (agy, opencode) faz sem gastar a cota do Claude Code.

Não orquestre quando o brief e a conferência custam mais do que a fatia rende, quando os arquivos se cruzam
(consertos pequenos em arquivos que se tocam, seção 7) ou quando há passo serial no meio. Os 30 minutos e as
duas frentes são pista, não gatilho. Quando o usuário pede ("orquestra", "fatia e despacha"), orquestre mesmo
que o trabalho seja menor.

## 3. Como fatiar

- **Por área de arquivos, nunca por item da lista.** Cada fatia é um conjunto de arquivos ou uma pasta, e
  um escritor só mexe nele: filhas e executores trabalham na pasta real do projeto, sem worktree, e dois
  escritores no mesmo arquivo se sobrescrevem.
- **Escritores em paralelo no mesmo repositório: branch ou worktree por subagente** (usuário, 2026-11-06). Cada
  um commita na sua branch, sem push; a orquestradora confere o diff e os testes, faz a revisão cruzada e
  junta na `main`. Worktree não traz o que o git ignora: fatia que depende desses arquivos fica na pasta
  real, em série. Quem trabalha sozinho continua direto no `main`. Em repositório de time, a base e o destino seguem o
  fluxo do repositório, nunca `main` ou `develop` sem pedido do usuário.
- **Leitura paralela, escrita serial.** Varredura, busca e inventário correm em paralelo com qualquer
  coisa; duas escritas só se os arquivos forem disjuntos.
- **Passo serial no meio quebra a fatia.** Se B consome o que A produz, A primeiro, conferida, depois B.
- **Brief autossuficiente**, porque a filha nasce sem contexto (`context: "fresh"`): projeto e pasta; o que
  ler primeiro (STATUS.md, plano, HANDOFF.md); objetivo; critério de aceite; limites (só estes arquivos,
  sem commit, sem escrever o STATUS.md, sem segredo nem dado pessoal em arquivo versionado, sem ação
  externa); se a fatia escreve código, `/code-review` no próprio diff antes de devolver (`dupla`, seção
  0b); o relatório esperado no fim (o que mudou, como foi testado, o que o code-review achou, o que ficou
  em dúvida). Mesmo molde para a tarefa do executor (`despachar.ps1`), que roda sem o `/code-review`:
  nesse caso quem roda é a mãe.
- **O usuário fala só com a orquestradora.** Todo brief diz: "reporte à orquestradora; sem **Sua vez** e sem
  perguntas ao usuário; se ele escrever aqui, siga só o que a orquestradora repassar". Dúvida de produto vai no
  relatório, e a mãe leva ao usuário. Sessão aberta para responder a uma pergunta dele também devolve a resposta
  à mãe, que repassa. Por quê: em 21/10/2026 (3visao), o usuário falou direto com duas filhas, e cada uma passou
  a agir com o OK dado lá (uma gravou no sistema, outra mandou o pacote a uma reserva) sem a mãe saber. Ele
  disse: "minha interação será completamente por aqui".
- **A filha decide dentro do brief e não pede aprovação de plano.** Com o critério de aceite e os limites
  no brief, ela implementa e relata só no fim. O plano vai à mãe antes só quando tem ação externa ou
  dúvida de produto, que a mãe leva ao usuário. O que passa do critério de aceite (um desenho maior, uma
  frente nova) volta como item do relatório, não como trabalho. Por quê: em 24/10/2026 (linux-server,
  OpenCode), a filha mandou cada plano à mãe, que era da mesma família: foram 16 idas e voltas de 2 a 8
  min cada, e o desenho cresceu a cada uma.
- **Contexto enxuto e sessão nova por fatia** (usuário, 2026-11-03). Cada fatia nasce em sessão nova, com
  o brief, o STATUS.md e o handoff; ninguém relê histórico enorme de conversa para começar. Revisor
  recebe a dieta da `dupla` (diff, pedido, aceite), não o projeto inteiro.
- **Auditoria entrega achados, não correções.** Cada achado que pede trabalho vira uma fatia própria ou um
  item de backlog. Fatia nova vai para uma sessão nova, com o handoff do ai-memory depois do commit da
  anterior; a frente nova não herda o contexto inchado da outra.
- **A filha também orquestra, um nível abaixo.** Ela usa `Agent` à vontade para leitura larga e
  conferência mecânica (seção 5), sem pedir. O que ela não faz é abrir sessão: o app recusa
  `start_session` em turno aberto por outra sessão. Fatia que ela julgar merecer sessão própria vai no
  relatório e como card (`initiation: "own_initiative"`); a mãe abre.
- **O STATUS.md é só da orquestradora.** As filhas relatam; ela registra.

## 4. Capacidade dos modelos e papéis

Use **N1/N2/N3**, como no suporte de TI, para a capacidade necessária (usuário, 2026-10-31; tabela
refeita pelo usuário em 2026-11-03):

**Esforços: um lugar só** (usuário, 2026-11-07). Os valores vivem no perfil em vigor em
[politica-modelos.json](politica-modelos.json); os perfis (`economia`, `folga`) ficam em
[perfis-esforco.json](perfis-esforco.json). `scripts/esforcos.ps1` mostra o perfil e, com `-Perfil <nome>`,
troca, testa, faz commit e push. O texto das skills não repete números: "esforço N2" ou "esforço L1" é o
valor do perfil. O `rotear_tarefa`, o gêmeo e os scripts releem o JSON a cada chamada, então as sessões
abertas pegam a troca na próxima fatia; o que a sessão leu antes no texto não vale como valor.

**Execução**

| Capacidade | Modelos | Esforço inicial | Escalada | Uso |
|---|---|---|---|---|
| **N1 — simples** | Haiku, Luna, Gemini 3.5 Flash-Lite | esforço N1 | escalado N1 | leitura, busca, triagem e tarefa simples com aceite claro |
| **N2 — comum** | Sonnet, Terra, Gemini 3.8 Flash | esforço N2 | escalado N2 | implementação comum, diagnóstico e integração delimitada |
| **N3 — difícil** | Opus, Sol | esforço N3 | escalado N3 | arquitetura, desenho, migração, problema difícil, orquestração |

**Revisão** (só Astra, Fable e Argon, todos N3; eles não executam nem orquestram)

| Camada | Regra |
|---|---|
| `/code-review` | obrigatório para código: `codeReview.comum` no comum; `codeReview.riscoElevado` em risco elevado |
| Revisão cruzada L0 | dispensada; texto sem código também dispensa o `/code-review` |
| Revisão cruzada L1 — comum | Astra, Fable ou Argon no esforço L1 |
| Revisão cruzada L2 — alto risco | Astra, Fable ou Argon no esforço L2 |
| GPT extra (`gpt-review.ps1`) | desativado |
| Repetições | no máximo duas rodadas cruzadas por fatia; nada de revisão extra obrigatória redundante, mantendo testes e revisão proporcional ao risco; contexto enxuto e sessão nova por fatia, sem reler históricos enormes |

Esforço é outra dimensão da capacidade: Terra escalado continua N2, Opus escalado continua N3. A dificuldade
conhecida permite entrar direto no nível adequado; escale um degrau por falha real, em nova tentativa,
sem gastar chamadas só para passar pelos três. Reserva mantém a capacidade exigida ou sobe; falta de
cota não autoriza baixar o nível. O `L0/L1/L2` da `dupla` mede risco da entrega, não capacidade do
modelo. Os parâmetros de execução (`-Nivel simples|comum|dificil`) continuam descrevendo a tarefa e
não renomeiam o modelo. N3 não libera gasto; Astra, Fable e Argon ficam fora da execução.

**Sempre a versão mais nova de cada família** (Haiku, Sonnet, Opus, Fable; Luna, Terra, Sol, Astra;
Flash-Lite, Flash, Argon), usuário, 2026-10-18 e 2026-11-03. Id marcado "hoje" é só exemplo. Os scripts da
`dupla` escolhem sozinhos; na filha, a orquestradora pega o id mais novo da família no seletor do app.
Exceção: a lista do OpenRouter (Muse), fixa e trocada à mão.

| Papel | Quem | Modelo | Ferramenta | Serve para |
|---|---|---|---|---|
| 1 | Orquestradora | Opus no esforço N3; escalado N3 só quando ela mesma desenha ou decide algo difícil. Igual ou acima do que as filhas vão usar (o app ignora `model` mais caro que o da mãe) | esta sessão | ler, planejar, fatiar, despachar, conferir o diff e julgar a saída dos testes, `/code-review`, STATUS.md, commit e push, arquivar |
| 2 | Sessão filha no app | Haiku no esforço N1: varredura, busca, inventário, só leitura. Sonnet no esforço N2: código fechado com testes, script, ajuste de escopo claro. Opus no esforço N3: conversor, desenho, migração, decisão técnica | `start_session` | fatia que rende mais separada (seção 2), com arquivos próprios; ela própria usa o nível 3 |
| 3 | Subagente da sessão (mãe ou filha) | Haiku ou Sonnet no esforço N1 ou N2 | `Agent` (`Explore`, `general-purpose`) | leituras, buscas e conferência mecânica (seção 5); nunca altera código, banco nem dado do projeto (só saída temporária) |
| 4 | Executor | agy pelo `-Nivel` (Flash-Lite ou Flash, Claude Sonnet, Claude Opus, na cota Google): não roda comando, só lê e escreve; opencode com GPT (`openai/`: Luna, Terra, Sol; assinatura do ChatGPT) e opencode com Claude (`anthropic/`: Haiku, Sonnet, Opus, no crédito mensal da API): rodam comando e teste. Quem vai primeiro sai da fila pela folga (abaixo). Nunca o OpenRouter. O script escolhe o modelo e confere a cota e o crédito: `dupla`, seção 6 | `despachar.ps1 -Executor agy\|opencode` | tarefa fechada e testável, sem Docker nem rede |
| 5 | Revisor e árbitro | Outra família que o autor, pelo `revisar.ps1 -Autor claude\|gpt\|gemini` (Claude → GPT Astra, reserva Gemini Argon; GPT → Gemini Argon, para poupar o Max; Gemini → GPT Astra; reserva Fable); esforço L1 ou L2 pelo nível calculado do risco; árbitro a terceira família, pela tabela da `dupla`, seção 3b (Muse Wonder pelo OpenRouter só quando a terceira é o GPT e o ChatGPT zerou): `dupla`, seções 0, 2 e 3b | `revisar.ps1` | revisão cruzada antes do commit, quando os critérios da `dupla` mandam |

Cota: filha, sempre no app do Claude Code, gasta a cota do Max (nunca o crédito da API). O GPT
(executor Luna/Terra/Sol, revisor Astra) gasta a assinatura do ChatGPT pelo OpenCode, uma janela
só para todos; o agy gasta a do plano Google, que sobra (o grupo Claude/GPT dele estava intocado em
2026-10-22) e o usuário quer usar; o opencode com Claude gasta o crédito de US$ 100 por mês da API da Anthropic,
que não acumula de um mês para o outro. Tarefa fechada e testável vai ao executor antes de virar filha,
sempre no modelo mais barato que dá conta: o topo fica para revisar.

**Fila pela folga** (usuário, 2026-10-25: semana pesada e semana leve; assinatura que muda). Não há ordem
fixa. A cada despacho, a última linha do `recursos.ps1` dá a fila: cada fonte pela folga da janela longa
(% que resta − % da janela que falta até o reset; positiva é sobra que se perde), e a fonte com a janela
de 5 h quase no fim vai para o fim. Entre as fontes que servem ao papel, vai a primeira da fila:

| Papel | Quem pode | Claude do Max |
|---|---|---|
| Orquestrar, decidir com o usuário, conferir | — | sempre (Opus, esforço N3) |
| Código que roda comando ou teste | opencode com GPT (Luna, Terra, Sol); opencode com Claude (crédito da API) | só se os dois falharem |
| Código sem comando, varredura, documento | agy (Flash-Lite ou Flash; Claude Sonnet ou Opus do grupo Claude/GPT); opencode com GPT | não |
| Plano grande, desenho | N3 (`-Nivel dificil`): GPT Sol pelo opencode, ou Claude Opus pelo agy ou pelo crédito da API, sempre no esforço N3. Astra, Fable e Argon ficam só para revisar: o `despachar.ps1` os recusa | a orquestradora decide no fim |
| Revisão e árbitro | `dupla`, seções 2 e 3b | só Fable, quando é a família que sobra |

Trocar de plano muda a cota e a fila se ajusta sozinha; só mude esta tabela se uma fonte entrar ou sair. Com a cota ou o crédito
de um zerado, aplique a reserva da `dupla`: a revisão troca automaticamente de família; execução com
escrita exige conferir o diff antes de entregar a próxima tentativa. Sem parecer, a etapa fica pendente.

**Três ambientes de trabalho** (usuário, 2026-10-31): Claude Code Desktop, OpenCode Desktop e Codex no
app OpenAI. O agy é motor. O OpenCode também fornece o CLI usado pelos scripts da dupla.
Use somente as APIs disponíveis em cada um. A integração e seus limites estão em
[references/harness.md](references/harness.md). Política comum em
[politica-modelos.json](politica-modelos.json), no perfil em vigor (`scripts/esforcos.ps1`). Na revisão, Astra,
Fable e Argon usam o esforço L1, e o L2 em L2 ou com `-Topo`. Economia
conserva capacidade e piso da revisão. A IA classifica cada fatia; código resolve o modelo e esforço.
Uma skill não altera o seletor do app.


**Ritmo** (usuário, 2026-10-22: a semana do Max acabava antes do reset, com as outras fontes sobrando).
Antes de despachar ou abrir filha, olhe as fontes, sem gastar nada:

- `powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\recursos.ps1`
  (`-SemAgy` pula o agy, que leva uns segundos): ChatGPT (OpenCode, com a fonte da cota), agy por grupo,
  crédito da API pelo opencode e OpenRouter, com o que resta, a folga e quando volta; a última linha é a
  fila pela folga (sem o agy, a fila sai sem ele). Cada leitura vai, só com números, para o histórico em
  `%LOCALAPPDATA%\dupla\cotas.jsonl`.
- `get_usage` (carregada via ToolSearch) para o Claude Max, que o painel não lê.
- `/orquestra cotas` abre o painel das cotas (e `/orquestra cotas texto` devolve o mesmo em texto): cada
  janela com o que resta, quando volta e quanto se perdeu nos últimos resets, o Claude Max incluído. Serve
  para ver que assinatura sobra, não para despachar: a fila continua sendo a do `recursos.ps1`.

A semana já passada é `100 × (7 dias − o que falta para o reset semanal) / 7 dias`. Se o % usado da
semana do Max ("Weekly · all models") passar dela, entre em **economia** até o reset: filha de rotina em
Sonnet (Opus só para desenho ou decisão que o Sonnet não dá conta); tarefa fechada vai antes aos
executores fora do Claude Code (agy e opencode); revisão com `-Economia`. Exemplo de 22/10, 12h: 30%
usados, 5d10h para o reset, semana passada 23%: economia. Fonte com folga (o crédito da API não acumula
de um mês para o outro) pega o que a apertada largou.

**Perfis**, que o usuário pode pedir ("perfil economia"): **base** (o padrão: fila pela folga, níveis da
tabela); **economia** (o de cima, também quando o usuário pede); **qualidade** (filhas de código em Opus,
revisão L2 com `-Topo`, executor no nível `dificil`; sem prazo, vale só para a tarefa pedida).

Perfil com prazo ("qualidade até o fim do dia", "economia até amanhã") vale para todas as sessões: grave com
`powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\perfil.ps1 qualidade
-Ate hoje` (`-Ate`: `hoje`, o padrão; `amanha`; `18:00`; `30/10`; `"30/10 18:00"`); `perfil.ps1 base` volta
na hora. Vencido, volta sozinho ao base. O `recursos.ps1` mostra o perfil em vigor na linha depois da fila:
é ele que vale ao despachar, acima do perfil por julgamento, menos a economia automática, que só um
perfil qualidade com prazo suspende. Sem argumento, o `perfil.ps1` só mostra o perfil.

Vale sempre, com ou sem economia, e a orquestradora lembra o usuário quando vê o contrário: sessão de rotina
que o usuário abre roda em Sonnet; assunto novo vai para sessão nova, porque sessão longa relê o contexto
inteiro a cada mensagem.

## 5. Chamadas prontas

**Filha** (`start_session`, carregada via ToolSearch; `cwd` só quando a orquestradora não está na pasta do
projeto):

```
initiation: "user_asked", context: "fresh", use_worktree: false,
cwd: "<pasta do projeto>", model: "<id de Haiku, Sonnet ou Opus; omitido = o da mãe>",
effort: "<esforço N1/N2 para Haiku e Sonnet, N3 para Opus, pelo perfil em vigor; um degrau acima só em nova tentativa; omitido = o da mãe>",
title: "⚙️ <assunto>: <ação>", name: "<projeto>-<assunto>", prompt: "<brief da seção 3>",
background: "<o projeto, o que já foi decidido, como esta fatia encaixa>"
```

Passe modelo e raciocínio já no `start_session`: `set_session_model` e `set_session_effort` só valem do
turno seguinte, e a fatia pede os dois fixos do começo ao fim. Sem `effort`, a filha herda o da mãe (que
pode estar em high), caro demais. O card de proposta (`own_initiative`) leva `model` e `effort` do mesmo
jeito. O app recusa `start_session` em turno iniciado por outra sessão ou por evento: despache no turno em
que o usuário falou, ou proponha com `own_initiative`.

**Conferir o modelo da filha.** Logo depois do `start_session`, `get_session(session_id)` devolve `model`
e `effort`. Se não baterem com o pedido (o app ignora `model` mais caro que o da mãe; filha sem `model`
herda o dela), `set_session_model` e `set_session_effort` (valem do turno seguinte) e um ⚠️ na linha da
filha (seção 9). Por quê: o usuário não enxergava o modelo das filhas e via sessões no modelo errado
(2026-10-25).

**Acompanhar:** quando a filha termina o turno, a orquestradora recebe os primeiros 400 caracteres do
relatório. Para ler o resto, `list_events(session_id, limit)`. Para seguimento (correção, pergunta, fatia
seguinte na mesma área), `SendMessage(to: "local_<id>", message)`, com a primeira linha autossuficiente.
Não faça polling nem pergunte "terminou?".

**Subagente:** `Agent(subagent_type: "Explore", model: "haiku", prompt)` para busca ampla;
`general-purpose` para leitura em vários passos. Várias chamadas na mesma mensagem correm em paralelo.
Vale na mãe e na filha.

**Conferência mecânica** (rodar script ou teste, contar linhas, consultar o banco, comparar números com
resultado esperado já conhecido): `Agent(subagent_type: "general-purpose", model: "haiku", effort:
<esforço N1>, prompt)`. Peça antes o `request_directory` da pasta. O brief traz os comandos exatos e a tabela
do esperado, e manda: "devolva uma tabela com o comando, o código de saída e o trecho cru de cada número ou
diferença (saída longa vai para arquivo temporário, cite o caminho); liste toda diferença sem
classificá-la; não altere código, script nem banco; sem dado pessoal na resposta". Se a consulta ainda
precisa ser descoberta (coluna, sintaxe), use Sonnet no esforço N2, que ajusta só `SELECT` de leitura. Vale com 3
ou mais comandos, saída longa ou risco de erro; abaixo disso, rode direto. Aceite com números conhecidos no
plano vira script (OK/FALHOU por critério, sai com 1 se algum falhar), escrito por quem não é a autora do
código conferido, com o diff lido pela mãe uma vez: depois, conferir é uma chamada, sem modelo.

**Executor** (tarefa fechada; `dupla`, seção 6), em segundo plano, com o tempo máximo da ferramenta:

```
powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\despachar.ps1 -Pasta <raiz do projeto> -Tarefa <pasta>\tarefa.md -Saida <pasta>\relatorio.md -Nivel simples|comum|dificil [-CapacidadeMinima N1|N2|N3] [-Executor agy|opencode] [-Modelo <id>] [-Esforco low|medium|high|xhigh] [-Rede]
```

Sem `-Executor`, vai ao agy; tarefa que precisa rodar comando ou teste vai com `-Executor opencode` (GPT
Luna/Terra/Sol pelo nível, ou `-Modelo anthropic/<id>` quando o crédito da API está antes na fila). Sai com 0 e o
relatório em `-Saida`; com 1 se o executor falhou (no opencode com Claude, também acima de US$ 2,00; em
qualquer opencode, acima de 40 minutos); com 3 quando a cota ou o crédito acabou, e a frase diz o próximo.
Despacho não é dupla: o executor faz e a orquestradora confere (seção 6); a revisão cruzada é o
`revisar.ps1`.

**Modelo pedido e real.** Depois de cada despacho ou revisão, a mãe põe na conversa uma linha `<parte> |
esperado <modelo#esforço> | real <modelo#esforço> | ⚠️ se diferem`. O `despachar.ps1`, o `revisar.ps1` e
o `gpt-review.ps1` (desativado) já imprimem `modelo pedido <X>, real <Y>` (com `⚠️ difere`) e gravam o mesmo em
`<Saida>.modelo`, que o painel `orquestra` lê. O real, no opencode, sai do banco dele (`session_v2.model`
da sessão, só leitura, pelo `opencode_custo.py modelo <id>`). No agy não há fonte: `real: não informado`,
nunca o pedido no lugar.

**Regras do executor.** O `despachar.ps1` cola antes da tarefa os conjuntos de `dupla\regras\`
(`-Conjuntos geral`, o padrão; `geral,backend` para script e dado; `geral,frontend` para tela e painel;
`nenhuma` só se a tarefa já traz tudo). O `geral` pede que o relatório termine em `STATUS:` (FEITO, FEITO
COM RESSALVA, TRAVADO, FALTA CONTEXTO) e `RESUMO:`: leia essas duas linhas primeiro. TRAVADO ou FALTA
CONTEXTO não se reenvia igual: mude o contexto, o modelo ou o escopo antes.

**Quando o executor falha**, a orquestradora distingue indisponibilidade de fonte de correção da tarefa:

- saída 3 (cota): confira o que foi gravado e continue com o próximo da fila que serve ao papel,
  uma tentativa por fonte elegível, sem perguntar ao usuário. Passe a mesma `-CapacidadeMinima`
  registrada em `<Saida>.nivel.json`: agy Opus N3 não pode cair para GPT Terra N2. Fonte recusada antes de executar não consome
  rodada de correção. Não reenvie tarefa parcial como se começasse do zero e não apague alterações
  de outra sessão; leve ao próximo só o contexto necessário para continuar com segurança;
- saída 1 (falha) ou teste que não passa: `git status` e `git diff` do que ele gravou. Se outra sessão mexeu
  nos mesmos arquivos (seção 7), preserve o estado e resolva a colisão. Preserve também alterações
  úteis da tentativa anterior; não descarte a árvore inteira. **Suba um degrau na mesma fonte** enquanto ela tem folga (`-Nivel simples` → `comum` → `dificil`, ou
  `-Esforco` acima: do esforço ao escalado do nível); só sem degrau ou sem folga vai ao próximo da fila. A nova
  tentativa leva a tarefa e, no fim, uma seção **Tentativa anterior falhou** com só o trecho do erro e do
  teste que falhou (comando, saída, arquivo:linha), nunca o relatório nem o raciocínio do anterior: assim
  ele não herda o caminho errado e a tarefa fica curta. (Ideia tirada da alethe, `cascade`, 2026-10-25.)
- após duas tentativas de correção, a fatia volta à mãe, que faz ou leva ao usuário se faltar decisão dele.
  Se todas as fontes estiverem sem cota, preserve o trabalho e registre a execução pendente.
  Isso não dispensa testes nem revisão, e não libera commit ou deploy de uma etapa sem conferência.

**Revisão não é tentativa de execução.** Use `revisar.ps1` com a família real do autor; o script
percorre as reservas sem repetir família nem usar o próprio autor. Confira o parecer completo e
`<Saida>.rota.json`. Falta de tokens não autoriza pular a revisão ou reduzir seu nível. Só a etapa
que exige revisão fica pendente se nenhuma reserva responder; prossiga com preparação independente.
Camada repetida não precisa rodar de novo quando uma revisão válida já cobriu o mesmo pedido e diff.

**Arquivar a filha:** `set_session_title(session_id, "🗄️ <resultado>")` e depois
`archive_session(session_id, reason)`. Filha com pendência própria (pergunta ao usuário) fica viva, com o
emoji da pendência.

**Própria sessão:** `set_session_title("self", ...)`: ⚙️ enquanto filhas e executores trabalham, com as
fatias conferidas sobre o total do plano (`⚙️ fatias 2/5`, ou `⚙️ <assunto> 2/5` se couber nos 26
caracteres), para o usuário ver na barra lateral quanto falta sem abrir a sessão; o contador sobe a cada
entrega conferida (seção 6, passo 6). No fim, o emoji da primeira pendência do usuário, ou 🗄️ quando não
sobra nenhuma.

**Ver o todo na barra lateral.** Com duas ou mais filhas, crie um grupo (`create_group`, carregada via
ToolSearch) com o nome `<projeto>: <assunto>` e mova para ele a mãe e as filhas (`move_sessions`, com
`"self"` e os ids; mover sessão que não é a própria pede uma confirmação do usuário no modo padrão: faça de
uma vez, no despacho). O estado de cada uma está no nome (⚙️ 👍 🧠 🗄️), e o grupo é o mapa do trabalho.
Quando a última filha arquivar, `delete_group`. Um painel de verdade (grafo mãe → filhas → executor →
revisão) é um mod, fora desta skill.

## 6. Ritual por entrega

1. **Conferir.** Leia o relatório, o diff e a evidência dos testes (comando e saída). Reexecute só se
   faltou evidência, houve falha ou o diff mudou depois deles, conforme a dupla §0. Julgar é seu. Rode você
   mesma só 1 ou 2 comandos curtos; se um falhar ou pedir um 3º, pare e delegue. Antes de decisão
   irreversível (apagar, commit de risco), leia a saída crua, não o resumo. Nada segue adiante sem essa
   conferência.
2. **`/code-review` no diff**, sempre que a entrega tem código (`dupla`, seção 0b: `codeReview.comum` no comum,
   `codeReview.riscoElevado` em risco elevado, sem `--fix`, você julga cada achado). Vale também para o que um executor
   fez. A filha que escreve código roda na própria entrega antes de devolver e põe o resultado no
   relatório; a mãe roda de novo só se o diff mudou depois disso. Texto sem código dispensa. Não
   substitui conferência nem dupla.
3. **Dupla, por julgamento.** Os critérios e o nível (L0/L1/L2) estão na seção 0 da `dupla`; você decide
   e diz em uma linha, sem 👍. O revisor é de outra família que quem escreveu (`-Autor` = a família da
   filha ou do executor, não a sua). Pacote sem segredo. Achado confirmado: conserto pequeno fica na
   orquestradora; conserto na área da filha volta a ela por `SendMessage`, se ela ainda está viva.
   Se as reservas terminarem sem parecer, registre **revisão pendente** e não avance aos passos 5 e 6
   como entrega concluída. Informe quem revisou de fato, inclusive quando foi a reserva. No máximo
   duas rodadas cruzadas por fatia. A camada GPT extra (`gpt-review.ps1`) está desativada (usuário,
   2026-11-03): não rode, nem como reserva.
4. **STATUS.md do projeto.** Feito (com quem fez: "sessão filha no Sonnet; code-review sem achados;
   L1 GPT Astra low aprovou sem achados"), Decisões, Pendências, Revisão cruzada.
5. **Commit e push**, sem pedir 👍 (seção 1). O que passou pelos passos 1 a 4 vai para o `main` com
   push (em repositório de time, para a branch de trabalho); só os seus arquivos, por caminho. A mensagem de commit
   conta o que cada nível fez.
6. **Arquivar a filha** com 🗄️ e subir o contador no nome da mãe (`⚙️ fatias 3/5`, seção 5). A
   orquestradora continua até a última fatia.

## 7. O que não paralelizar

- Consertos pequenos em arquivos que se cruzam: numa sessão só (exemplo: 5 consertos de 10 a 40
  linhas em 4 arquivos ficaram numa sessão, de propósito).
- Passo serial de integração (A gera, B consome).
- Dois escritores no mesmo arquivo, inclusive executor e filha. Antes de despachar, `list_sessions` mostra
  quem já trabalha na pasta e `git status` mostra o que outra sessão deixou modificado.
- Arquivo que o usuário está editando.
- Fatia que depende de decisão de produto ainda não tomada (seção 1).

## 8. Cuidados aprendidos

- O executor opencode roda numa config isolada (`OPENCODE_CONFIG_DIR` só do despacho, sem config do
  projeto, sem MCP, sem instructions) e recebe a tarefa anexada por `--file`; a trava de permissões
  prende as ferramentas à pasta do projeto, então nada do `%TEMP%` é lido de lá: tudo o que ele precisa
  vai dentro da tarefa. No executor, `python` é só pelo PATH e sem opção antes do arquivo (`python -m
  pytest`, `python teste.py`): a trava nega caminho absoluto na linha, então o caminho completo do
  Python, que vale para a orquestradora e o Claude Code, não entra na tarefa do executor. Até
  2026-10-24 o executor era o Codex CLI, com sandbox do sistema e a tarefa pela entrada padrão.
- O heredoc da ferramenta Bash estraga barra invertida e crase: brief, tarefa, pacote e qualquer arquivo
  com caminho Windows ou Markdown vão por Write/Edit.
- Saída com dado pessoal (nome em nota de extrato, CPF, chave Pix, número de conta) fica fora do git
  (`.gitignore`). Varredura de segredos é fatia de Haiku, só leitura, antes do primeiro commit do projeto.
- Revisor, executor e árbitro (GPT pelo opencode, Claude, agy, OpenRouter) mandam o que leem para fora do computador:
  o critério é o da seção "Dados e fornecedores" da `dupla` (dado pessoal pode; segredo não).
- Nome de toda sessão, mãe e filhas, segue a regra do CLAUDE.md global: emoji, 26 caracteres de texto,
  🗄️ antes de arquivar.
- Acesso às pastas: a orquestradora pede `request_directory` para cada pasta de projeto que vai conferir.

## 9. Como relatar ao usuário

Mensagem final no formato do CLAUDE.md global. Nos detalhes, uma linha por filha e por chamada a executor ou revisor:
`- [título da filha](#local_<id>), esperado <modelo#esforço> | real <modelo#esforço> <⚠️ se diferem>: <o que entregou>; conferido <como>; <revisão: quem, veredito>`.
Executor e revisor seguem o mesmo molde, com o real lido como na seção 5 ("real: não informado" no agy).
Os commits (hash e o que entrou) ficam nos detalhes. Na **Sua vez**, só o que é do usuário: pergunta de
produto que uma filha deixou vira 🧠, uma por linha, e ação externa vai com o emoji dela. Decisões que você tomou sozinha (abrir filha, revisar, nível) ficam nos detalhes, em uma
linha, não na **Sua vez**.

## 10. Exemplo

Pedido: fase 2 de um plano (conversor entre dois formatos), scripts de importação ajustados e segurança do
repositório.

- Fatias por área: `conversor/` → filha N3 (desenho e código, umas 2 h); `importacao/*.py` e testes → filha
  N2 (código fechado, testável); varredura de segredos no repositório inteiro → filha N1, só leitura;
  testes dos scripts de importação → executor por `despachar.ps1`, depois que a filha N2 entregou (mesma
  área, por isso em sequência; achou 1 defeito real).
- Revisão: outra família nos scripts de importação (sem achados) e no conversor (5 achados reais).
- Orquestradora: leu cada relatório, rodou os 29 testes, escreveu o STATUS.md e arquivou as filhas com 🗄️.
  Os 5 consertos do conversor, em 4 arquivos que se cruzam, ficaram numa sessão só.
- O que faltou, e virou a seção 0: o usuário só usou o sistema de destino à tarde. Com um teste de uso de
  manhã, o conversor e as três revisões de plano não teriam existido.
