# orquestra

Painel ao vivo da orquestração. No topo, o que espera o usuário; depois a sessão desta janela com as filhas que ela abriu (e as netas) em árvore, o que está rodando fora daqui, as revisões prontas e para onde vai o próximo trabalho. Tudo em palavras: o número cru da folga só aparece no `/orquestra texto` e no `/orquestra cotas texto`.

```
╭ Esperando você ───────────────────────────────────╮
│ 👍 nuvem: ok p/ gastar crédito  Opus 5.5 high · 1 min │
╰────────────────────────────────────────────────────╯
Sessões
⚙️ projeto: terra rodando             Opus 5.5 high · agora
├─ ⚙️ m2: seletor de esforço           Opus 5.5 high · 3 min
└─ 👍 nuvem: ok p/ gastar crédito                espera você
Rodando fora daqui
m2
  ⌛ rodada 3                             revisor não chamado
Revisões prontas
m2
  ✅ rodada 2 · GPT Astra 6                          aprovado
  ☑️ rodada 1 · GPT Astra 6 · 2ª tentativa      com correções
fable
  ✅ rodada 1 · Fable                                aprovado
reparo-rotas
  ❔ rodada 1 · Claude                         não comprovado
+3 mais antigas · /orquestra texto
Próximo trabalho vai para Gemini (agy)            sobra muito
▱▱▱▱▱▱▱▱│▱▱
Cota semanal quase toda livre: usou 1%, e 76% da semana já passou (│). Renova segunda.
depois: API · todas as cotas: /orquestra cotas
```

- O estado de cada trabalho vem em palavras e com cor: "pediu refazer" e "reprovou" em vermelho; "não comprovado", "parado há +30 min" e "não chamado" em amarelo; "aprovado" e "com correções" em verde. A linha do modelo só aparece quando o real difere do pedido.
- "Rodando fora daqui" mostra o que roda, está parado ou espera o revisor; com tudo terminado, diz "Nada rodando agora.". O que tem veredito vai para "Revisões prontas" ("Prontos" quando há execução no meio).
- Cada trabalho fica embaixo do assunto da pasta da dupla, em negrito: o nome da pasta sem o projeto, a data e o executor (`mods-m2-agy-20261031-1412` vira `m2`; se só sobra o executor, fica ele). Dois assuntos iguais mostram a pasta inteira.
- "Próximo trabalho" é a primeira fonte sem trava da `_fila.json`, com a janela mais longa dela; travadas não aparecem. A barra cheia é o uso, e o `│` marca quanto da janela já passou: uso bem antes da marca, vai sobrar. A frase diz o mesmo em palavras. As barras "uso" e "tempo" ficam no painel Cotas. Com a fila de mais de 6 h, a última linha avisa em amarelo para rodar o `recursos.ps1`.

## Como usar

- `/orquestra` abre o painel e, se ele já estiver aberto, fecha.
- `/orquestra texto` devolve o mesmo mapa em texto. Serve também para o `claude -p`.
- `/orquestra cotas` abre (ou fecha) o painel **Cotas**, e `/orquestra cotas texto` devolve o mesmo em texto:

```
Próximo trabalho vai para agy Claude
lidas há 20 min
Claude Max · semanal                              sobra muito
uso   ▰▰▰▰▱▱▱▱▱▱ 40%
tempo ▰▰▰▰▰▰▰▰▰▱ 86% · volta ter
perdeu 23/10 40%
ChatGPT · semanal                                    no ritmo
uso   ▱▱▱▱▱▱▱▱▱▱ 1%
tempo ▱▱▱▱▱▱▱▱▱▱ 4% · volta 02/11
perdeu 26/10 12% · 19/10 45% · média 29% de 2
agy                                                  não lido
uso abaixo do tempo = vai sobrar · acima = vai faltar
```

  O painel compara duas barras por cota: "uso" é quanto já gastou, "tempo" quanto da janela já passou. O rótulo à direita diz a folga (% que resta − % da janela que falta, a mesma do `recursos.ps1`) em palavras: "sobra muito" (30 ou mais), "sobra" (10 a 29), "no ritmo" (−3 a 9), "apertado" (−4 a −15), "vai faltar" (abaixo de −15) e "esgotada". A volta sai como hora quando falta menos de 20 h (mesmo que seja amanhã), dia da semana com menos de 6 dias, e data depois. O `/orquestra cotas texto` segue no formato antigo, com a folga em número (`usou 40% · volta 27/10 12:00 · folga +46`).

  "perdeu" é o que sobrou de cada janela longa (semanal, mensal) quando ela voltou, da mais recente para a mais antiga, até 4, com a média das últimas 8. Com `≤`, a última leitura antes do reset foi mais de 6 h antes, e o uso pode ter subido depois: o número é um teto. Fica em amarelo quando o último reset perdeu 30% ou mais.
