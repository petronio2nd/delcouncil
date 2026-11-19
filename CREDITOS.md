# Créditos e dependências

O mod [session-band](mods/session-band) adapta a versão 0.2.0 de [johnnyvizz/claude-kit](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/session-band), sob licença MIT. O mod inclui a [licença original](mods/session-band/LICENSE) e descreve as mudanças no seu README.

A skill [ub-mode](skills/ub-mode) adapta o trabalho de Robert C. Martin e inclui a [licença original](skills/ub-mode/LICENSE). As skills `sabatina`, `dev-debug` e `detector-repeticao` usam métodos do [acervo de Matt Pocock](https://github.com/mattpocock/skills). A esses materiais se aplica o texto da [licença MIT](LICENSE), com o aviso original “Copyright (c) 2026 Matt Pocock”.

| Projeto | Autor / mantenedor | Como o delcouncil usa | Licença |
|---|---|---|---|
| [Claude Code](https://claude.com/claude-code) | Anthropic | harness principal; o mod `orquestra` usa a API de mods (`claude-code`, `claude-code/testing`) | produto comercial (termos da Anthropic) |
| [OpenCode](https://github.com/anomalyco/opencode) | comunidade OpenCode (anomalyco / sst) | harness gêmeo, CLI usado pelos scripts da `dupla`, API de plugins usada pelo `gemeo` | MIT |
| [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) | NoeFabris | plugin de login Google/Antigravity do OpenCode; **dependência opcional**, não incluída | MIT |
| Antigravity / `agy` | Google | motor para modelos Gemini e Claude/GPT pela cota Google | produto comercial |
| Codex | OpenAI | outro ambiente que lê as skills; família GPT como executor/revisor | produto comercial |
| [OpenRouter](https://openrouter.ai) | OpenRouter | fonte opcional para árbitro, **travada por padrão no ambiente do autor** | serviço comercial |
| [ai-memory](https://github.com/akitaonrails/ai-memory) | akitaonrails | memória longa opcional que o revisor pode consultar | MIT |

Ideias e vocabulário:

- A escala **N1/N2/N3** é emprestada do suporte técnico de TI (níveis de atendimento).
- A revisão cruzada entre famílias de modelos é uma prática conhecida; aqui ela ganha níveis de risco, teto de rodadas e um árbitro.

Os nomes de modelos e produtos citados são marcas dos seus donos. Este repositório não é afiliado a nenhum deles.

Se você reconhece trecho seu aqui ou sabe de uma dependência que falta nesta lista, abra uma [issue](../../issues) ou um pull request: corrijo e dou o crédito.
