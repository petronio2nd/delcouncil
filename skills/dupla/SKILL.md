---
name: dupla
description: "Revisão cruzada entre famílias de modelos (Claude, GPT, Gemini), com revisor só de leitura, reservas automáticas por falta de cota e registro dos achados no STATUS.md. Use quando o usuário pedir dupla ou revisão por outro modelo, quando o STATUS exigir, ou quando o risco da entrega justificar revisão independente. Inclui arbitragem de achados recusados e despacho de executores. Não substitui testes nem serve para diagnóstico de causa raiz (dev-debug)."
---

# Dupla: um faz, o outro revisa

Ideia tirada do Maestri (themaestri.app): os agentes passam o trabalho direto um ao outro, cada um
com seu papel, e um quadro compartilhado guarda o estado do projeto. Aqui o papel do revisor é a
skill `revisor`, o canal é o `scripts/revisar.ps1` e o quadro é o `STATUS.md` do projeto.

| Peça | Onde |
|---|---|
| Papel do revisor | skill `revisor` (vale em qualquer modelo e nos dois harness) |
| Canal entre as famílias | `scripts/revisar.ps1 -Autor claude\|gpt\|gemini`: sem `-Revisor`, o script escolhe a outra família. Revisor GPT pelo `opencode run --standalone` numa config isolada só de leitura; revisor Claude pelo `claude -p` só com leitura; Gemini pelo `agy -p`. Até 2026-10-24 o canal GPT era o Codex CLI (`codex exec -s read-only`); `-Autor codex` ainda vale como sinônimo de `gpt` |
| Camada extra no diff | **Desativada** (usuário, 2026-11-03: "GPT extra desativado"). O `scripts/gpt-review.ps1` sai 0 sem chamar ninguém; `-Forcar` só a pedido explícito do usuário. Ver seção 0b |
| Subagente executor | `scripts/despachar.ps1 -Executor agy\|opencode [-Modelo <id>] -Nivel simples\|comum\|dificil`: um comando só; o executor escreve só na pasta do projeto e grava o relatório em arquivo. Sempre um modelo barato que dá conta do nível (Astra, Fable e Argon não executam). agy por padrão (Flash-Lite ou Flash, Claude Sonnet ou Claude Opus pelo nível, na cota do plano Google, que sobrava); opencode com GPT (`openai/`: Luna, Terra ou Sol pelo nível, na assinatura do ChatGPT, sem custo de API) quando a tarefa precisa rodar teste e de reserva do agy; opencode com Claude (`anthropic/`, no crédito mensal da API que vem com o Max) em N3 sem Sol ou como reserva; quando a cota ou o crédito de um acaba, sai com 3 e a frase diz o próximo. OpenRouter só se o usuário pedir (seção 6) |
| Revisor GPT (Astra) | O GPT-Astra mais novo pelo OpenCode (hoje `openai/gpt-6-astra`), esforço L1 ou L2 do perfil em vigor; o script escolhe sozinho |
| Revisor Claude (Fable) | O Fable mais novo (`claude -p --model fable`), esforço L1, e L2 em L2 ou `-Topo` |
| Nível, topo e economia | L0 dispensa outra família. L1 e L2 exigem N3 (esforços no perfil em vigor, `orquestrador/scripts/esforcos.ps1`): Astra, Fable ou Argon, com o mesmo piso nas três (usuário, 2026-11-03). A reserva respeita o piso, inclusive em economia. A política está em `orquestrador/politica-modelos.json` |
| Árbitro | A terceira família, a que não é nem do autor nem do revisor: Gemini pelo Antigravity CLI quando autor e revisor são Claude e GPT (`-Revisor gemini -Papel arbitro`, `agy -p`, o Argon mais novo no esforço do nível, a variante `-<esforço>` do nível, no plano Gemini Pro do usuário, sem custo por chamada, com limite semanal próprio); senão, a que sobrou (`-Revisor claude\|gpt -Papel arbitro`). Só desempata achados recusados (passo 3b). O agy fica só leitura pelo `deny` em `~/.gemini/antigravity-cli/settings.json`; se o `agy` recriar a pasta e o arquivo sumir, o script para |
| Árbitro indisponível | Exige terceira família N3 (Astra, Fable ou Argon): sem ela, disputa pendente. Flash não substitui. OpenRouter continua somente por pedido explícito, fora das reservas automáticas |
| Cotas | `scripts/cota.ps1`, lido pelos scripts sem gastar nada: ChatGPT pelo `~\.local\share\dupla\cota-chatgpt.json` (o plugin gêmeo do OpenCode grava a cada resposta do provedor `openai`) e, sem ele, pelo retrato do Codex (`rate_limits` em `~\.codex\sessions`; com mais de 1 h, o script pede um fresco com uma chamada mínima ao Codex CLI, 6 s e 5 tokens: o app não guarda o percentual em disco, e o Codex só serve para isso desde 2026-10-24); agy pelo `agy -p "/usage"`; gasto da API pelo OpenCode no banco dele (`scripts/opencode_custo.py`). Painel de todas as fontes, com a linha "ChatGPT (OpenCode)" e a fonte da cota, e o OpenRouter: `scripts/recursos.ps1` (regra de ritmo no `orquestrador`, seção 4) |
| Quadro do projeto | `STATUS.md` na raiz (formato abaixo) |
| Memória longa | ai-memory: os hooks dos dois harness já gravam tudo; o revisor consulta decisões antigas |
| Passar o trabalho inteiro | `memory_handoff_begin` do ai-memory, não esta skill |

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

## Quem é quem

