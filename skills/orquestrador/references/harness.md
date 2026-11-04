# Aplicação da política por harness

Claude Code, OpenCode e Codex são ambientes de trabalho; agy é motor (usuário, 31/10/2026).
O OpenCode também fornece o CLI usado pelos scripts da dupla.

Fonte comum: `../politica-modelos.json`. Antes de tarefa nova, a orquestradora julga a capacidade
N1/N2/N3, o risco e o esforço, sem classificar o texto por palavras-chave. Mantém os três no brief.
Uma falha que exige escalada inicia nova tentativa; não muda o modelo no meio da fatia.

| Harness | Aplicação disponível | Limite |
|---|---|---|
| Claude Code Desktop | Mod `orquestra`, ferramenta `rotear_tarefa`: prepara modelo/esforço para o próximo turno principal e suas continuações sem texto novo. Filhas recebem modelo/esforço no despacho | Uma nova mensagem encerra a rota anterior e permite reclassificar. O pedido não altera a resposta já em curso nem o seletor global; consulte pedido, estado e aplicação pela ferramenta |
| OpenCode Desktop | Plugin `gemeo`: `rotear_tarefa` prepara a rota; `start_session`/`spawn_task` aplica e confirma modelo/variante antes do primeiro prompt | Sessão existente não muda automaticamente: não há troca atômica que exclua corrida com steering. Use execução isolada pela dupla; criação de chat só conforme autorização e contrato do harness |
| Codex no app OpenAI | Skills comuns em `~/.agents/skills` e instrução global. Delegação nativa recebe modelo e esforço explícitos, com contexto novo quando exigido pelo contrato da ferramenta | Não há setter da sessão principal nas ferramentas atuais. Preserve-a; não simule troca nem abra chats de sidebar para contornar isso |

Os scripts `dupla/scripts/despachar.ps1` e `revisar.ps1` funcionam como motor a partir dos três
harness. O executor recebe `-CapacidadeMinima N1|N2|N3`; uma reserva leva a mesma capacidade.
Modelo resolvido abaixo do piso é recusado antes do prompt. Sem capacidade explícita,
`-Nivel dificil` adota N3 em qualquer executor (Sol ou Opus), conservando o piso ao trocar a fonte.
Para uma tarefa N2 que só precisa de mais esforço, passe `-CapacidadeMinima N2 -Nivel dificil`:
Terra medium continua N2 e não substitui Sol ou Opus quando a fatia exige N3. Astra, Fable e Argon
ficam reservados à revisão (usuário, 2026-11-03).

N1 e N2 começam em low e escalam a medium; N3 começa em medium e escala a high. Na revisão, Astra,
Fable e Argon usam low em L1 e medium em L2 ou no topo. Economia não reduz esses pisos. Não omita
esforço indisponível: registre a falha e use outra fonte autorizada adequada.

## Antigravity no OpenCode

O catálogo local de 31/10/2026 tem `opencode-antigravity-auth` 2.1.2 ativo e 14 modelos
`google/antigravity-*`. A IA escolhe o canal conforme a tarefa e os recursos disponíveis: no
despacho do `gemeo`, `canal: "antigravity"` seleciona esse caminho; omissão usa `nativo`.
Por exemplo, N2/Sonnet/low resolve um ID como `google/antigravity-claude-sonnet-5-5-low`.
O esforço está no ID, sem `variant`; confirme o identificador completo antes do primeiro prompt.

Família e canal são separados: Claude via Google continua Claude para revisão cruzada. Trocar
o canal não comprova uma cota independente. Opus/Sonnet sem xhigh nesse catálogo não atendem
uma rota que o exija. Flash-Lite (`antigravity-gemini-3.5-flash-lite`, sem sufixo) é N1 e só
atende o piso low; GPT-OSS não recebe classe. Canal também fica fixo na fatia; reserva exige nova tentativa.
Essa seleção pertence ao adaptador `gemeo`; os scripts isolados da dupla conservam os canais já
testados, incluindo Gemini pelo agy. Não copie a configuração pessoal para habilitar outro canal.

Inventário observado com `opencode models`: Anthropic 20, Google/Antigravity 14, OpenAI 18,
Ollama 3, OpenCode 2 e OpenRouter 351. Presença no catálogo não prova cota, autorização para
usar uma fonte paga nem inferência bem-sucedida. `opencode service status` confirmou o servidor
local ativo; `opencode mcp list` não encontrou MCPs configurados nos contextos mods e exemplo.
`GET /api/plugin` confirmou 96 plugins ativos, incluindo `gemeo`, `ai-memory-opencode2`,
`segredos` e `opencode-antigravity-auth`; o estado fica em `data[].state.status`.

## Conferência e instalação

Registre modelo/esforço pedidos e observados separadamente. `<Saida>.nivel.json` registra seleção
e capacidade; `<Saida>.modelo` registra a observação, inclusive `não informado`. Isso não prova
sozinho a conclusão: a autora confere o diff, testes e parecer. `<Saida>.rota.json` inclui chamada,
hash do pacote, família real e veredito; `revisado` significa parecer recebido, não etapa liberada.

Instalação das skills no Codex (idempotente, sem sobrescrever diretório existente):

```powershell
& .\instalar.ps1 -Cliente codex
```

Os mods já instalados carregam o código atualizado ao iniciar um novo runtime/sessão. Não reinicie
aplicativo ou serviço com sessões trabalhando. Skill e instrução persistente orientam a escolha;
só o código do adaptador aplica a troca permitida pelo harness. A disponibilidade no runtime atual
precisa ser confirmada, sem confundir arquivo instalado com ferramenta já carregada.
