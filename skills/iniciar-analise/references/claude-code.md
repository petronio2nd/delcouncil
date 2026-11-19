# Claude Code e Cowork — modelo e contexto

Use esta referência somente no Claude Code ou Cowork.

## Modelo por fatia

O usuário deve escolher modelo e effort antes da primeira mensagem da sessão.

| Trabalho | Seleção recomendada |
|---|---|
| Inventário, catalogação, extração e cronologia | Sonnet, effort médio |
| Parecer, conclusão e confronto de hipóteses | Opus, effort alto, em sessão separada |

Evite trocar modelo ou effort dentro da mesma fatia. Se o catálogo mudar, use o modelo
atual de perfil equivalente em vez de perpetuar um nome obsoleto.

## Controles de contexto

- `/context`: examine o total e a composição antes de começar;
- `/compact`: compacte a mesma fatia em pausa natural;
- `/clear`: inicie contexto limpo para outra fatia ou retomada posterior;
- `/rewind`: volte ao ponto útil quando um caminho tiver sido abandonado;
- `/mcp` e `/plugin`: inspecione integrações e desligue apenas as que o caso não usa.

Se o contexto inicial já estiver alto, confira as instruções e integrações carregadas.

Convenção operacional:

- mesma fatia e pausa natural perto de metade da janela: atualize `CURRENT.md` e use
  `/compact`;
- nova fatia ou retomada posterior: use sessão nova e leia os dois `CURRENT.md`;
- caminho abandonado: `/rewind`, sem compactar o ramo descartado.

Mantenha instruções específicas de compactação no `CLAUDE.md` do caso.