Capacidade usa **N1 base, N2 intermediário, N3 topo**, conforme a tabela do `orquestrador`, seção 4.
O risco continua **L0/L1/L2**. Os revisores cruzados são Astra, Fable e Argon, N3 e só revisores
(usuário, 2026-11-03); uma reserva precisa manter essa capacidade e ser de outra família. Economia não
reduz o piso de revisão nem de arbitragem.
A capacidade mínima acompanha a execução em `-CapacidadeMinima N1|N2|N3`; a escolha efetiva
e o esforço ficam em `<Saida>.nivel.json`. Um modelo desconhecido ou abaixo do piso é recusado.

A dupla é por **família de modelo**, não por harness (usuário, 2026-10-24): o revisor é de outra família que
o autor e nunca abaixo dele em força; o nível segue o risco da entrega (seção 0). Mesma família nunca conta
como segunda opinião, mesmo em harness diferente.

- Autor **Claude** → revisor **GPT** (Astra; reserva automática: Gemini Argon). Autor **GPT** → revisor
  **Gemini** (Argon; reserva automática: Claude Fable). Autor **Gemini** → revisor **GPT** (reserva: Claude).
  Falta de cota ou de parecer completo troca a família na mesma chamada, uma tentativa por família elegível.
  Claude → Astra desde 2026-11-07 (usuário: Astra revisor, Argon reserva). De 2026-10-28 a 11-07 foi
  Claude → Argon, em teste. Astra não revisa GPT nem Argon revisa Gemini: as outras rotas ficam.
- Árbitro: a terceira família, pela tabela da seção 3b.
- O esforço do revisor segue só o risco (esforço L1 ou L2 do perfil em vigor), qualquer que seja o autor: a regra
  antiga de subir um degrau para autor barato saiu em 2026-11-03 (revisão extra redundante). Vale a
  família diferente e, na disputa, o árbitro.
- Qual é a sua família: no **Claude Code** é sempre Claude; no **OpenCode**, o plugin gêmeo injeta no
  contexto a sessão e o modelo: `anthropic/` é Claude e `openai/` é GPT. No Antigravity,
  `google/antigravity-claude-*` continua Claude; `google/antigravity-gemini-*` é Gemini.
  O provedor/canal não determina sozinho a família. Passe a família real ao script em `-Autor`;
  modelo sem família identificada não autoriza presumir uma revisão cruzada.
- O usuário pode inverter ("o GPT faz, você revisa"): siga o que ele disser, desde que as famílias fiquem
  diferentes.

Até 2026-10-24 "quem é quem" era por harness (Claude Code × Codex CLI). O Codex CLI deixou de ser harness
e canal: tudo que era GPT nele passa pelo OpenCode.

## Dados e fornecedores

Todo revisor, executor e árbitro (OpenAI pelo OpenCode, Anthropic, Google pelo agy, OpenRouter só a pedido) lê o pacote e
os arquivos do projeto, e o que lê sai do computador. O usuário aceitou que os dados dele e os que passam
pela mão dele sejam processados por esses fornecedores, em todos os projetos (usuário, 2026-10-22).
Documento pessoal ou sigiloso não impede a chamada a nenhum deles. Continua proibido: segredo (token,
chave, senha, `.env`) no pacote ou em arquivo que o modelo vá ler. No OpenRouter, a chamada pede só
provedores que não guardam o dado. Dado pessoal segue fora do git e de arquivo versionado (isso é sobre
publicar, não sobre quem processa). No modo Auto, o classificador do app pode barrar a chamada: não
contorne; o usuário troca o modo para Manual e aprova.

## 0. Quando revisar

Você decide, sem perguntar ao usuário (usuário, 2026-10-19: a decisão de mandar à revisão é da IA). Diga em uma
linha ("vai ao GPT em L2: 180 linhas novas e escreve no banco") e chame. Revise quando a entrega tiver:

- código ou script novo, ou mudança que passa de umas 30 linhas;
- algo que mexe com dado, dinheiro, produção, segredo, apagar ou sobrescrever;
- suposição que você não conseguiu testar;
- plano ou documento com decisão difícil de desfazer. Plano de adoção de produto, ferramenta ou sistema
  novo só se revisa **depois** que o usuário usou a coisa (seção 0 do `orquestrador`): antes disso a revisão
  espera, e só o plano que o teste dele invalidar é descartado. Plano técnico interno (refatoração,
  migração de código) revisa-se normalmente.

Não revise comando avulso, edição pequena, texto simples nem a mesma entrega duas vezes sem mudança.
O `STATUS.md` pode forçar (`sempre`, `sempre para: <escopo>`, seção 4), mas forçar não sobe o nível: a
régua abaixo vale igual, e texto forçado continua L0. O resto é este julgamento. O
custo é de cota, não do usuário: na dúvida entre revisar e perguntar, revise.

**Nível pelo risco, com escalada** (usuário, 2026-10-24: gastar onde há dúvida, não onde há acordo):

| Nível | Quando | Revisão |
|---|---|---|
| **L0** | docs ou texto, rename, menos de 30 linhas sem dado | sem outra família; o `/code-review` só se houver código (texto sem código dispensa) |
| **L1** | o comum: código novo, mais de 30 linhas, suposição não testada | outra família N3 no esforço L1 (Astra, Fable ou Argon) |
| **L2** | dado, dinheiro, produção, segredo, apagar ou sobrescrever, migração, irreversível | outra família N3 no esforço L2 (Astra, Fable ou Argon), testes obrigatórios e árbitro em qualquer `bloqueia` recusado |

- O script calcula o nível pelo diff quando você não passa `-Nivel`; `-Topo` promove o esforço; `-Economia` e `-UsuarioPediu` preservam os pisos e não promovem L0. Passe `-Nivel` quando souber algo que o diff não mostra (o arquivo vai à produção,
  o usuário disse que é descartável).
