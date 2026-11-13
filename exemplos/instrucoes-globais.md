# Instruções globais: trecho para o seu CLAUDE.md / AGENTS.md

Cole o que fizer sentido. Troque `<você>` pelo seu nome, `<repositórios>` e `<dados>` pelos caminhos das suas duas pastas ([instalação, 1.1](../docs/instalacao.md#11-duas-pastas-repositórios-e-dados)) e ajuste os demais caminhos. Este trecho é genérico; o texto completo das regras mora nas skills.

```markdown
## Onde mora cada coisa

- **Código** → `<repositórios>\<repo>`: só repositórios git, um por subpasta.
- **Dados** → `<dados>\<área>`: documentos, relatórios, planilhas e análises, uma subpasta por área.
  Nada daqui vai para o git.
- No começo da sessão, se a pasta aberta não é a do pedido (ou a sessão abriu sem pasta), mova a
  sessão para a pasta certa antes de agir e diga em uma linha de onde para onde: mexer em código →
  `<repositórios>\<repo>`; ler, decidir ou gerar documento → `<dados>\<área>`. Não crie pasta nova
  sem pedido de <você>.

## Agentes: orquestração e revisão

- **Chaves globais de consumo.** Antes de chamar outro modelo, abrir sessão filha, usar subagente
  ou tentar uma reserva, consulte `~/.agents/skills/dupla/scripts/fontes.ps1`. Fonte travada fica
  fora de tudo, inclusive chamadas diretas e consultas que enviam prompt. Só pedido explícito de
  <você> libera. Avise com ⚠️ (ex.: "⚠️ Assinatura Claude travada") e use outra fonte já autorizada
  mantendo capacidade, esforço e revisão; sem alternativa, registre a etapa pendente. Estado
  ilegível não libera consumo. Nunca edite o estado para contornar a trava.
- **N1/N2/N3.** Antes de tarefa nova ou despacho, julgue a capacidade pela skill `orquestrador`
  e sua `politica-modelos.json`. Capacidade e esforço são dimensões separadas; economia não reduz
  o piso de nenhuma. Registre com `rotear_tarefa` (fatia, nível, família, papel, motivo). Não
  classifique por palavra do prompt. Modelo e esforço ficam fixos na fatia; escalada exige nova
  tentativa.
- **Decida sozinho, sem perguntar:** orquestrar ou não, abrir filha e em que modelo, despachar a
  executores ou reservas, mandar à revisão cruzada e em que nível, usar subagentes. Diga em uma
  linha o que decidiu e siga.
- **Com <você> ficam só duas coisas:** o produto (o que a coisa deve fazer, regra de negócio, dado
  que só <você> tem) e a ação fora do repositório (mensagem, dinheiro, produção, apagar fora do
  git, conta, credencial).
- **Produto ou ferramenta nova:** antes da primeira fatia, <você> usa a coisa por uns 20 minutos
  (seção 0 do `orquestrador`). Nada de plano revisado, conversor ou script antes do veredito.
- **Revisão por outra família, não por harness.** O revisor é de família diferente da do autor e
  nunca abaixo dele; o nível (L0/L1/L2) segue o risco da entrega (skill `dupla`, seção 0).
  `/code-review` no diff quando há código, como camada a mais: `low` no comum, `medium` em risco
  elevado; texto sem código dispensa.
- **STATUS.md** na raiz do projeto é o quadro que as sessões dividem. Se existir, leia no começo
  da sessão e atualize ao fim de cada etapa concluída; só a orquestradora escreve nele.

## Git

- Commit e push ao fim de cada etapa conferida (testes passando, revisão feita quando a skill
  `dupla` manda). Só os seus arquivos, listados por caminho no `git add` (nunca `-A`). Nada
  pessoal nem segredo no git. Push que dispara deploy em produção espera o OK de <você>.

## Nome da sessão (app desktop; mods `status-nome` e `nome-sessao`)

- <você> toca várias sessões ao mesmo tempo. Renomeie a própria sessão com `set_session_title`
  (`session_id: "self"`, carregada via ToolSearch) ao fim de cada resposta em que o estado mudou, e
  com ⚙️ no começo de um trabalho de mais de uns 2 minutos.
- Formato: um emoji + espaço + texto em minúsculas, até 26 caracteres: `<assunto>: <ação ou resultado>`.
  Se é a vez de <você>, a ação que vem primeiro; se terminou, o resultado.
- Quando é a vez de <você>, o emoji diz o que espera (o 🔥 vale mais que os outros):
  - 🔥 prazo em até 2 dias, com a data no texto: `🔥 relatório 28/09: revisar`
  - 👍 só um OK a uma recomendação (sim ou não): `👍 ok p/ trocar a lib`
  - ▶️ algo que só <você> pode rodar ou fazer (comando, clique, login): `▶️ deploy: rodar script`
  - 📨 mandar mensagem a alguém, com o texto pronto: `📨 fornecedor: 3 perguntas`
  - 📖 ler ou revisar o que foi preparado: `📖 revisar o relatório`
  - 🧠 decidir ou responder o que só <você> sabe: `🧠 qual banco usar`
  - 💤 pausada por <você>: `💤 site: parou no menu`
- Quando não é a vez de <você>: ⚙️ trabalhando; 🤝 depende de outra pessoa, com o nome e o dia
  (`🤝 ana 10/10: acesso`); ✅ concluída, mas vale deixar aberta; 🗄️ pode ser arquivada.

## Mensagem final

Monte a mensagem final de cada resposta nesta ordem:

1. Primeira linha: o emoji do nome da sessão e, em uma frase, o essencial.
2. Os detalhes: o que foi feito e achado, em até 5 itens, com link para os arquivos.
3. Uma linha `---` e, por último, `**🔔 Sua vez 🔔**`, só quando algo depende de <você>: numerada na
   ordem de fazer, um item por linha, cada um começando pelo emoji do tipo (🔥 👍 ▶️ 📨 📖 🧠).
   - 👍 é sempre uma pergunta de sim ou não, com a recomendação na pergunta e a alternativa entre
     parênteses: `👍 vou com a lib X? (não = Y)`. Escolha sem recomendação é 🧠.
   - ▶️ traz o comando pronto e onde rodar; antes, veja se não dá para você mesmo fazer.
   - 📨 traz para quem e o texto pronto para colar; 📖 o link do que ler; 🧠 a pergunta, curta.
   - Aviso que muda a ação (apaga, grava em produção) vai dentro do item, com ⚠️.
   - A **Sua vez** fecha a mensagem: nada depois dela.
4. Quando nada depende de <você> (✅, 🗄️, ⚙️), não há **Sua vez**.
```

> Estas linhas são a versão genérica das regras do autor. Se você preferir que o agente **pergunte** antes de commitar ou de despachar, troque os trechos "decida sozinho" e "commit e push" pela sua preferência: o método funciona com as duas.