- O painel abre sozinho, uma vez por sessão, quando aparece a primeira filha ou um trabalho da dupla ainda não terminado.
- Com o painel aberto, a leitura se repete a cada 4 s. Com ele fechado, a cada 30 s. Ele se atualiza quando uma filha muda de título ou quando aparece a `revisao.md`.

## Roteamento por capacidade

O agente julga N1/N2/N3 e chama `mcp__orquestra__rotear_tarefa`; não há classificador de prompt nem
chamada auxiliar a modelo. A política vem de `~/.agents/skills/orquestrador/politica-modelos.json`,
com reserva em `~/.claude/skills/orquestrador/politica-modelos.json`. `ORQUESTRA_POLITICA` permite
apontar uma política explícita; arquivo ausente ou inválido recusa o preparo.

```json
{"acao":"preparar","fatia":"integracao-1","nivel":"N2","familia":"sonnet","papel":"execucao","motivo":"integração delimitada"}
```

- `canal` é opcional e vale `nativo` quando ausente, inclusive nas reservas antigas. O canal fica
  fixo junto com modelo/esforço na fatia. `antigravity` é um canal explícito do plugin `gemeo` no
  OpenCode: a ferramenta no Claude Code recusa esse preparo e orienta o despacho no OpenCode,
  sem aplicar silenciosamente a mesma família pelo canal nativo. Trocar canal não muda a família
  do modelo para a revisão cruzada. Veja o exemplo e os limites em [gemeo](../gemeo/README.md).
- `acao: "consultar"` dispensa os demais campos e lê o estado atual da própria sessão. Com até
  oito reservas, inclui o mapa completo. Acima disso, devolve a contagem, oito IDs e os dados
  do turno, inclusive a rota ativa e a pendente. Use `{"acao":"consultar","fatia":"fatia-1"}`
  para ler qualquer reserva pelo ID. O campo `reserva` vale `null` se o ID estiver livre. O system
  prompt só contém uma nota estática: o snapshot não serve de confirmação de aplicação.
- O preparo fica pendente até o próximo `turn.start` principal com texto. Não muda a fatia/turno
  atual, continuação vazia, steering nem subagentes. Para executar o pedido atual, despache via
  dupla/subagente permitido; não espere o usuário enviar outro turno.
- A rota vale por **um turno principal e suas continuações sem texto novo**. Uma mensagem nova
  encerra a rota e qualquer bloqueio anterior; só ativa outra se ela já tiver sido preparada.
  Sem preparo, o engine responde normalmente para reclassificar a nova tarefa. Ao encadear rotas,
  a base continua sendo a seleção original, mesmo se um passo refletir o modelo roteado.
  No primeiro passo de B também é aceito o reflexo exato de A quando A teve modelo confirmado e
  esforço enviado conhecido. Essa permissão é consumida nesse passo e não vale após sinal `auto`,
  resposta divergente ou sem confirmação; qualquer outro modelo/esforço continua sob a guarda.
- Cada `turn.step` dessa fatia usa a rota fixa. `next({ ...e, model, effort })` altera a requisição;
  não grava defaults globais nem muda o seletor visual. `aplicado.model` só aparece quando a resposta
  informa a família pedida. O esforço fica em `enviado`, pois o provedor não o confirma.
- Modelo divergente ou ausente fica pendente. Mudança no passo sem seleção explícita comprovada
  pode ser fallback: a requisição é encerrada localmente, sem chamar modelo, só pelo restante desse
  turno e continuações vazias. Uma nova mensagem libera a reclassificação, sem exigir troca manual.
  Eventos de seleção `command`/`picker` e `/effort` digitado pelo usuário preservam a escolha manual;
  `auto`, `sdk` e `resume` não são tratados como prova de escolha do usuário.
  O seletor visual de esforço do Desktop (`setEffort` → `applyFlagSettings`) muda `sessionEffort`
  sem evento de plugin (conferido no runtime 2.1.309). Por isso, um passo que difere só no esforço,
  com o modelo da base ou o da rota, conta como escolha manual: a rota é suspensa, sem bloquear, e o
  passo segue com o modelo do seletor e o esforço novo, inclusive nas continuações que refletem o
  modelo da rota. Um preparo pendente da próxima fatia continua valendo, com essa seleção como base.
  Esforço ausente (modelo sem esforço) não conta. Modelo diferente
  sem evento explícito continua bloqueado, e um bloqueio ou sinal `auto` anterior prevalece.