- Rodada 1 no nível calculado. Sobe (`-Topo`) só se vier `bloqueia` ou se você recusar um achado;
  árbitro só depois disso (seção 3b).
- **Configuração e código inativo descem um degrau.** Item novo numa lista, caminho ou parâmetro conhecido
  desce um nível, e o código candidato que ainda não roda em produção (inativo até um OK do usuário) também.
  O L2 fica para a publicação ou a ativação. Documentação e linha de `STATUS.md` são L0.
- **Delta depois de uma rodada:** a correção pequena dos achados ou o ajuste da mesma entrega (até umas 30
  linhas, sem mudar o desenho) vai só ao `/code-review` no delta, sem rodada nova de outra família. Só abre
  rodada nova se o delta mudar o desenho ou corrigir um `bloqueia` (seção 3).
- **Teto por fatia:** no máximo 2 rodadas de outra família por fatia, mesmo que a frente vire várias
  entregas e commits (usuário, 2026-11-03: "só duas rodadas cruzadas por fatia"). Sem terceira: `bloqueia`
  que continua em disputa vai ao árbitro (seção 3b); falta de decisão do usuário vai a ele. Por quê: em 24 e 25/10/2026 (linux-server,
  OpenCode), uma sessão com ~4 h de trabalho do modelo fez 9 revisões cruzadas, 8 delas em L2 `max`, e
  revisou em L2 até dois pares novos numa lista e candidatos inativos.
- **Sem revisão extra obrigatória redundante** (usuário, 2026-11-03): uma camada por papel. Testes e a
  revisão proporcional ao risco ficam; o que repete o mesmo pedido e diff na mesma família sai.
- **Conferência por subagente** (rodar de novo os testes "de forma independente"): só quando o autor não
  rodou os testes ou o diff mudou depois deles; nunca duas seguidas na mesma entrega.
- O contexto do revisor é uma dieta: diff, pedido, critério de aceite e as linhas relevantes do
  `STATUS.md`; o revisor abre arquivo sob demanda. Nada de colar o projeto inteiro.
- Uma linha por entrega no `STATUS.md` (seção 4), com o nível e os achados aceitos, para calibrar a régua.

## 0b. Antes do revisor: `/code-review`

Toda entrega com código passa pelo `/code-review` no diff, vá ou não à dupla (usuário,
2026-10-22: "sempre usar também, não exclusivamente, o code-review"; obrigatório para código, usuário,
2026-11-03). É camada a mais: não substitui o revisor, os testes nem a conferência.

- **Quando:** depois dos testes e antes de montar o pacote. Sem dupla, antes do commit.
- **Nível**: `codeReview.comum` do perfil em vigor no código comum; `codeReview.riscoElevado` em risco elevado (dado, dinheiro,
  produção, segredo, apagar ou sobrescrever). Passe sempre o nível: sem ele, a skill repete o último
  usado. Não use `--fix` nem `--comment`: você julga cada achado.
- **Achados:** julgue como na seção 3 (confirmado → corrija; recusado → motivo em uma frase). O que
  sobrou de dúvida entra no pacote em **Olhar com atenção**, e o resultado entra em **Já conferido**
  ("code-review low: 2 achados, 1 corrigido, 1 recusado porque ...").
- **Nos dois harness:** no Claude Code é o `/code-review` embutido; no OpenCode é o comando
  `/code-review <nível>` do plugin gêmeo, que chama `claude -p "/code-review <nível>"` (ponte no Max,
  testada em 2026-10-24). Sessão em modelo GPT também roda: a ponte é sempre o Claude.
- Texto, plano e documento sem código não passam pelo `/code-review`.

**`gpt-review.ps1` (camada GPT extra): desativada** (usuário, 2026-11-03: "GPT extra desativado"). Não
rode, nem como reserva da revisão cruzada: o script sai 0 com "dispensado" sem chamar nada
(`limites.gptExtra: false` na política). Só com pedido explícito do usuário, `-Forcar` religa uma
chamada (Astra, esforço L1 da política, ou L2 em L2 ou `-Alto`); `-SoDiff` continua
offline. Era a camada extra de 2026-10-22; saiu por ser revisão redundante ao `/code-review` e à
revisão cruzada.

## 1. Montar o pacote

