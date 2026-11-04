# gemeo

Plugin do OpenCode V2 que dá ao OpenCode as ferramentas do Claude Code desktop **com os mesmos
nomes**, para as skills e o `CLAUDE.md` global rodarem nos dois harness sem mudar.

Carregado pelo `~/.config/opencode/opencode.json` (`"plugins": ["<caminho>/delcouncil/mods/gemeo"]`).
Confira a carga com `opencode-cli.exe api get /api/plugin` (em `data`, id `gemeo`, `state.status: active`).

## Ferramentas

| Ferramenta | No OpenCode |
|---|---|
| `set_session_title({ session_id, title })` | `session.update({ title })`. `"self"` = a própria sessão. |
| `set_pinned({ session_id, pinned })` | Não há fixar na barra: guarda em `ctx.storage` (`pinned/<id>`) e em `metadata.gemeo.pinned`. |
| `archive_session({ session_id, reason? })` | `session.update({ archived: true })`; como o SDK 2.1.4 descarta esse campo, confere `time.archived` e, se não pegou, faz o PATCH pelo `opencode-cli.exe api patch`. Renomear para `🗄️` antes fica com o agente. |
| `rotear_tarefa({ fatia, nivel, familia, papel, motivo, canal?, escalado?, risco? })` | Valida a política comum e prepara uma rota; retorna `pendente`, sem alterar modelo da sessão existente. |
| `start_session({ cwd, prompt, title?, rota?, model?, effort?, background?, ... })` | `session.create` na pasta `cwd`; com `rota`, aplica modelo/variante e confere por `session.get` antes do primeiro prompt. Devolve `{ session_id, rota? }`. |
| `spawn_task(...)` | Igual ao `start_session` (não há cartão): devolve `note: "aberta direto"`. |
| `SendMessage({ to, message })` | `session.prompt` na sessão `to` (`local_<id>` ou `<id>`). |
| `list_events({ session_id, limit? })` | `session.context`, últimas `limit` (20) mensagens resumidas. |
| `request_directory({ path })` | Sempre `{ ok: true }`: não há trava de pasta. |
| `get_usage()` | `{ unavailable: true }`: não há leitura do Max. |

No caminho legado sem `rota`, `model` aceita `provider/id`, apelido do Claude Code (`haiku`, `sonnet`, `opus`, `fable` → o mais
novo da família em `anthropic`, sem `-fast`) e id solto (`claude-sonnet-5-5`). `effort` vira a
`variant` do modelo (`low`, `medium`, `high`, `xhigh`, `max`) quando o modelo tem essa variante;
senão é ignorado e a resposta avisa. Modelo explícito não reconhecido é recusado, sem cair no padrão. `name`, `context`, `initiation` e `use_worktree` são ignorados.

## Rota validada antes do despacho

O agente julga a capacidade, chama `rotear_tarefa` e passa o mesmo objeto em `rota` no despacho:

```json
{"cwd":"C:/projeto","prompt":"Brief autorizado e autossuficiente","rota":{"fatia":"implementacao-1","nivel":"N2","familia":"terra","papel":"execucao","motivo":"mudança delimitada"}}
```

A política vem de `~/.agents/skills/orquestrador/politica-modelos.json`, com reserva em
`~/.claude/skills/orquestrador/politica-modelos.json`; `ORQUESTRA_POLITICA` define um caminho explícito.
O validador comum está em `../orquestra/hooks/roteamento.ts`; mantenha os dois módulos deste
repositório juntos. A escolha é do agente, sem classificador por palavras nem consulta auxiliar a modelo.

O preparo separado é opcional: o primeiro `start_session`/`spawn_task` com `rota` também reserva
essa escolha para o chamador. Antes de criar, todo despacho confere a reserva existente; a mesma
`fatia` não pode mudar de família, canal, nível ou esforço. Preparo e despachos simultâneos do mesmo
chamador são serializados nessa conferência. Para outra escolha, use uma nova fatia/tentativa.
O histórico fica no mapa `rotas/<chamador>`, por ID de fatia, e sobrevive à recarga do plugin;
preparar B não apaga a reserva de A. O slot `rota-preparada/<chamador>` apenas indica o último preparo.