- Estado em memória e no `$.store` é separado pelo ID da sessão. Para subir esforço, use uma nova
  `fatia` com `escalado: true`. Revisão exige `papel: "revisao"`, N3 e `risco: "L1"` ou `"L2"`;
  L1 escalada usa o esforço L2. Só as famílias de `revisao.familias` revisam (hoje Astra, Fable e
  Argon, todas em `revisao.L1/L2`: `low`/`medium`, usuário, 2026-11-03) e elas não executam nem orquestram.
  As reservas ficam em um mapa por ID de fatia, preservado nas mensagens novas, seleções manuais
  e recargas: voltar de A para B e depois A não permite alterar a escolha reservada para A.

## Instalar

Ponha a pasta no `CLAUDE_CODE_PLUGIN_DIRS` do `~/.claude/settings.json`, junto com os outros mods. O separador é `;`:

```
<caminho>\\delcouncil\\mods\\orquestra;
```

Para experimentar numa sessão só: `claude --plugin-dir "<caminho>\delcouncil\mods\orquestra"`.

## O que ele lê

O painel só lê. O mod não grava arquivos fora do próprio `$.store`, onde guarda desde quando cada título está como está, em `max:<sessão>` o maior uso que aquela sessão viu em cada janela do Claude Max e em `rota:<sessão>` o pedido e a observação do roteamento. O roteamento altera as requisições da própria sessão conforme a seção acima.

- **Sessões do app desktop:** `claude-code-sessions\<conta>\<org>\local_*.json`, em `%LOCALAPPDATA%\Claude-Data\claude_<id>` (app atual) e em `%APPDATA%\Claude` (app antigo). De cada arquivo ele usa título, modelo, esforço, se está arquivada, quando foi criada, a pasta e a mãe (`spawnedFrom`). Lê só os arquivos gravados depois que a sessão desta janela começou.
  - A sessão desta janela é a que tem o `cliSessionId` igual ao `$.session.id()`.
  - As filhas são as que têm esta sessão como mãe, e as netas as que têm uma filha como mãe, até três níveis.
- **O estado vem do emoji do título:**
  - esperam o usuário (vão para a caixa do topo): 🔥 👍 ▶️ 📨 📖 🧠;
  - não esperam: ⚙️ 🤝 💤 ✅ 🗄️.
  - Sessão arquivada aparece esmaecida. Título sem emoji aparece como "sem emoji".
