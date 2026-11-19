---
name: esforco
description: Sobe ou desce o degrau de esforço da orquestração (pisos N1/N2/N3, revisão L1/L2 e /code-review) e mostra o perfil em vigor. Use quando o usuário digitar "/esforco" com sobe, desce, folga, economia ou status, ou pedir "sobe/desce o esforço", "baixa/aumenta os degraus", "qual o esforço em vigor". NÃO use para o esforço da própria sessão (seletor do app) nem para editar politica-modelos.json à mão.
---

# esforco: escada de esforço da orquestração

Use `-Status` para consultar o perfil. Para trocar o perfil local quando solicitado, use `-SemCommit`: a alteração passa pelos testes e fica disponível para o fluxo do repositório.

Comando no Windows PowerShell, com a instalação padrão: `powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\.agents\skills\orquestrador\scripts\esforcos.ps1" <flag>`

| Pedido | flag |
|---|---|
| `/esforco sobe` | `-Sobe -SemCommit` (um degrau acima: economia → folga) |
| `/esforco desce` | `-Desce -SemCommit` (um degrau abaixo) |
| `/esforco folga` ou `economia` | `-Perfil folga -SemCommit` / `-Perfil economia -SemCommit` |
| `/esforco` ou `status` | `-Status` |

- Nas pontas da escada o script diz "já está" e não muda nada. Perfil "personalizado" exige `-Perfil`.
- Teste que falha desfaz a troca; relate a falha com a saída.
- Ao terminar, mostre o perfil em vigor (N1/N2/N3, L1/L2, /code-review) em poucas linhas.
- Perfis ficam em `orquestrador/perfis-esforco.json`, em ordem de baixo para cima; degrau novo = chave nova ali. Nunca edite `politica-modelos.json` à mão.
- Isto não muda o esforço da sessão aberta (seletor do app) nem de sessões já despachadas: vale na próxima fatia.