Crie uma pasta nova `%TEMP%\dupla\<projeto>-<aaaammdd-hhmm>\` e grave nela o `pacote.md`, em
português, com:

- **Pedido:** o que o usuário pediu, nas palavras dele.
- **Critério de aceite:** quando está pronto. Se o usuário não disse, escreva o que você entendeu.
- **O que foi feito:** 3 a 6 linhas.
- **Escopo:** os arquivos tocados e como ver a mudança (`git diff`, `git diff <commit>..HEAD`,
  `git show <sha>`). Fora de repositório, liste os caminhos completos.
- **Diff:** cole no fim do pacote a saída do `git diff` (ou o conteúdo dos arquivos novos). O revisor
  `claude` não roda comando nenhum, só lê arquivos do projeto; o `gpt` e o `gemini` também ganham tempo
  com isso. Se passar de umas 1.500 linhas, divida a revisão em partes.
- **Dieta:** além do diff, só o pedido, o critério de aceite e as linhas do `STATUS.md` que importam
  (Decisões e Revisão cruzada da etapa). O revisor abre o resto sob demanda.
- **Já conferido:** testes e comandos que você rodou, com o resultado.
- **Olhar com atenção:** os pontos onde você tem menos certeza.
- **Decisões desta sessão:** o que foi escolhido de propósito e por quê, para o revisor não apontar
  como erro.

Nunca ponha segredo no pacote (senha, token, conteúdo de `.env`).

O recorte automático e a contagem usam a mesma lista conservadora de nomes sensíveis, incluindo
`.env*`, `id_*` e arquivos de chave. Os modelos `.env.example`, `.env.sample`, `.env.template`,
`.env.dist` e as chaves públicas `*.pub` podem entrar no anexo. O nome, por si só, não eleva o risco desses arquivos.

O revisor só lê a pasta do projeto (o `agy`, também a da saída). O que mora fora dela, como o
`CLAUDE.md` global, vai copiado no pacote. Não libere a pasta `.claude` por `--add-dir`: ela pode ter
credenciais e histórico.

## 2. Chamar o revisor

```
powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\revisar.ps1 -Autor claude|gpt|gemini [-Revisor gpt|claude|gemini] [-Papel revisor|arbitro] [-Revisou claude|gpt|gemini] -Pasta <raiz do projeto> -Pacote <pasta>\pacote.md -Saida <pasta>\revisao.md [-Nivel L0|L1|L2] [-Topo] [-Economia] [-UsuarioPediu] [-SemReserva]
```

- `-Autor` é obrigatório: a família da sessão (seção "Quem é quem"; `codex` vale como sinônimo de `gpt`).
  Sem `-Revisor`, o script escolhe a outra família (Claude → GPT Astra, GPT → Gemini Argon, Gemini →
  GPT). GPT → Argon, e não Fable, porque o Max fica para orquestrar (usuário, 2026-10-25); Claude → Astra,
  com Argon de reserva, desde 2026-11-07. Se o preferido ficar sem cota, falhar ou não entregar parecer completo,
  a mesma chamada tenta a outra família elegível, sem nova pergunta ao usuário. `-Revisor` escolhe a
  preferência; `-SemReserva` restringe a uma família para diagnóstico ou escolha explícita do usuário.
  Astra, Fable e Argon usam o mesmo esforço pelo nível (esforço L1 ou L2 do perfil em vigor).
  Mesma família nos dois sai com 2.
- Leva de 1 a 10 minutos. Dê ao comando o tempo máximo da ferramenta e avise o usuário em uma linha
  ("o GPT está revisando em L1").
- O pacote vai ao revisor anexado como arquivo (OpenCode: `--file`; agy e `claude -p`: pela entrada
  padrão). O revisor GPT roda numa config isolada só de leitura, sem MCP nem config do projeto. Por isso
  o pacote precisa ter tudo o que o revisor não acha sozinho no projeto.
- Nível e esforço do revisor, decididos por você sem perguntar ao usuário (usuário, 2026-10-18: "que isso fique
  automático"). Diga a escolha em uma linha ("revisão em L2: o script apaga dados do banco").
  - **Sem `-Nivel`**: o script calcula pelo diff não commitado (árvore limpa: o último commit; `-Diff
    <sha|a..b>` aponta outro) pela régua da seção 0 e roda a rodada 1 nesse nível. L1 é Astra, Fable
    ou Argon no esforço L1; L2, no esforço L2. Use `-SoNivel` para consultar a escolha antes da chamada.
  - **`-Nivel L2`** (ou **`-Topo`**, que ganha do cálculo): a entrega apaga ou sobrescreve dado, mexe
    com dinheiro, produção ou segredo, ou é difícil de desfazer (migração, conversão que substitui o
    original); ou a rodada 1 trouxe `bloqueia`, ou você recusou um achado. O risco define o piso;
    cota baixa não o reduz. Fonte esgotada tenta outra família elegível.
  - **`-Economia`**: mantém compatibilidade com os chamadores e o perfil com prazo. Economize
    despachos e revisões duplicadas. O piso de cada revisor vale também nesse perfil.
    Sem variante disponível, registre indisponibilidade; não omita o esforço silenciosamente.
- A saída 0 exige parecer completo, não só texto ou processo encerrado. Mensagem de limite de uso,
  resposta vazia ou interrompida e um exemplo de parecer não contam como revisão. L0 dispensado
  explicitamente pela régua mantém seu resultado próprio; não se rebaixa uma etapa por falta de cota.
- O script guarda cada tentativa e `<Saida>.rota.json`, com família real, código, estado, veredito, id da chamada e SHA256 do pacote.
  `revisado` significa parecer recebido: a autora ainda precisa julgar os achados e liberar a etapa.
  Exija código zero da chamada atual e o parecer atual; metadado antigo não vale. Use essa
  família no STATUS e em `-Revisou` ao chamar árbitro; não presuma o revisor inicialmente escolhido.
- Saída 3 após esgotar reservas = **revisão pendente**. Preserve o trabalho e registre o impedimento;
  não faça commit de entrega que exige revisão, deploy nem conclusão como conferida. Pode continuar
  preparação reversível independente. Retome pela primeira fonte elegível que recuperar cota.
- Saída 2 encerra a cadeia por argumento inválido ou recusa de segurança.
  Quando uma família não consegue montar o ambiente de leitura, ela encerra a tentativa antes de
  receber o pacote. A reserva só recebe o pacote com suas próprias travas ativas.
  Falha de ferramenta ou recusa de segurança não autoriza desativar proteção. OpenRouter e novas
  fontes pagas continuam exigindo autorização; nunca entram automaticamente.
- O `/code-review` continua sendo uma camada adicional. Se a ponte estiver sem cota, registre a
  indisponibilidade e faça a revisão cruzada completa pela reserva disponível; não finja que o comando
  rodou nem conte a falha como parecer. Se nenhuma revisão exigida puder ocorrer, a etapa fica pendente.

## 3. Julgar cada achado

O revisor pode errar. Para cada achado, confira no código ou no documento antes de agir:

- **Confirmado:** corrija.
- **Recusado:** anote o motivo em uma frase (já tratado, decisão do usuário, o revisor leu errado).
- **Pergunta:** se só o usuário sabe responder, ela vai para a **Sua vez** como 🧠.

Se você corrigiu algum `bloqueia`, chame o revisor de novo só para esses pontos (um pacote novo,
curto). São no máximo 2 rodadas por fatia (seção 0, teto por fatia).

Veredito **não comprovado**: não há o que corrigir, falta prova. Produza a evidência que a seção **Não
conferido** pede (rode o teste, mostre a saída, abra o arquivo) e só então dê a etapa por concluída. Se a
prova não cabe a você (dado que só o usuário tem, uso real), vai à **Sua vez**; não conte como aprovado.

## 3b. Árbitro, quando houver disputa

Se, no fim das rodadas, você recusou algum achado `bloqueia` ou `corrigir`, o árbitro desempata antes
de a disputa chegar ao usuário. Em L2, todo `bloqueia` recusado vai ao árbitro, sem exceção. Recusa de
`melhoria` e as `pergunta` não vão ao árbitro.

O árbitro é a **terceira família**: a que não é nem do autor nem do revisor.

| Autor | Revisor | Árbitro |
|---|---|---|
| Claude | Gemini Argon (padrão desde 2026-10-28) | GPT Astra; zerado → pendente (Muse só se autorizado) |
| Claude | GPT Astra (Argon zerado) | Gemini Argon; zerado → arbitragem pendente |
| GPT | Gemini Argon | Claude Fable (no Max; raro e só leitura) |
| GPT | Claude | Gemini Argon |
| Gemini | GPT | Claude Fable |
| Gemini | Claude | GPT Astra; zerado → pendente (Muse só se autorizado) |

O OpenRouter só entra se o usuário autorizar seu uso pago para essa arbitragem, quando a terceira família
é o GPT e a cota do ChatGPT zerou (`-Revisor openrouter -Papel arbitro`). Nunca entra por falta de tokens sozinha.

1. Na mesma pasta, grave `arbitragem.md`: o `pacote.md` inteiro, a `revisao.md` inteira e, no fim,
   uma seção **Recusas do autor** com cada achado recusado (número, severidade) e o seu motivo.
2. Chame a terceira família: diga quem escreveu (`-Autor`) e quem revisou (`-Revisou`), e o script
   escolhe a que sobra (no caso comum, o Argon); `-Revisor` só para forçar, e igual a uma das duas sai 2:
   ```
   powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\revisar.ps1 -Autor claude|gpt|gemini -Revisou gpt|claude|gemini -Papel arbitro -Pasta <raiz do projeto> -Pacote <pasta>\arbitragem.md -Saida <pasta>\arbitragem-saida.md
   ```
   Sem Argon N3 disponível, o árbitro fica pendente. Flash não substitui arbitragem N3.
   Saiu com 3 e a terceira família é o GPT? Só chame `-Revisor openrouter` se houver autorização explícita
   para esse uso pago. Sem autorização ou sem terceira família disponível, preserve a disputa pendente;
   uma decisão do usuário pode encerrá-la, mas falta de cota não valida a recusa nem libera a entrega.
3. Cumpra a decisão: `revisor` → corrija; `autor` → fica como está; `usuário` → vira 🧠 na **Sua vez**,
   com os dois lados em uma linha cada. Se você discordar de um `revisor` do árbitro, não insista
   sozinho: vai ao usuário com os três motivos.

É uma rodada só. O pacote e os arquivos que o árbitro ler saem do computador (Google; seção "Dados e
fornecedores"). O Muse pelo OpenRouter (`-Revisor openrouter`) só entra como árbitro de reserva (acima)
ou se o usuário pedir; nunca como revisor nem executor por conta própria.

## 4. Registrar no STATUS.md

Atualize o `STATUS.md` da raiz do projeto. Se ele não existir, crie-o neste formato:

```
# Estado do projeto
Atualizado: <aaaa-mm-dd hh:mm> por <Claude Code | OpenCode> (<família do modelo>)