- **Dupla:** `%TEMP%\dupla\<projeto>-*\`, só as pastas cujo nome começa pelo projeto e que mudaram desde que a sessão começou.
  - Cada `X.md.cmd` é um trabalho. Ele é uma execução quando o nome tem `relatorio` ou começa com `agy-`; nos outros casos é uma revisão.
   - **Quem roda** sai do `.cmd`, com o motor e o nome curto: `opencode Sol 6.1 medium`, `codex Astra 6 xhigh`, `agy Gemini 4 Argon high`; modelos desconhecidos ficam como vieram.
   - **Modelo:** lê `X.md.modelo` e mostra uma linha própria entre o resumo e o arquivo: `modelo Astra 6 xhigh ⚠️ pedido Sol 6.1 medium`. Divergências ficam em amarelo. Sem divergência, o painel não mostra a linha, e o `/orquestra texto` a mostra. `não lido` e `não informado` mostram o pedido e a ressalva, sem alerta.
  - Se o `X.md` não existe, o trabalho está rodando. Fica ⚠️ parado quando o `.log` e o `.cmd` passam mais de 30 min sem mudar.
  - Se o `X.md` existe, o trabalho terminou. Numa revisão aparece o veredito: só a palavra da primeira linha depois de `## Veredito` (aprovado, aprovado com correções, não comprovado com ❔, refazer). Numa execução aparece "relatório pronto".
   - **Tentativas:** a saída `revisaoN.md.tentativa-K-<família>.md` (com ou sem `.cmd`) é a tentativa K da rodada `revisaoN.md`. No painel, as tentativas e a cópia final `revisaoN.md` viram uma linha só, `rodada N · quem`, com o estado mais novo: a tentativa que roda, ou o veredito da cópia final quando ela é mais nova que a última tentativa. Da segunda tentativa em diante, a linha diz `· Kª tentativa`. Numa revisão cruzada (tentativas de famílias diferentes na mesma rodada), sai uma linha por família, cada uma com a última tentativa dela, para nenhum veredito sumir. Quem rodou sai do `.cmd`; sem ele, da família no nome (`-gpt` vira "GPT"); sem nenhum dos dois, a linha mostra só a rodada.
   - Um `pacoteN.md` sem `revisaoN.md`, sem `.cmd` e sem tentativa aparece como "revisor não chamado" (idem `tarefaN.md`, "executor não chamado").
   - No painel, os trabalhos saem agrupados por pasta (rodando primeiro, depois o mais recente). O `/orquestra texto` agrupa por pasta, com a mesma junção das rodadas, e mostra na linha de baixo o arquivo da última tentativa: `saida · há N`.
   - Feitos há mais de 1 h sem divergência viram `+N mais antigas · /orquestra texto` no fim da lista. Rodando, parado, esperando, refazer, reprovado, não comprovado e divergências nunca são resumidos; não há corte em 12 trabalhos.
- **Fila:** lê `_fila.json` na base da dupla (`ORQUESTRA_DUPLA` ou `%TEMP%\dupla`), com cache por mtime. O painel usa só a ordem: a primeira fonte sem trava vira "Próximo trabalho", a segunda vira "depois". Com mais de 6 h, a linha de baixo avisa em amarelo `fila de há N h · rode recursos.ps1` (com `(sem agy)` quando for o caso). Com todas as fontes travadas, a seção diz "nenhuma fonte livre" e mantém os avisos. Sem arquivo válido, a seção não aparece. O `/orquestra texto` segue com a faixa antiga, folga com sinal e 🔒 nas travadas. O arquivo não vira pasta de projeto.
- **Cotas:** lê `%LOCALAPPDATA%\dupla\cotas.jsonl` (ou `ORQUESTRA_COTAS`), um retrato por linha que o `recursos.ps1` acrescenta a cada leitura, só com fonte, limite e números. Relê só quando o `mtime` muda, e pula linha quebrada. O que está usado e quando volta saem do último retrato. O perdido sai das janelas que já voltaram: o maior uso lido em cada uma (reset com até 1 h de diferença conta como a mesma janela), e a janela de 5 h fica de fora. A hora da leitura é a da medição (`medido`, quando o ChatGPT veio de um retrato velho); com mais de 6 h entre ela e o reset, o perdido leva `≤`. As datas saem no fuso do Windows gravado no retrato. Histórico com 6 h ou mais avisa em amarelo para rodar o `recursos.ps1`.
  - **Claude Max:** o `recursos.ps1` não lê. O painel pega as janelas de 5 h e de 7 dias do `$.session.usage()`, que vêm com a primeira resposta do modelo na sessão, e guarda o maior uso de cada janela no `$.store`, na chave da sessão (`max:<id>`), para duas sessões não sobrescreverem uma à outra. A cada minuto junta as chaves de todas as sessões e apaga as que só tinham janela de mais de 180 dias. Sem leitura na sessão, aparece só o aviso.
- **O projeto** vem do nome da pasta da sessão e das filhas: `projeto-exemplo` dá `projeto-exemplo` e `exemplo`. Também conta o nome do remoto do git.

Do disco, o painel mostra títulos de sessão, modelos, nomes de pasta e de arquivo, a palavra do veredito e a fila de recursos. Não mostra conteúdo de pacote, relatório nem revisão. `/orquestra texto` segue a mesma fila, linhas de modelo e agrupamento.

## O que ele não lê, e por quê

