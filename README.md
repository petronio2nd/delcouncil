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

## Estado e limites (leia antes de adotar)

- **Origem:** extraído do uso diário do autor, em Windows, com Claude Code (app desktop), OpenCode, agy (Antigravity) e Codex. Os nomes de famílias de modelos (Haiku, Sonnet, Opus, Fable; Luna, Terra, Sol, Astra; Flash-Lite, Flash, Argon) são os do ambiente do autor em novembro de 2026. **Troque-os pelos que você tem** em `skills/orquestrador/politica-modelos.json`.
- **Windows primeiro.** Os scripts são PowerShell 5.1 e foram testados nele. PowerShell 7 e Linux/macOS **não foram testados**: é uma boa contribuição.
- **Mods dependem de APIs que mudam.** `orquestra` usa a API de mods do Claude Code (testado no runtime 2.1.309 do Desktop); `gemeo` usa a API de plugins do OpenCode V2.
- As skills guardam decisões do autor com data (`usuário, 2026-10-19: ...`). São o histórico do porquê de cada regra: mude a regra se o seu uso pedir.
- Os testes são parte do repositório (`skills/dupla/scripts/testar-*.ps1`, `mods/*/**/*.test.ts`). Rode-os depois de mudar a política.

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
