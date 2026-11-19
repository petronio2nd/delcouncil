---
name: sabatina
description: "Sabatina antes de construir. Entrevista o usuário em rodadas curtas até haver um entendimento comum do que fazer, antes da primeira linha de código, do plano ou da primeira fatia. Monta a árvore de decisões, pergunta só o que é do usuário (produto, regra de negócio, dado que só ele tem), já com a resposta recomendada e redigida para o \"sim\" aceitar, e busca os fatos disponíveis, delegando a pesquisa quando houver subagentes. Termina num acordo curto que o usuário confirma. Use quando o usuário pedir \"me sabatina\", \"me entrevista\", \"faz as perguntas antes\", \"alinha comigo antes de fazer\", \"grill me\", ou, sem ele pedir, quando o pedido for construir algo novo (skill, ferramenta, mod, fatia, mudança de comportamento) e o que ele quer ainda tiver lacunas que mudam o resultado. NÃO use para estressar uma decisão já formulada (1-simulador), para organizar notas (2-destilador), para transformar decisão tomada em passo a passo (3-protocolo) nem quando o pedido já está claro (faça direto)."
---

# Sabatina: alinhar antes de construir

O erro mais caro não é bug: é construir a coisa errada. A sabatina fecha a distância entre o que o usuário
quer e o que o agente entendeu antes de qualquer trabalho, perguntando em rodadas até não sobrar nada
assumido em silêncio. Adaptada da skill `grilling` de Matt Pocock (github.com/mattpocock/skills, MIT).

Ao delegar, aplique a política comum do `orquestrador/politica-modelos.json`: informe
capacidade e esforço no despacho. Leitura simples começa em N1 low; interpretação pode exigir N2.
Use as ferramentas reais do harness; reserva conserva a capacidade e fonte não lida fica não conferida.

## 1. Onde ela entra

- Antes da primeira fatia do `orquestrador` ou de uma construção de porte feita diretamente.
- Para avaliar uma ferramenta existente, comece pelo uso. Use a sabatina depois se houver uma adaptação a definir.
- Para pedidos claros ou pequenos, prossiga. Se restar uma dúvida pontual, pergunte diretamente.

## 2. O que é do usuário e o que é seu

- **Decisão de produto vai ao usuário:** o que a coisa faz, o que fica e o que sai, regra de negócio, dado
  que só ele tem, preferência de uso.
- **Busque os fatos disponíveis.** Consulte o código, os arquivos do projeto e as fontes autorizadas. Quando houver delegação disponível, peça a pesquisa a um subagente e avance com as perguntas que já puder fazer. Mantenha pendentes as perguntas que dependem de uma evidência ainda não consultada. Siga o `orquestrador` ao escolher a capacidade, o esforço e as reservas.
- **Dado que só outra pessoa tem vira questionário** (do `to-questionnaire` de Matt Pocock). Se a informação depender de alguém de fora, confirme o destinatário e o que o usuário precisa obter. Abra com o propósito e use uma pergunta por ideia, da mais importante à menos urgente. Explique o motivo onde a pergunta puder ser mal lida. Aceite “não sei” e encerre perguntando se algo ficou de fora. Cubra as dúvidas pendentes e mantenha as decisões dependentes em aberto até a resposta chegar. O envio depende de autorização para o texto e o destinatário.
- **Decisão técnica é sua** (linguagem, onde mora o arquivo, nome de função, formato interno). Decida,
  diga em uma linha no acordo final e siga. Só vira pergunta quando muda o que o usuário vê ou usa.

## 3. A árvore e as rodadas

Monte a **árvore de decisões**: cada decisão abre as que dependem dela. A **fronteira** é o conjunto de
decisões cujos pré-requisitos já estão resolvidos, ou seja, o que dá para perguntar agora sem chutar
uma resposta que o usuário ainda não deu.