- **Não há API de sessões para os mods.** O `$` não lista sessões ligadas nem títulos, então o mod lê os JSON que o app desktop grava. Se o app mudar esse formato, o painel fica vazio e o resto continua funcionando. No terminal sem o app, só a dupla aparece.
- **Há quanto tempo a sessão está no estado:** o arquivo não diz quando o título mudou. O mod anota a mudança quando a vê. Para uma sessão vista pela primeira vez, ele usa a última gravação do arquivo como piso e mostra `há ≥ N`.
- **O `STATUS.md` fica de fora de propósito.** Ele traz texto livre do projeto, e o painel só mostra títulos e nomes de arquivo.
- **Pastas da dupla com nome que não começa pelo projeto** ficam de fora. Para elas, use `ORQUESTRA_PREFIXOS`.
- **O modelo do Codex** sai do `-m` do `.cmd`. Sem `-m`, aparece só `codex`.

## Variáveis (opcionais)

| Variável | Para quê |
| --- | --- |
| `ORQUESTRA_SESSOES` | pasta das sessões, no lugar das duas acima |
| `ORQUESTRA_DUPLA` | pasta da dupla, no lugar de `%TEMP%\dupla` |
| `ORQUESTRA_RAIZ` | id `local_…` da sessão que vira a raiz do mapa, quando não é a desta janela (por exemplo, no `claude -p`) |
| `ORQUESTRA_PREFIXOS` | prefixos extras de pasta da dupla, separados por vírgula |
| `ORQUESTRA_COTAS` | histórico das cotas, no lugar de `%LOCALAPPDATA%\dupla\cotas.jsonl` |

## Testar

```
claude plugin validate orquestra
claude plugin test orquestra
```

O `hooks/leitura.test.ts` cobre nomes curtos, linha do modelo, leitura e formatação da fila e agrupamento com resumo dos antigos. O `hooks/painel.test.ts` monta um disco de mentira com uma orquestradora, duas filhas, uma sessão estranha, uma revisão do OpenCode com `.modelo`, um trabalho antigo, `_fila.json` e a pasta de outro projeto. Ele confere:

- o painel, no desktop e no terminal;
- a caixa "Esperando você";
- a fila no topo, o cache por mtime e o aviso de fila velha;
- a linha própria do modelo, a pasta única e o resumo dos antigos;
- que o painel abre sozinho;
- que ele se atualiza quando a filha muda de título e a `revisao.md` aparece, e que a filha arquivada sai da caixa do topo e da árvore;
- as revisões por rodada: tentativas e cópia final numa linha, sem "quem?", agrupadas pelo assunto, e a cota em barra e frase.

No Linux, o runtime trata os caminhos `C:\...` do disco de mentira como relativos, e o `painel.test.ts` falha só por isso. Os testes são para rodar no Windows.

`hooks/rota.test.ts` cobre política/escalada, revisão, canal fixo e compatibilidade de reservas
antigas, recusa de Antigravity no root Claude, consulta, resposta divergente, fronteira de
turno, subagentes, seleção manual versus fallback automático e dois IDs de sessão intercalados.
Os testes usam requisições simuladas, sem chamada de modelo.


## Ligar e desligar fontes de consumo

`/orquestra fontes` abre o painel **Fontes de consumo** e lista o estado. Há um botão
**Ligar/Desligar** para cada fonte; o painel de cotas também tem acesso a esses controles.
Pelo teclado: `/orquestra fontes desligar claude-max` ou
`/orquestra fontes ligar claude-max`. São comandos locais, sem chamada de modelo, e
continuam disponíveis quando a própria assinatura Claude está travada. Alterações por
comando exigem origem humana (`composer`); chamadas programáticas podem apenas listar.

IDs: `claude-max`, `chatgpt`, `anthropic-api`, `antigravity`, `openrouter`.
O aviso é explícito: **⚠️ Assinatura Claude travada por você.** A trava é global,
sem vencimento; só o usuário libera. O painel e as saídas em texto consultam o estado atual,
e a fila deixa de recomendar fontes bloqueadas mesmo com o retrato de cota antigo.
Com painel aberto, mudanças externas aparecem na próxima atualização (até 4 segundos).

O arquivo comum é `%USERPROFILE%/.local/share/dupla/fontes.json` (`HOME` como reserva);
`LOCALAPPDATA` nunca define o caminho canônico. Sem home absoluto, bloqueia. Formato estrito:
`{"versao":1,"bloqueadas":["claude-max"]}`. Sem os dois arquivos canônicos (`fontes.json` e `fontes.json.lock`), consulta os legados; arquivo inválido ou ilegível,
versão/tipos/IDs desconhecidos ou chaves extras bloqueiam todo consumo. BOM UTF-8 é aceito;
IDs repetidos são deduplicados. Nenhum mod escreve o JSON: botões e comandos chamam
`~/.agents/skills/dupla/scripts/fontes.ps1`, que centraliza exclusão mútua e substituição do arquivo.

