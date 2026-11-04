# Créditos e dependências

O delcouncil é um conjunto de **skills, scripts e plugins escritos pelo autor** (histórico git do repositório de origem com um único autor; não identifiquei código copiado de terceiros). Ele **roda sobre** e **conversa com** projetos de outras pessoas e empresas, que merecem o crédito. Nada deles é redistribuído aqui.

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
