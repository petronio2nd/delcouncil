# Como contribuir

Obrigado por apontar falhas e melhorias. O repositório é novo e o método vem de uso real de um único autor: o que você encontrar ao adaptar para o seu ambiente vale ouro.

## Antes de abrir uma issue

- Leia [`docs/metodo.md`](docs/metodo.md) e [`docs/instalacao.md`](docs/instalacao.md) (a seção 10 lista problemas comuns).
- Rode a suíte que cobre a parte afetada e cole a saída:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File skills\dupla\scripts\testar-politica-modelos.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File skills\dupla\scripts\testar-fontes.ps1
cd mods\gemeo; node --test rota.test.ts integracao.test.ts fontes-cli.test.ts
```

## Tipos de issue

- **Falha:** algo se comporta diferente do documentado. Traga versão do PowerShell, do agente e o comando exato.
- **Melhoria:** regra, nível ou fluxo que você mudaria, com o **porquê** (qual custo ou erro evitaria).
- **Adaptação:** funciona (ou não) em outro sistema, outro conjunto de modelos ou outro harness. Diga o que mudou.

## Pull requests

- Mudança de **política** (`politica-modelos.json`) ou de **trava** precisa vir com teste que falha antes e passa depois.
- Mantenha as skills e os scripts **sem dado pessoal, caminho da sua máquina ou segredo**. Use `$HOME`, `<pasta do projeto>` e placeholders.
- Um assunto por PR. Descreva o que testou e o que **não** testou (ex.: "só PowerShell 5.1").
- Texto em português do Brasil; traduções para inglês são bem-vindas em arquivo à parte (`docs/en/`).

## Segurança

A **trava de fontes falha fechada** de propósito: estado ilegível bloqueia o consumo. Se achar um jeito de contornar a trava, de fazer o revisor escrever, ou de vazar segredo para o pacote de revisão, **não publique o exploit numa issue pública**: abra uma [advisory privada](../../security/advisories/new) do GitHub.

## Conduta

Seja gentil e específico. Crítica ao método é o ponto: traga evidência.