A guarda Claude fica no início de `turn.step`, antes da exceção de subagentes, e vale
para sessão principal, filhas, netas, continuação e fallback de modelo. No contrato instalado, este harness usa a assinatura Max, enquanto API Anthropic
é despachada pelo OpenCode. A guarda aplica `claude-max`; trocar família Claude não contorna a trava. Uso do Claude Code com chave API, Bedrock
ou outro faturamento não faz parte deste mapeamento; não há detecção de credenciais. Uma rota bloqueada não é
reescrita silenciosamente para outra fonte. O mod não lê credenciais nem cancela chamadas
já enviadas. Processos externos que não passam pelo mod ou pelos scripts da dupla não são
interceptados por ele; o runtime precisa estar com o plugin carregado.

Após instalar esta versão, reabra/recarregue a sessão Claude para carregar o código novo.
Depois disso, ligar/desligar fontes não exige nova recarga. `claude plugin test orquestra`
valida o contrato e monta controles desktop/terminal com processos e inferência simulados;
`claude plugin validate orquestra` valida o plugin. Nenhuma fonte real é alterada nos testes.

Quando `fs.read` falha, a guarda confirma ausência por `fs.stat`, cujo contrato documenta
`ENOENT`; outros erros continuam bloqueando. Falha ao clicar num controle aparece com ⚠️,
e o painel relê o estado para não apresentar como certo o resultado de um processo que falhou.


As fronteiras auxiliares também são protegidas: `session.compact` devolve `{ skip: aviso }`
para `manual`, `auto`, `plugin` e `precompute`, inclusive transcrições de subagentes/forks;
`model.complete` devolve `isAnswered:false`, `reason:'aborted'` e os quatro contadores de
uso zerados, sem resposta fictícia nem chamada a `next`. O aviso vai ao transcript por
`ui.log`; falha de apresentação conserva a recusa. Contratos: tipos `SessionCompactInput`,
`SessionCompactSkipped`, `ModelCompleteResult`, `ModelUsage` e `CoreEngineInterface.ui.log`
do SDK Claude instalado. `fs.stat` documenta `ENOENT` para caminho ausente: a leitura aceita
errno estruturado ou o wrapper exato `fs.stat failed: ENOENT...`; acesso negado e mensagens
ambíguas continuam bloqueando. Não usa `fs.exists` para decidir liberação.

A CLI é procurada primeiro em `~/.agents/skills/dupla/scripts/fontes.ps1`, depois em
`~/.claude/skills/dupla/scripts/fontes.ps1`, somente se o primeiro caminho estiver ausente.
Falha de acesso não é tratada como ausência. O comando `composer` e a recusa de origem
`plugin` têm testes separados; os botões continuam usando a mesma CLI.


O marcador persistente `fontes.json.lock` distingue instalação inicial de estado já gerenciado.
Se `fontes.json` faltar e o marcador existir, ou sua leitura falhar (inclusive enquanto o
escritor o mantém aberto), o consumo fica bloqueado. Só ENOENT comprovado dos dois arquivos canônicos
permite consultar os legados antes da consolidação inicial. Estado existente é validado normalmente, sem precisar ler o
marcador. Assim, perda do destino durante falha de substituição não equivale a liberar fontes.


Antes da primeira gravação canônica, os leitores unem conservadoramente as travas de
`%USERPROFILE%/AppData/Local/dupla`, de `%LOCALAPPDATA%/dupla` (somente legado) e de cada
`%USERPROFILE%/AppData/Local/Packages/Claude_*/LocalCache/Local/dupla`.
Legado inválido/ilegível ou marcador sem estado bloqueia; falha na enumeração dos pacotes
que não seja ausência comprovada também bloqueia. Canônico existente é autoridade única:
liberar nele nunca ressuscita uma trava antiga. Os leitores não gravam; a primeira mutação
pela CLI comum consolida os legados sob lock. Isso mantém Claude MSIX e Codex/OpenCode na
mesma chave, mesmo quando seus valores de `LOCALAPPDATA` diferem.