Com `rota`, modelo indisponível ou variante ausente recusa o despacho sem reduzir capacidade/esforço.
`rota` não pode competir com `model`/`effort` explícitos. O plugin usa
`ctx.session.switchModel({ sessionID, model: { providerID, id, variant } })`, só com o ID recém-criado,
e confere `ctx.session.get` antes de admitir o prompt. A resposta distingue `pedido` e `aplicado`;
divergência remove somente a sessão criada e não envia o primeiro prompt. Essa confirmação é da
seleção no servidor, não um eco do esforço pelo provedor.

`canal` é opcional: ausente ou `"nativo"` preserva a seleção atual por `anthropic`/`openai` e o
esforço em `variant`. Reservas antigas sem esse campo também significam `nativo`. Para usar o
catálogo do plugin Antigravity, escolha explicitamente `"canal":"antigravity"`:

```json
{"cwd":"C:/projeto","prompt":"Brief autorizado e autossuficiente","rota":{"fatia":"implementacao-agy-1","nivel":"N2","familia":"sonnet","canal":"antigravity","papel":"execucao","motivo":"integração delimitada pelo canal escolhido"}}
```

Nesse canal, o resolver usa somente modelos habilitados de `google` com prefixo `antigravity-`,
família exata e esforço no ID. Como a dupla (`despachar.ps1` e `Select-VarianteAgy`), escolhe a
versão numérica mais nova da família e, nela, o pedido ou o menor superior entre `low`, `medium`,
`high` e `xhigh`, sem promoção automática para `max`. Pedidos Claude
`max` vindos da política exigem sufixo `-max` exato e habilitado. Não aceitam redução.
Na revisão, Astra, Fable e Argon usam `revisao.L1/L2` (hoje `low`/`medium`, usuário, 2026-11-03).
L1 escalada usa L2. Essas três famílias não executam nem orquestram.

A versão é comparada numericamente (por exemplo, 5.10 depois de 5.9); o resolver não usa o
comprimento do nome nem a ordem lexical da versão. Se a versão mais nova habilitada não tiver esforço
suficiente, recusa, como a dupla, em vez de voltar para uma versão anterior.
No catálogo conferido em 03/11/2026, Sonnet N2 low resolve para
`google/antigravity-claude-sonnet-5-5-low`, Opus N3 medium para
`google/antigravity-claude-opus-5-5-medium`, Argon revisão L2 medium para
`google/antigravity-gemini-4-argon-medium` e Flash-Lite N1 para
`google/antigravity-gemini-3.5-flash-lite` (sem sufixo: só atende o piso `low`).
`variants: []` é esperado: o esforço está no ID real.
O plugin envia `{ providerID, id }`, sem `variant`, e confere a referência exata no servidor antes
do prompt. O retorno e `rota/<sessão>` preservam a rota original em `pedido`, registram separadamente
`pedido.esforco` como esforço pedido e `esforco.valor` como esforço aplicado confirmado.
Por exemplo, `esforco: { valor: "medium", representacao:
"embutido_no_id" }`; no canal nativo, a representação é `"variant"`. O campo `aplicado` permite
conferir o ID ou a variante correspondente, sem afirmar eco de esforço da inferência.

