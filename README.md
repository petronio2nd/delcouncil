# delcouncil

**Um método para orquestrar agentes de IA por capacidade (N1/N2/N3), com revisão cruzada entre famílias de modelos, trava global de consumo e um orquestrador que decide, despacha e confere.**

> English summary at the [bottom](#english-summary).

Em vez de pôr o modelo mais forte em tudo, o `delcouncil` separa quatro perguntas que costumam vir misturadas:

| Pergunta | Resposta no método |
|---|---|
| **Que capacidade a tarefa exige?** | N1 (simples), N2 (comum) ou N3 (difícil) |
| **Quanto esforço de raciocínio?** | `low`, `medium` ou `high`, fixo na fatia; sobe só em nova tentativa depois de falha real |
| **Que risco a entrega traz?** | L0, L1 ou L2, que decide se, quem e com que esforço revisa |
| **Quem pode gastar o quê?** | trava global por fonte de consumo: assinatura, API, créditos |

A revisão é feita por um modelo de **outra família** que o autor (Claude, GPT, Gemini), somente leitura, e nunca abaixo dele em capacidade. As regras de quem revisa, quantas rodadas e em que nível estão num único arquivo de política, `politica-modelos.json`, que os scripts e os plugins leem.

## O que tem aqui

| Pasta | O que é |
|---|---|
| [`skills/orquestrador`](skills/orquestrador) | Skill da sessão que recebe o pedido: fatia o trabalho, escolhe nível e executor, confere e registra |
| [`skills/dupla`](skills/dupla) | Skill e scripts PowerShell: revisão cruzada, reservas por falta de cota, executores (agy, OpenCode) e a **trava de fontes** |
| [`skills/revisor`](skills/revisor) | Papel do revisor: só lê, devolve achados com severidade e evidência |
| [`skills/1-simulador`](skills/1-simulador) | Questiona pressupostos, identifica riscos e testa uma decisão antes do compromisso |
| [`skills/2-destilador`](skills/2-destilador) | Organiza notas e transcrições em temas, decisões e questões em aberto |
| [`skills/3-protocolo`](skills/3-protocolo) | Transforma decisões tomadas em procedimentos e checklists executáveis |
| [`skills/4-intencao`](skills/4-intencao) | Interpreta a intenção de uma mensagem e ajuda a comunicá-la ao destinatário |
| [`skills/sabatina`](skills/sabatina) | Conduz uma entrevista curta para acertar escopo e critérios de aceite antes de construir |
| [`skills/dev-debug`](skills/dev-debug) | Investiga a causa de um defeito com hipóteses verificáveis e uma reprodução mínima |
| [`skills/ub-mode`](skills/ub-mode) | Orienta mudanças de código com um teste que reproduz o problema e comprova a correção |
| [`skills/esforco`](skills/esforco) | Consulta e ajusta os pisos de esforço usados na execução e na revisão |
| [`skills/validar-metas`](skills/validar-metas) | Verifica se uma meta tem medida, prazo e critério de sucesso |
| [`skills/status-report`](skills/status-report) | Gera versões técnica, gerencial e executiva de um relatório a partir dos mesmos dados |
| [`skills/iniciar-analise`](skills/iniciar-analise) | Organiza análises documentais longas com checkpoints, fontes e limites de cobertura |
| [`skills/agendar-retomada`](skills/agendar-retomada) | Prepara o contexto e o primeiro passo para retomar uma conversa em outra sessão |
| [`skills/ata-reuniao`](skills/ata-reuniao) | Extrai decisões e compromissos de uma transcrição com responsáveis e prazos quando declarados |
| [`skills/detector-repeticao`](skills/detector-repeticao) | Identifica pedidos e correções recorrentes e propõe melhorias com exemplos |
| [`mods/orquestra`](mods/orquestra) | Mod do Claude Code: painel ao vivo das sessões e revisões, a ferramenta `rotear_tarefa`, aplicação da rota por fatia e a trava de fontes dentro do harness |
| [`mods/gemeo`](mods/gemeo) | Plugin do OpenCode: dá ao OpenCode as ferramentas do Claude Code com os mesmos nomes, aplica a rota e respeita a trava |
| [`mods/status-nome`](mods/status-nome) + [`mods/nome-sessao`](mods/nome-sessao) | O nome da sessão no app desktop diz onde ela parou: emoji do estado (⚙️ trabalhando, 🧠 espera você) trocado sozinho, e um hook que não deixa a sessão terminar sem nome |
| [`mods/session-band`](mods/session-band) | Faixa acima do prompt: turno, tok/s, custo, cache, contexto e os anéis de uso de **5h e da semana** (adaptado de johnnyvizz, MIT) |
| [`mods/medidor`](mods/medidor) | O mesmo em uma linha de status: `🟢 5h 14% · 🟡 sem 62% · 🟢 ctx 12% · 🟢 cache 42min · zera 3h10 / 4d`. Use este **ou** o session-band |
| [`mods/portugues`](mods/portugues) | Responde sempre em português do Brasil, inclusive depois do `/compact` |
| [`mods/segredos`](mods/segredos) | Recusa ler ou mostrar `.env*`, chaves (`id_*`, `*.pem`, `*.key`) e `credentials*`; usar e mover continua liberado |
| [`mods/aguardar`](mods/aguardar) | "Não execute" ou "só aguarde" travam o Claude em modo leitura até "pode seguir" (ou `/aguardar` e `/liberar`) |
| [`docs/metodo.md`](docs/metodo.md) | **O método explicado**: níveis, esforços, revisão, trava, orquestrador |
| [`docs/instalacao.md`](docs/instalacao.md) | **Instalação** em outro usuário e outro computador, e como adaptar à sua assinatura |
| [`exemplos/`](exemplos) | Trecho de instruções globais para o seu `CLAUDE.md` / `AGENTS.md`, inclusive o jeito de conversar (nome da sessão, mensagem final com **Sua vez**) |
| [`instalar.ps1`](instalar.ps1) | Liga as skills nas pastas dos agentes (junction, sem administrador) e confere o ambiente |

## Instalar em 5 minutos

```powershell
git clone https://github.com/petronio2nd/delcouncil.git
cd delcouncil
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

Depois siga o [guia de instalação](docs/instalacao.md): ligar os mods, ajustar a política ao que você assina e conferir a trava com `fontes.ps1`.

O instalador liga as três skills de orquestração. Para usar uma das 14 skills de método da tabela, copie a pasta dela de `skills/` para o diretório de skills do seu agente.

## Estado e limites (leia antes de adotar)

- **Origem:** extraído do uso diário do autor, em Windows, com Claude Code (app desktop), OpenCode, agy (Antigravity) e Codex. Os nomes de famílias de modelos (Haiku, Sonnet, Opus, Fable; Luna, Terra, Sol, Astra; Flash-Lite, Flash, Argon) são os do ambiente do autor em novembro de 2026. **Troque-os pelos que você tem** em `skills/orquestrador/politica-modelos.json`.
- **Windows primeiro.** Os scripts são PowerShell 5.1 e foram testados nele. PowerShell 7 e Linux/macOS **não foram testados**: é uma boa contribuição.
- **Mods dependem de APIs que mudam.** `orquestra` usa a API de mods do Claude Code (testado no runtime 2.1.309 do Desktop); `gemeo` usa a API de plugins do OpenCode V2.
- As skills guardam decisões do autor com data (`usuário, 2026-10-19: ...`). São o histórico do porquê de cada regra: mude a regra se o seu uso pedir.
- Os testes são parte do repositório (`skills/dupla/scripts/testar-*.ps1`, `mods/*/**/*.test.ts`). Rode-os depois de mudar a política.

## Projetos irmãos

- **[pepita-wa-pub](https://github.com/petronio2nd/pepita-wa-pub)**: extensão do Chrome e servidor local que exportam o WhatsApp Web para Markdown, com áudio transcrito e OCR, e um MCP (`whatsapp`) para o Claude Code e o OpenCode listarem, lerem e responderem conversas com aprovação. Instala em outro Windows pelo roteiro `docs/instalar-outro-computador.md` de lá. Repositório à parte porque automatiza o WhatsApp Web: leia o aviso de termos de uso no README dele.

## Achou uma falha? Tem uma ideia?

Abra uma [issue](../../issues): há modelos para **falha**, **melhoria** e **adaptação** (outro sistema, outros modelos). Veja o [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests são bem-vindos; mudança de política precisa vir com o teste.

## Créditos

Veja [CREDITOS.md](CREDITOS.md): o delcouncil roda sobre Claude Code, OpenCode, o plugin `opencode-antigravity-auth` e outros projetos de terceiros, todos citados lá.

## Licença

[MIT](LICENSE).

---

## English summary

**delcouncil** is a working method (plus skills, PowerShell scripts and two harness plugins) for orchestrating AI coding agents:

- **N1/N2/N3 capability tiers** (simple / common / hard), chosen per task slice; reasoning effort is a separate, fixed-per-slice dimension that escalates only on a real failed retry.
- **Cross-family review**: a model from a *different* family than the author reviews read-only, at a depth set by delivery risk (L0 none, L1 `low`, L2 `medium`), with a cap of two cross rounds per slice and an arbiter for disputes.
- **Global consumption lock** (`fontes.ps1`): per-source switches (subscription, API, credits) that no script, subagent or plugin may bypass; an unreadable state fails closed.
- **Orchestrator skill** that slices work, dispatches to cheaper executors or child sessions, verifies results and keeps a shared `STATUS.md`.
- One **policy file** (`politica-modelos.json`) read by every script and plugin.

Docs are in Brazilian Portuguese. English contributions to translate [`docs/metodo.md`](docs/metodo.md) are welcome. Model family names reflect the author's setup (Nov 2026): edit the policy to match yours. Tested on Windows PowerShell 5.1 only. Issues and pull requests welcome.
