# Codex — modelo e contexto

Use esta referência somente no Codex Desktop ou CLI.

## Modelo por fatia

Escolha modelo e raciocínio antes da primeira mensagem da tarefa. Se os nomes mudarem,
use o equivalente atual com o mesmo perfil.

| Trabalho | Seleção recomendada |
|---|---|
| Inventário, catalogação, extração e buscas delimitadas | Terra Medium ou equivalente econômico |
| Documentação, manutenção do método e revisão normal | Sol Medium |
| Parecer, confronto de hipóteses, contradições e conclusão | Sol High |

Não use Sol High como padrão universal. Não troque modelo no meio da fatia apenas para
economizar; escolha outra tarefa para o próximo tipo de trabalho. Eleve acima de High
somente quando a dificuldade observada justificar o custo.

## Controles de contexto

No Codex Desktop:

- `/status`: mostra uso de contexto e limites, sem a decomposição detalhada do Claude;
- `/compact`: compacta a tarefa atual;
- **Nova tarefa**: começa com transcrição limpa no mesmo projeto;
- `/fork` ou fork a partir de mensagem anterior: preserva um ramo alternativo;
- `/mcp` e tela **Plugins**: inspecionam integrações.

No Codex CLI, use `/status`, `/usage`, `/compact`, `/clear` ou `/new`, `/fork`, `/mcp`
e `/plugins`. Não use `/clean` para limpar contexto: no CLI ele encerra terminais em
segundo plano.

Convenção operacional:

- mesma fatia, pausa natural perto de metade da janela: confira o `CURRENT.md` e use
  `/compact`;
- nova fatia, assunto diferente ou retomada posterior: abra nova tarefa e retome pelos
  dois `CURRENT.md`;
- caminho abandonado: faça fork do ponto útil ou abra nova tarefa.

Use metade da janela como referência operacional para planejar a retomada.

Não copie comandos do Claude nem um bloco longo de compactação para `AGENTS.md`. As
decisões duráveis pertencem ao `CURRENT.md` e aos registros estruturados do caso.