Não há troca silenciosa de canal nem redução de esforço. Se não houver esforço igual ou superior
permitido, a rota é recusada antes de criar sessão. No canal nativo, a variante continua exata.
Flash-Lite, Flash e Argon exigem `canal: "antigravity"` no OpenCode. Flash-Lite é família própria
(N1), não substituto do Flash (N2). GPT-OSS e nomes fora da gramática conhecida não são classificados
como substitutos. Sonnet/Opus via `google` continuam família Claude para a revisão cruzada.
Na fila do chamador, o primeiro despacho reserva o esforço selecionado por fatia em
`rotas/<chamador>`, no campo `esforcoSelecionado` do registro da fatia. Preparo novo usa `null`
até o primeiro despacho; novos preparos preservam a seleção. Reservas antigas sem esse campo
conservam o esforço exato, único permitido antes. A rota ativa da filha também preserva o esforço aplicado.
Essa reserva sobrevive à recarga e não afirma aplicação: a confirmação continua dependendo de
`session.get`. Repetir a fatia com catálogo que selecione outro esforço é recusado antes de criar
sessão, inclusive se o esforço exato reaparecer; use outra fatia/tentativa. A reserva também é
preservada se a confirmação ou o prompt falhar. Autenticação, configurações e scripts da dupla
permanecem com seu fluxo existente.

Não há troca da sessão OpenCode existente: `rotear_tarefa` nela fica pendente, inclusive durante
steering. Execute a tarefa atual pelo motor `despachar.ps1` da dupla com a capacidade adequada, sem
pedir repetidamente ao usuário que troque modelo ou envie outro turno. Escalada exige nova `fatia` e
`escalado: true`; revisão exige N3 e risco L1/L2. L1 escalada usa o esforço L2, igual para as três
famílias de revisão. O caminho legado sem `rota` mantém o comportamento anterior e seus avisos.

Depois de alterar este plugin local, use `opencode-cli.exe reload` e confira o estado de `gemeo`
em `/api/plugin`. A API V2 não expõe `/api/tool`; `ctx.tool.list()` é uma API interna de plugin.
Recarga e estado ativo confirmam o carregamento; os testes abaixo conferem o registro e o fluxo
das ferramentas com SDK simulado. O carregamento depende também do arquivo compartilhado fora
de `gemeo`; sem confirmação ao vivo de uma chamada, declare esse limite.

## Hooks

- `context`: acrescenta ao system prompt uma nota dizendo que está no OpenCode, a sessão, o modelo
  e quais ferramentas existem, a política de roteamento e a rota confirmada desse despacho
  (e que sim/não ao usuário vai pela `question`).
- `http.response` (só `providerID: "openai"`): lê os cabeçalhos `x-codex-*` da resposta do backend
  do ChatGPT e grava `~/.local/share/dupla/cota-chatgpt.json`:

```json
{
  "at": "2026-10-24T12:00:00.000Z",
  "headers": { "x-codex-primary-used-percent": "12", "...": "..." },
  "primary": { "used_percent": 12, "resets_at": "2026-10-24T17:00:00.000Z" },
  "secondary": { "used_percent": null, "resets_at": null },
  "quota_at": "2026-10-24T12:00:00.000Z"
}
```

  `at` é a última resposta com algum `x-codex-*`; `quota_at` é a última que trouxe percentual
  (`-used-percent` / `-reset-after-seconds`). Resposta só com `x-codex-turn-state` atualiza `at` e
  `headers`, mas mantém `primary`/`secondary`/`quota_at` anteriores. Sem cabeçalho `x-codex-*`,
  não grava.

## Comando

- `/cpa <args>`: manda à sessão "Siga a skill cpa. Argumentos: <args>".

## Testar

```powershell
node --test gemeo/rota.test.ts gemeo/integracao.test.ts gemeo/fontes-cli.test.ts
```

Testado com Node 26. Os testes simulam o SDK/servidor e verificam esforço no ID Antigravity,
versão numérica, recusa de xhigh ausente, canal fixo com reservas antigas, aliases nativos,
recusa de variante ausente,
pedido versus aplicado, ordem `switchModel → get → prompt`, isolamento do ID recém-criado,
pendência na sessão existente e remoção da sessão criada quando a confirmação diverge. Não abrem
sessões reais nem chamam modelos.


## Travas globais de fontes