- Por rodada, faça até três perguntas cujos pré-requisitos estejam resolvidos. Comece pelas que mais mudam o resultado.
- Pergunta que depende de outra ainda aberta na mesma rodada vai para a próxima.
- A cada resposta, refaça a árvore: o que foi resolvido empurra a fronteira e libera perguntas novas.
- Termo vago ou com dois sentidos ("conta", "cliente", "sessão") vira pergunta: proponha o termo
  preciso. Quando o usuário afirmar como algo funciona e o código ou o arquivo disser outra coisa, mostre a
  contradição: "o script apaga o lote inteiro, mas você disse que dá para desfazer um item. Qual vale?"
- Cenário concreto ajuda a fechar fronteira: invente o caso de borda que obriga a escolher.

## 4. Formato da rodada

Apresente a rodada como uma lista numerada.

- 👍 quando você tem uma recomendação. Redija para o "sim" aceitar a recomendação e ponha a
  alternativa entre parênteses: `👍 o lote some só depois da conferência? (não = some na hora)`. A
  pergunta se sustenta sozinha, sem depender dos detalhes acima.
- 🧠 quando não há recomendação honesta (gosto, dado que só ele tem): a pergunta, curta.
- Antes das perguntas, resuma as decisões tomadas e os fatos apurados.

O usuário pode responder só "sim" (aceita todas), "sim, menos o 3", ou com texto. "Decide você" ou "chega"
encerram: a escolha que estava aberta vai pela sua recomendação e entra no acordo como **Inferido**. Fato
ainda não consultado não vira Inferido: você o consulta (vira Verificado, com data) ou ele fica Em aberto.

## 5. Fim: o acordo

A sabatina termina quando a fronteira esvazia, com todo ramo visitado e toda decisão com estado.
Então mostre o acordo, curto:

```markdown
**Acordo: <o que vai ser construído>**
- Faz: <itens>
- Não faz: <itens>
- Pronto quando: <critério de aceite que dá para conferir>

| Decisão | Escolha | Justificativa | Estado |
|---|---|---|---|
| <o quê> | <o que ficou> | <fala do usuário, premissa ou fonte> | Decidido / Inferido / Verificado AAAA-MM-DD / Em aberto |
```

**Os quatro estados** (do `brainstorm` de Fabricio Veronez). Cada decisão tem um, e a
justificativa diz o que o sustenta:

- **Decidido:** o usuário disse. A justificativa é a fala dele.
- **Inferido:** você preencheu sem perguntar (decisão técnica, "decide você"). A justificativa é a
  premissa e o que muda se ela estiver errada.
- **Verificado:** fato de fora que você consultou. A justificativa é a fonte, com a data da consulta.
  Verificado envelhece: na retomada, fato volátil com data antiga se consulta de novo antes de construir
  em cima dele.
- **Em aberto:** o usuário adiou de propósito. A justificativa é o motivo e o que destrava.

Toda decisão que a fronteira tocou aparece na tabela com um desses estados; o que ninguém decidiu e
ninguém sabe que falta é o erro que a tabela existe para pegar. Inferido de alto impacto vai numa linha
própria, que o usuário lê; os triviais vão juntos numa linha só, porque lista longa é aprovada sem leitura.
Fato volátil (versão, preço, se a ferramenta ainda existe) nasce Verificado, com data, ou vira pergunta.

Feche com `👍 o acordo está certo e eu começo? (não = me diga o que muda)`. Não construa nada antes do
sim. Depois do sim, o acordo vira o critério de aceite: no brief da filha ou do executor
(`orquestrador`), no `HANDOFF.md` quando a fatia vai para outra sessão, ou só no começo do trabalho
quando é feito aqui. Não crie arquivo só para guardar o acordo.

## 6. O que ela não faz

- Não estressa uma decisão já tomada nem busca riscos e cenários: isso é o `1-simulador`.
- Não interroga sobre fato que dá para achar nem sobre detalhe técnico que o usuário não vê.
- Não vira questionário sem fim: rodada curta, a pergunta que mais pesa primeiro, e o usuário pode encerrar
  a qualquer momento.
