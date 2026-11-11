# Instalação

Guia para pôr o delcouncil em **outro usuário ou outro computador**. Tempo típico: 15 a 30 minutos, mais o tempo de ajustar a política ao que você assina.

## 1. Pré-requisitos

| Item | Para quê | Obrigatório |
|---|---|---|
| Windows 10/11 com **PowerShell 5.1** | os scripts da `dupla` | sim |
| **git** | clonar; a revisão usa o diff | sim |
| **Claude Code** (CLI ou app desktop) | skills e o mod `orquestra` | sim (o método nasceu nele) |
| **OpenCode** (com `opencode-cli`) | executor e revisor de outras famílias; plugin `gemeo` | recomendado |
| **agy** (Google Antigravity CLI) | executor/revisor Gemini | opcional |
| **Codex** (app OpenAI) | outro ambiente de trabalho que lê as skills | opcional |
| **Node.js** recente (executa `.ts` direto) | rodar os testes dos mods | só para testar |
| **ai-memory** | memória longa; o revisor pode consultá-la | opcional |

PowerShell 7, Linux e macOS: **não testados**. Se você os usar, abra uma issue de adaptação com o que mudou.

## 2. Clonar e ligar as skills

```powershell
git clone https://github.com/petronio2nd/delcouncil.git
cd delcouncil
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

O `instalar.ps1`:

- liga `orquestrador`, `dupla` e `revisor` por **junction** (sem administrador) em `~/.agents/skills` (pasta comum) e em `~/.claude/skills` (reserva); com `-Cliente codex`, também em `~/.codex/skills`;
- **não sobrescreve** pasta que já exista; diz o que encontrou;
- confere pré-requisitos e roda `fontes.ps1` para provar que a trava responde;
- **não altera** `settings.json`, `opencode.json` nem seus arquivos de instruções: imprime os passos de 3 a 5 para você aplicar.

Opções: `-Copiar` (copia em vez de junction, para não seguir `git pull`), `-Casa <pasta>` (instala em outra "home", útil para testar), `-SomenteVerificar`.

Abra uma **sessão nova** do agente depois de ligar as skills.

## 3. Ajustar a política ao que você assina

Edite [`skills/orquestrador/politica-modelos.json`](../skills/orquestrador/politica-modelos.json):

- `capacidades.N1/N2/N3.familias`: as famílias que **você** tem para cada nível (ex.: só Claude: `haiku`, `sonnet`, `opus`);
- `revisao.familias`: modelos **de outra família que os de execução** e N3 (se você só tem Claude, a revisão cruzada não existe: use uma segunda família, mesmo que por OpenRouter, ou aceite só o `/code-review`);
- esforços e `revisao.L1/L2` (`low`/`medium`/`high`);
- `limites`: rodadas cruzadas por fatia (padrão 2), tentativas por família.

Os scripts têm valores do plano do autor que você deve rever:

| Arquivo | O que ajustar |
|---|---|
| `skills/dupla/scripts/recursos.ps1`, `opencode_custo.py` | orçamento mensal de API (US$ 100 no original), janelas de cota |
| `skills/dupla/scripts/politica-modelos.ps1` | mapa família → id/provedor nos CLIs que você usa |
| `skills/dupla/scripts/despachar.ps1`, `revisar.ps1` | executores, canais e a porta do `ai-memory` (`127.0.0.1:19374`), que é opcional |

Depois de qualquer mudança, rode as suítes (seção 6).

## 4. Mod `orquestra` (Claude Code)

Põe a pasta no `CLAUDE_CODE_PLUGIN_DIRS` do `~/.claude/settings.json` (separador `;`, junto com outros mods se houver):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\caminho\\delcouncil\\mods\\orquestra" } }
```

Ou, para experimentar numa sessão só:

```powershell
claude --plugin-dir "C:\caminho\delcouncil\mods\orquestra"
```

Reinicie a sessão. Confira com `/orquestra` (abre o painel) e `/orquestra fontes`. A ferramenta `rotear_tarefa` aparece como `mcp__orquestra__rotear_tarefa`.

> Se a política muda para uma versão que o mod carregado não entende, o `rotear_tarefa` **recusa** ("política inválida") até a sessão ser recarregada. É o comportamento seguro.

### 4.1 Mods de conversa e medidores (opcionais)

Independentes do método: dão ao Claude Code o jeito de conversar do autor. Ligue os que quiser no mesmo `CLAUDE_CODE_PLUGIN_DIRS`, um caminho por mod, separados por `;`:

| Mod | O que faz | Precisa de |
|---|---|---|
| `status-nome` | Troca o emoji do nome da sessão sozinho: ⚙️ quando o turno começa, 🧠 quando o Claude pergunta ou pede aprovação, e no fim o nome que o Claude deu | app desktop; a seção "Nome da sessão" do exemplo de instruções |
| `responder` | Lê os itens numerados da seção **Sua vez** da última resposta e mostra um campo para cada um, com **sim**/**não** nos itens 👍 e **rodei** nos ▶️; `/responder` abre e fecha | a seção "Mensagem final" do exemplo de instruções |
| `session-band` | Faixa com turno, velocidade, custo, contagem do cache de 1 h, contexto e anéis de 5h e semana; avisa antes de o cache esfriar. `/session_data` mostra ou esconde | o aviso do sistema é só no macOS; no Windows a faixa funciona |
| `medidor` | Linha de status com 5h, semana, contexto e cache, cada um com 🟢🟡🔴, e quanto falta para 5h e semana zerarem | escolha este **ou** o `session-band`: fazem o mesmo papel |
| `portugues` | Põe "responda em português do Brasil" em todo turno e no resumo do `/compact` | Claude Code 2.1.293 ou mais novo |
| `segredos` | Recusa Read, Grep e `cat`/`Get-Content` de `.env*`, `id_*`, `*.pem`, `*.key`, `*recovery-key*`, `credentials*` | limite: uma busca na pasta inteira, sem nomear o arquivo, ainda pode trazer linha de um `.env` |
| `aguardar` | "não execute", "só aguarde", "me aguarde" travam as ferramentas que mudam algo; "pode seguir", "vamos começar", "está liberado" ou `/liberar` destravam | nada |

O nome da sessão também tem um **hook de Stop** (não é mod): `mods/nome-sessao/exigir-nome.py`. No app desktop, se a sessão nunca foi renomeada, ele segura o fim do turno uma vez e pede ao Claude que dê o nome. No `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "matcher": "", "hooks": [
        { "type": "command", "command": "python", "args": ["-I", "-X", "utf8", "C:\\caminho\\delcouncil\\mods\\nome-sessao\\exigir-nome.py"] }
      ] }
    ]
  }
}
```

Testes: `claude plugin test <mod>` na pasta `mods` (o `session-band` não tem suíte) e `python -I -X utf8 mods\nome-sessao\test_exigir_nome.py`.

> Os textos dos mods falam em "o usuário" e seguem as convenções do exemplo de instruções (emojis da **Sua vez**, nome da sessão). Se você mudar as convenções, mude os dois juntos.

## 5. Plugin `gemeo` (OpenCode)

No `~/.config/opencode/opencode.json`:

```json
{ "plugins": ["C:/caminho/delcouncil/mods/gemeo"] }
```

Para o canal Antigravity você também precisa do plugin de login `opencode-antigravity-auth` (de terceiros, ver [CREDITOS.md](../CREDITOS.md)); o `gemeo` não o inclui. Confira a carga com:

```powershell
& "$env:LOCALAPPDATA\Programs\@opencodedesktop\resources\opencode-cli.exe" api get /api/plugin
```

(`data[].id` = `gemeo`, `state.status` = `active`.) O caminho do `opencode-cli` varia com a instalação.

## 6. Conferir

```powershell
# política e trava
powershell -NoProfile -ExecutionPolicy Bypass -File skills\dupla\scripts\testar-politica-modelos.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File skills\dupla\scripts\testar-fontes.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File skills\dupla\scripts\testar-reservas-revisao.ps1   # exige repositório git com ao menos um commit

# plugin do OpenCode
cd mods\gemeo
node --test rota.test.ts integracao.test.ts fontes-cli.test.ts

# plugin do Claude Code (na pasta mods)
claude plugin test orquestra
```

Cada suíte imprime "N casos ... OK" (ou "N tests, pass N"). Os números exatos mudam com a versão; o que importa é **zero falhas**.

## 7. Instruções globais (recomendado)

As skills assumem algumas regras no seu `CLAUDE.md` (Claude Code) ou `AGENTS.md` (Codex/OpenCode): consultar a trava antes de chamar outro modelo, julgar N1/N2/N3 antes de despachar, o que é do dono. Há um trecho pronto e genérico em [`exemplos/instrucoes-globais.md`](../exemplos/instrucoes-globais.md). Cole o que fizer sentido; não é instalado automaticamente.

## 8. Novo computador ou novo usuário

O que **não** vai junto no `git clone`, por ser estado da máquina:

| Estado | Onde | Ação |
|---|---|---|
| Travas de fonte | `%USERPROFILE%\.local\share\dupla\fontes.json` | recomece liberado e trave o que quiser; **não copie** entre máquinas |
| Histórico de cotas e custo | `%TEMP%`/arquivos de `recursos.ps1` | recomeça sozinho |
| Logins (Claude, OpenCode, agy, ChatGPT) | cada CLI | faça login em cada um |
| `STATUS.md` | raiz de **cada projeto seu** | nasce quando a `dupla` roda no projeto |

Checklist: clonar → `instalar.ps1` → ajustar política → ligar mods → `fontes.ps1` lista as 5 fontes → suítes verdes → sessão nova.

## 9. Atualizar

Com junction, basta `git pull` na pasta clonada. Com `-Copiar`, rode `instalar.ps1 -Copiar` de novo (ele avisa e não sobrescreve; apague a cópia antiga antes). Depois de atualizar a política, recarregue as sessões.

## 10. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Controle de fontes indisponivel; consumo bloqueado` | `fontes-comum.ps1` não encontrado ou estado ilegível; **não** apague o `.lock`: corrija o estado pelo `fontes.ps1` |
| `rotear_tarefa`: "política inválida" | mod carregado é mais antigo que a política; recarregue a sessão |
| Teste de reservas falha com `FileNotFound` | rodado fora de um repositório git com commit |
| Um caso falha só no Git Bash | o `chcp 65001` do `.cmd` muda a página de código do console compartilhado; rode pelo PowerShell |
| Modelo ausente no catálogo | a família citada não existe na sua conta: ajuste `politica-modelos.json` |

Algo que não está aqui? Abra uma [issue](../../../issues).