`/fontes` lista o estado sem inferência. `/fontes desligar chatgpt` trava a fonte;
`/fontes ligar chatgpt` libera. Os IDs são `claude-max`, `chatgpt`, `anthropic-api`,
`antigravity` e `openrouter`. O comando registra a resposta local com `resume:false`,
portanto pode liberar a assinatura mesmo quando o modelo da sessão está bloqueado.
Só use os comandos de alteração por decisão explícita do usuário; o agente não libera
fontes automaticamente para continuar um trabalho.

O estado é o mesmo dos scripts da dupla e do painel Claude: `%USERPROFILE%/.local/share/dupla/fontes.json`
(`HOME` como reserva; sem home absoluto, bloqueia). `LOCALAPPDATA` nunca define o canônico. Sem prazo, sem reset automático.
Apenas a CLI `~/.agents/skills/dupla/scripts/fontes.ps1` escreve, com exclusão mútua e substituição do arquivo.
Sem os dois arquivos canônicos, a leitura conserva a união das travas legadas; JSON inválido, ilegível, versão/tipo/ID desconhecido bloqueia todo consumo.
Formato persistido: `{"versao":1,"bloqueadas":["chatgpt"]}`; BOM UTF-8 é aceito e IDs repetidos
são deduplicados. Chaves extras são inválidas.

As guardas leem novamente antes de novos prompts, `SendMessage`, `/cpa`, contexto e nos hooks
`model.request`, `http.request`, `experimental.ws.handshake` e `experimental.ws.send`.
Essas fronteiras do SDK incluem requisições primárias, geração, título e compactação;
cobrem também comandos que geram prompts, como a ponte `/code-review`, e subagentes.
A fonte vem do provedor/canal: `openai` = ChatGPT, `anthropic` = API Anthropic,
`google/antigravity-*` = Antigravity, `openrouter` = OpenRouter. Fonte desconhecida
com qualquer trava ativa é recusada. Isso não verifica autenticação nem presume que
provedores personalizados compartilham uma assinatura.

A trava não troca modelo/canal/esforço da rota. Outra fonte autorizada exige nova tentativa
compatível com a capacidade/piso. Requisições já enviadas não são canceladas retroativamente.
A proteção depende do plugin ativo e dos hooks do SDK; ferramentas externas que não passam
pelo gêmeo nem pelos scripts protegidos não são interceptadas por este mod.

Depois de instalar esta versão, recarregue o plugin/OpenCode. Mudanças subsequentes no estado
são relidas sem reiniciar. Validação offline: 40 testes do gêmeo, sem inferência real, incluindo
requisições diretas, fontes distintas, estado quebrado, mensagem, cpa, hooks HTTP/WebSocket e
comando local, além de CLI PowerShell real em arquivo temporário. O servidor nos testes é simulado; não comprovam comportamento do backend remoto.

No SDK instalado, os hooks de requisição acima exigem `model: Model.Ref` e
`kind: primary | compaction | title | generate`; não são interceptadores HTTP genéricos
para OAuth/telemetria. Já `session.get()` pode omitir uma seleção herdada: nesse caso, o
preparo aguarda a guarda obrigatória da requisição com o modelo efetivo, sem adivinhar a fonte.
Erros do comando `/fontes` são mostrados como texto local, sem retomar inferência. A API de
comandos deste SDK não informa origem humana: liberar apenas por pedido do usuário é uma regra
operacional, sem alegação de bloqueio mecânico equivalente ao `composer` do Claude.
O teste CLI real é integração opcional: informa skip se Windows/skill externa não estiverem
instalados; os demais testes continuam offline.

A busca da CLI usa `~/.agents/skills/dupla/scripts/fontes.ps1` e, na ausência, a reserva
`~/.claude/skills/dupla/scripts/fontes.ps1`. No SDK `@opencode/plugin` instalado, arquivo
`dist/promise/session.d.ts`, `SessionModelRequest`, `SessionHttpRequest`,
`SessionWebSocketHandshake` e `SessionWebSocketSend` exigem `model: Model.Ref` e `kind`.
A documentação do handshake diz “Runs once per model call”; são fronteiras de chamada,
não cada fragmento de uma resposta transmitida. Não há cache da trava nessas fronteiras.


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
