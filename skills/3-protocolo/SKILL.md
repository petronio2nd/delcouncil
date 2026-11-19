---
name: "3-protocolo"
description: "Modo Protocolo & Ação: transforma decisões JÁ TOMADAS em checklists, rotinas passo a passo e instruções operacionais sem ambiguidade, desenhadas para reduzir atrito executivo. Use sempre que o usuário pedir \"transforma em protocolo\", \"faz um checklist\", \"passo a passo\", \"como executo isso\", \"vira rotina\", \"operacionaliza\", \"já decidi X, agora como faço\", ou mencionar que travou na execução de algo já decidido. NÃO use para decidir se vale a pena (1-simulador) nem para organizar notas brutas (2-destilador)."
---

# Protocolo — Da Decisão à Ação

Modo de raciocínio para **transformar decisões já tomadas em execução sem ambiguidade**. Aqui a discussão acabou: o mérito da decisão não se reabre (isso é papel do 1-simulador). O trabalho é eliminar todo atrito entre "decidi" e "fiz". Ambiguidade, passos vagos e micro-decisões no meio da execução são os principais pontos de travamento, e o protocolo existe para removê-los antecipadamente.

## Princípios de design do protocolo

1. **Um passo = uma ação física ou digital concreta.** "Organizar as finanças" não é um passo; "abrir o app do banco e exportar o extrato de julho" é. Se um passo esconde 3 decisões, quebre-o em 3 passos.
2. **Zero micro-decisões durante a execução.** Toda escolha que puder ser feita agora, na criação do protocolo, deve ser feita agora (qual app, qual horário, qual ordem, o que fazer se X falhar). O protocolo pronto não deve exigir pensamento — só execução.
3. **Gatilho de início explícito.** Todo protocolo diz quando/como começa: um horário, um evento ("depois do café"), ou uma condição. Protocolo sem gatilho é lista de boas intenções.
4. **Critério de pronto por passo.** Cada passo diz como saber que terminou. "Feito quando: o arquivo está na pasta X."
5. **Rota de exceção.** Preveja o ponto mais provável de travamento e defina a saída ("se não conseguir em 10 min, pule para o passo 6 e registre a pendência"). Melhor um protocolo 80% executado do que 100% abandonado.
6. **Curto vence completo.** Máximo ~10 passos por protocolo. Se precisar de mais, divida em 2 protocolos encadeados.

## Estrutura do protocolo

```markdown
## Protocolo: [nome curto no infinitivo]
**Decisão de origem:** [1 frase — o que foi decidido]
**Gatilho:** [quando/como começa]
**Duração estimada:** [tempo realista]

1. [ação concreta] — feito quando: [critério]
2. ...

**Se travar:** [rota de exceção]
**Feito de verdade quando:** [critério final observável]
```

Para rotinas recorrentes, inclua a frequência no gatilho. Se fizer sentido, ofereça criar um lembrete com a ferramenta disponível.

## Antes de gerar

Se a decisão de origem não estiver clara, faça no máximo 2 perguntas (o que exatamente foi decidido? existe prazo/frequência?). Se o usuário começar a reabrir o mérito da decisão ("será que devia mesmo?"), aponte: "isso é conversa para o 1-simulador — quer ir para lá ou seguimos com a execução?"

## Encerramento: síntese

Entregue a síntese no modelo abaixo. Use o título e o status adequados ao trabalho. Se o usuário quiser guardar a síntese, confirme o destino e grave com a ferramenta autorizada. Se o destino ou a ferramenta estiver indisponível, entregue o bloco pronto para copiar.

```markdown
# PROTOCOLO — [nome do protocolo] — AAAA-MM-DD

**Decisão de origem:** [1 frase]
**Gatilho:** [quando começa]
**Nº de passos:** [n]
[protocolo completo aqui]
**Status:** em execução | concluído | pausado | suspenso
```

## O que este modo NÃO faz

- Não avalia se a decisão é boa → indique a skill **1-simulador**.
- Não organiza material bruto → indique a skill **2-destilador**.
- O protocolo descreve as ações. Para executar uma ação com as ferramentas disponíveis, siga a autorização do usuário.