## Agora
- <o que está em andamento e o próximo passo>

## Feito
- <aaaa-mm-dd> <entrega, em uma linha>  (só as últimas 10; as antigas saem)

## Decisões
- <aaaa-mm-dd> <o que foi decidido> — <por quê>

## Pendências
- <com quem: usuário, Claude Code, OpenCode> <o quê>

## Revisão cruzada
<sempre | sempre para: <escopo> | por julgamento>
- <aaaa-mm-dd> <nível> <família e modelo do revisor> revisou <o quê>: <veredito>; <n> aceitos, <n> recusados (<motivo curto>)[; árbitro <família>: <n> autor, <n> revisor, <n> usuário]
```

Exemplo da linha: `- 2026-10-24 L1 GPT Astra low revisou o conversor OFX: aprovado com correções; 2
aceitos, 1 recusado (já tratado no STATUS)`. O nível e os achados aceitos ficam na linha para calibrar a
régua da seção 0 com o tempo.

A primeira linha de **Revisão cruzada** diz quando esta skill roda além do julgamento da seção 0:

- `sempre`: antes do commit de toda etapa.
- `sempre para: <escopo>`: antes do commit da etapa que toca o escopo (ex.: "peça que vai ao SEI",
  "código que escreve no banco de produção"). Na dúvida se a etapa toca o escopo, rode.
- `por julgamento`: só os critérios da seção 0, decididos pelo agente. É o padrão; `quando o usuário pedir`,
  nos STATUS antigos, vale o mesmo (o usuário pedindo continua valendo, claro).

Fora de repositório git, "antes do commit" vale como "antes de dar a etapa por concluída".

**Um escritor por linha.** Várias sessões dividem o arquivo: cada uma acrescenta as próprias linhas e
só mexe nas que ela escreveu. Linha de outra sessão que ficou velha (já feita, decisão mudada) não se
reescreve: acrescente uma linha nova que a corrige, citando a data dela. Só a faxina das 10 últimas do
**Feito** apaga linha de outro. Antes de gravar, releia o arquivo: outra sessão pode ter gravado no meio.
(Ideia tirada da alethe, "progress só anexa", 2026-10-25.)

Mantenha o arquivo com até umas 60 linhas: é um quadro, não um diário. O histórico completo já
fica no ai-memory e no git.

## 5. Contar ao usuário

Na mensagem final, nos detalhes: o veredito, o que foi corrigido e o que foi recusado, com o motivo.
O que ficou para o usuário decidir vai para a **Sua vez**. Não cole a revisão inteira.

## 6. Subagente executor (o agy ou o opencode faz, você revisa)

Para uma tarefa fechada que um executor pode fazer sozinho (testes, script pequeno, refatoração de
escopo claro), a sessão despacha e depois revisa só lendo, no papel da skill `revisor`. Executor
sempre num modelo barato que dá conta (usuário, 2026-10-18): o topo fica para revisar. Tarefa que pede o
melhor modelo não vai a executor; vai a uma filha Opus (skill `orquestrador`).

1. Grave a tarefa em `%TEMP%\dupla\<projeto>-<executor>-<assunto>-<aaaammdd>\tarefa.md`, em
   português: o que ler primeiro, objetivo, critério de aceite, limites (quais arquivos pode tocar,
   sem commit, sem rede, sem dado pessoal), os comandos de teste a rodar (no opencode) e o relatório
   esperado no fim.
2. Chame, em segundo plano, com o tempo máximo da ferramenta:
   ```
   powershell -ExecutionPolicy Bypass -File $HOME\.agents\skills\dupla\scripts\despachar.ps1 -Pasta <raiz do projeto> -Tarefa <pasta>\tarefa.md -Saida <pasta>\relatorio.md -Nivel simples|comum|dificil [-CapacidadeMinima N1|N2|N3] [-Executor agy|opencode] [-Modelo <id>] [-Esforco low|medium|high|xhigh] [-Conjuntos geral,backend|geral,frontend|nenhuma] [-Rede]
   ```
   O `-Conjuntos` cola as regras de `dupla\regras\` antes da tarefa (padrão `geral`; `orquestrador`, seção 5).
   O `-Nivel` é o seu julgamento da tarefa, e o script escolhe o modelo (tabela abaixo). Quem vai é o
   primeiro da fila pela folga (última linha do `recursos.ps1`; `orquestrador`, seção 4) entre os que
   servem: tarefa que roda comando ou teste só no opencode (GPT, ou `-Modelo anthropic/<id>` quando o
   crédito da API está antes na fila); o resto também pode ir ao agy (sem `-Executor`).
   `-Executor codex` ainda vale como sinônimo de opencode com GPT. `-Rede` é só compatibilidade com o
   Codex de antes e não libera nada: as ferramentas de URL, busca e `fetch` ficam negadas em todo
   executor; o que o teste em si faz pela rede (um `pip install` dentro do `.py`) a trava não vê. O
   relatório final fica em `-Saida` e o log completo em `relatorio.md.log`. Códigos de saída:
   - `0`: feito, relatório em `-Saida`.
   - `1`: o executor falhou; a saída traz o fim do log. No opencode, também quando a tarefa passou de
     US$ 2,00 (provedor `anthropic`) ou de 40 minutos: o script derruba o processo; confira o que ele já
     gravou.
   - `3`: a cota ou o crédito do executor acabou: o próximo da fila que serve ao papel assume. Com 1
     ou 3, a troca segue o `orquestrador`, seção 5 (cota: uma tentativa por fonte; correção: até 2; antes, confira o que o executor
     já gravou). O OpenRouter nunca é executor.
3. Confira o diff e faça rodar os testes, lendo a saída crua (seções 5 e 6 do `orquestrador`: a
   conferência longa vai a um subagente; você roda só 1 ou 2 comandos curtos). O teste que o opencode
   diz ter rodado não conta: roda de novo por outro; OpenRouter e agy não rodam comando nenhum. Rode o
   `/code-review` no diff (seção 0b; a camada GPT extra está desativada) e julgue como na
   seção 3. Conferido, o commit e o push saem sem pedir OK (`orquestrador`, seção 1). Registre no
   `STATUS.md` como "<executor e modelo> fez, <família> revisou". Se a entrega pedir revisão cruzada
   (seção 0), o revisor é de outra família que o executor (`-Autor` = a família do executor, não a
   da sessão): executor Claude (agy Sonnet ou Opus, opencode `anthropic/`) → Gemini (Argon, em teste desde 2026-10-28; zerado, GPT Astra); executor GPT
   (opencode `openai/`) → Gemini (Argon; zerado, Claude Fable); executor Flash ou Flash-Lite → GPT. Mesma
   família não conta como segunda opinião; o esforço do revisor segue só o risco (esforço L1 ou L2 do perfil).

Duas tarefas de escrita nunca correm ao mesmo tempo nos mesmos arquivos: o executor trabalha na
pasta real do projeto, não numa cópia.

### Os três executores

Sem ordem fixa desde 2026-10-25 (usuário): vai o primeiro da fila pela folga que serve ao papel
(`orquestrador`, seção 4). O agy (plano Google AI Pro, com um grupo Claude/GPT de limite próprio) não roda
comando. O opencode com GPT (assinatura do ChatGPT; até 2026-10-24 esse papel era do Codex CLI) e o
opencode com Claude (crédito mensal da API que vem com o Max, que não acumula) rodam comando e teste, com
a trava da lista de permissões abaixo. O OpenRouter nunca é executor.

| Executor | Como roda | Modelo pelo `-Nivel` | Custo |
|---|---|---|---|
| `agy` (padrão; não roda comando) | Antigravity CLI (`agy -p`) com um home só do despacho em `%LOCALAPPDATA%\dupla\agy-fazer\<id>`: libera `write_file` só na pasta do projeto (menos `.git` e `.env`) e nega comando, URL e MCP. O settings.json do revisor (`~\.gemini\antigravity-cli`) fica intocado | O mais novo da família. `simples`: Gemini Flash-Lite, que só atende o esforço `low` (piso acima disso ou ausente no catálogo: cai no Gemini Flash com a variante do piso). `comum`: Claude Sonnet (hoje `claude-sonnet-5-5-<esforço>`). `dificil`: Claude Opus (hoje `claude-opus-5-5-<esforço>`). Esforço de cada nível pelo perfil em vigor. O Argon só revisa: `-Modelo` com ele sai com 1 | Plano Google AI Pro do usuário, sem custo por chamada; limites do grupo Gemini e do grupo Claude/GPT (5 h e semanal) e do Argon (semanal), no `agy -p "/usage"` |
| `opencode` com GPT (automático para N1, N2 e N3; tarefa que roda teste; reserva do agy) | `opencode-cli run --standalone --auto` com uma pasta de config só do despacho em `%LOCALAPPDATA%\dupla\opencode-fazer\<id>` (`OPENCODE_CONFIG_DIR`; sem config do projeto nem do `~\.claude`, sem MCP, sem instructions, segredos do ambiente apagados); trava abaixo. Tarefa anexada (`--file`); roda comandos e testes; ferramentas de rede negadas (`-Rede` não libera nada) | O mais novo da família no provedor `openai`. `simples`: GPT-Luna. `comum`: GPT-Terra (hoje `openai/gpt-6.1-terra`). `dificil`: GPT-Sol (hoje `openai/gpt-6.1-sol`), cada um no esforço do nível pelo perfil em vigor; sem Sol no catálogo, Claude Opus N3 pelo crédito da API, descrito na linha seguinte. `dificil` com capacidade explicitamente N2: GPT-Terra no escalado N2. `-Modelo` aceita um `openai/<id>` de `opencode models`, menos o Astra (sai com 1: ele revisa, não executa) | Assinatura do ChatGPT do usuário, sem custo de API: janela de 5 h e semanal, a mesma do Astra que revisa |
| `opencode` com Claude (automático para N3 sem Sol, ou `-Modelo anthropic/<id>`) | O mesmo `opencode-cli run --standalone --auto`, mesma config isolada e mesma trava | O mais novo da família no provedor `anthropic`, nunca os `-fast`. `simples`: Claude Haiku. `comum`: Claude Sonnet (hoje `claude-sonnet-5-5`). `dificil`: Claude Opus (hoje `claude-opus-5-5`), cada um no esforço do nível pelo perfil em vigor. Fable só revisa: `-Modelo` com ele sai com 1 | Crédito de US$ 100 por mês da API da Anthropic que vem com o Max (chave `opencode-reserva`), sem rollover; esgotado, a API recusa sem cobrar. O rodapé traz o custo da sessão; teto de US$ 2,00 por tarefa |
| `openrouter` (só se o usuário pedir) | Laço do `openrouter.ps1 -Papel fazer`: ler, listar, buscar, `write_file` e `edit_file`, presos à pasta do projeto, sem `.git` nem arquivos de segredo, sem comando nem rede. Até 60 passos, 300 KB gravados (200 KB por arquivo) e US$ 2,00; passou, para com 1 | O Muse Wonder, com o Muse Spark 1.3 e o Qwen3.8 Max atrás, esforço `low`, `medium` ou `high`. `-Modelo` aceita um id do OpenRouter (ou vários, separados por vírgula) | Paga por chamada; o rodapé do relatório traz o custo |

No agy, um `-Modelo` explícito presente no catálogo sem sufixo pode rodar com o esforço padrão do provedor quando o chamador omite `-Esforco` e falta uma variante suficiente. O registro separa o esforço pedido de `esforcoSelecionado = nao-informado`. Com `-Esforco` explícito, a rota exige uma variante compatível.

Como julgar o `-Nivel`:

- `simples`: mecânica, sem decisão (renomear, ajustar texto, script curto, teste de um caso já escrito).
- `comum`: código de escopo claro com critério de aceite testável; o padrão.
- `dificil`: lógica com casos de borda, vários arquivos, conversão de formato. Se pede desenho ou decisão
  técnica, não é executor: é filha Opus.

**Trava do opencode.** O shell do OpenCode não tem sandbox do sistema, então a trava é a lista de
permissões que o script grava (OpenCode v2: a última regra que casa vence). Tudo começa negado; depois:
ler, listar e gravar na pasta do projeto (fora dela, `external_directory` nega), menos `.git`, `.env`,
arquivo de segredo e config do OpenCode no projeto; `grep` negado (o recurso dele é a expressão, e no
teste ele mostrou o `.env`); no shell, só `python -m pytest|unittest|py_compile|doctest|compileall`,
`pytest`, `python <arquivo>.py`, `node --test`, `node <arquivo>.js`, `npm test`, `npm run test|lint` e
`git status|diff|log|show|ls-files|blame|rev-parse`; nenhuma opção do `python` ou do `node` antes do
arquivo (o `-c<código>` colado passaria), sem `node -e`/`-r`/`--import`, `git --no-index`/`-c`, nome de
arquivo de segredo, redirecionamento, variável, `&`, parênteses e chaves (o PowerShell avalia
`(Get-Content .env)` no meio dos argumentos), caminho absoluto, `..` ou `~` na linha. Sem o plugin
`segredos`, o despacho nem começa. Subagente, Code Mode (`execute`, que tem `fetch`),
web, skill e MCP ficam negados. O plugin `segredos` do usuário vai junto. Testada em 2026-10-22 pelo
`scripts/testar-trava-opencode.ps1` (31 casos: gravar e ler fora, `whoami`, `;`, `&&`, `>`, `|`, `(...)`,
`$(...)`, opção colada (`python -c"..."`), `git diff --no-index`, `.git`, `.opencode`, `.env`, script fora da pasta, opencode.json de projeto que libera tudo):
rode-o de novo quando o OpenCode atualizar. O limite que fica: o teste é código que o próprio executor
escreveu (o `.py`, o `conftest.py`, o script do `package.json` que o `npm test` chama) e roda com o
usuário do usuário, com rede e com o home inteiro à vista, sem sandbox: as ferramentas do OpenCode ficam
presas à pasta, o teste não. Um teste errado (caminho trocado) também pode gravar ou apagar fora. É o
mesmo risco de o usuário rodar à mão o teste que um colega escreveu, e fica aceito assim, com as regras de
uso abaixo. A trava segura engano do modelo na linha de comando, não modelo hostil nem teste com defeito:
ler o diff depois não desfaz o que o teste já fez. Por isso só vai ao opencode tarefa cujo
material o usuário ou a sessão que despacha escreveu ou confere (nada de texto de terceiro, página, e-mail ou
anexo baixado que possa trazer instrução escondida), e nunca projeto com dado sensível fora do git
(banco, produção).

Cotas e crédito, sem gastar nada (`scripts/cota.ps1`, `scripts/opencode_custo.py`):

Na revisão, os códigos 1/3 por fonte abaixo são internos à tentativa. O coordenador percorre as
reservas; a saída 3 da chamada pública só ocorre quando nenhuma entregou parecer. Na execução com
escrita, código 3 exige conferir o diff e continuar pela fonte elegível, sem repetir trabalho às cegas.

- **ChatGPT (opencode com GPT, revisor Astra)**: o script lê
  `~\.local\share\dupla\cota-chatgpt.json`, que o plugin gêmeo do OpenCode grava a cada resposta do
  provedor `openai` (janela de 5 h e semanal, com o % usado e quando volta). Em 2026-10-24 o backend
  ainda não mandava percentual nesses cabeçalhos; aí o script cai no retrato do Codex
  (`~\.codex\sessions`, `rate_limits` com `limit_id` `codex`; a janela se reconhece pelo
  `window_minutes`, e hoje só a semanal vem). Retrato com mais de 1 h: o script pede um fresco com uma
  chamada mínima ao Codex CLI (Luna low, "responda so: ok", 6 s), o único uso que sobrou para ele.
  Regras iguais nas duas fontes: com uma janela em 100% e ainda
  aberta, sai com 3 sem chamar. Antes de 100%, preserva o esforço exigido pelo risco. Se a cota acabar no meio
  (`usage_limit_exceeded`, "You've hit your usage limit"), também sai com 3.
- **agy**: o script lê o `agy -p "/usage"` (o que resta de cada limite). Grupo do modelo escolhido
  (Gemini ou Claude/GPT) zerado, ou Argon reservado ao árbitro: sai com 3. Cota que acaba no meio (`quota` ou `RESOURCE_EXHAUSTED` no stderr):
  também.
- **opencode com Claude**: o OpenCode não mostra o saldo; o script soma o gasto do mês no provedor
  `anthropic` pelo banco dele (`~\.local\share\opencode\opencode.db`, cálculo do OpenCode; o Console da
  Anthropic é a conta oficial) e sai com 3 a partir de US$ 100. Durante a tarefa, lê o custo da sessão a
  cada 15 s e corta acima de US$ 2,00. Crédito que acaba no meio ("credit balance" no log): sai com 3.

Critério das reservas (ordem: agy → opencode com GPT → opencode com Claude):

- **agy**: no plano Google AI Pro do usuário, sem custo por chamada. O Flash escreve bonito e erra a lógica: por isso só pega as simples, e o diff dele pede mais cuidado. Ele não roda teste: quem confere roda. No `-p`,
  uma gravação negada pode encerrar a rodada sem relatório (sai com 1): confira o que ele já gravou e,
  se não fez, vá ao opencode com GPT.
- **opencode com GPT**: na assinatura do ChatGPT, sem custo de API; a janela é a mesma do Astra que
  revisa, então tarefa grande demais ali deixa a revisão sem cota. Roda teste (trava acima).
- **opencode com Claude**: o crédito é do ciclo de cobrança do Max (dia 20 ao 19, não o mês do calendário)
  e não acumula, então usar é melhor que guardar. Uma tarefa
  comum custa centavos (no teste, função e 9 testes no Sonnet por US$ 0,03). O rodapé marca `ATENCAO`
  acima de US$ 0,50: avise o usuário quando uma tarefa passar disso.
- **OpenRouter**: fora das reservas desde 2026-10-22 (usuário, sem verba); só quando o usuário pedir. Paga por
  chamada; o rodapé marca `ATENCAO` acima de US$ 0,50.
- Em todos, a tarefa e os arquivos que o modelo ler saem do computador (Google; Anthropic; OpenAI;
  OpenRouter e Meta; seção "Dados e fornecedores").
