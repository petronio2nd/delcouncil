---
name: validar-metas
description: >-
  Verifica se uma meta, um resultado-chave de OKR ou um critério GO/NO-GO é mensurável
  e permite uma decisão. Também revisa o progresso de vários projetos com a mesma régua.
  Use para conferir metas antes de aprová-las ou avaliar um portfólio.
  Use 1-simulador para avaliar a decisão e status-report para comunicar resultados de um período.
---

# Validar metas

Leia a fonte inteira e identifique a decisão que a métrica vai orientar. Se houver dúvida sobre
o mérito da decisão, registre-a para discutir à parte. Aqui, verifique se a métrica permite decidir.

## Conferir o que será medido

- Escreva a unidade, a população elegível, as exclusões e a fonte do dado. Duas pessoas devem
  conseguir recontar o indicador e chegar ao mesmo resultado.
- Confira se a meta descreve uma mudança observável. Uma atualização publicada é uma entrega.
  A proporção de solicitações resolvidas até o prazo mede um resultado.
- Registre o valor de partida, o alvo e as datas que abrem e fecham a contagem. Para uma primeira
  medição, peça a justificativa do alvo, como um limite de custo ou de capacidade.
- Identifique quem responde pelo resultado e quem coleta o número. Use `[DADO AUSENTE: o quê]`
  quando a informação faltar. Se uma pessoa decide e executa sozinha, ela responde pelo resultado.
  Registre dependências ou indicadores redundantes e mostre os cálculos.

## Testar o critério de decisão

Em um piloto, estime o tempo disponível para medir depois da preparação. Se houver semanas ou dias
perdidos, compare a janela provável com a mais favorável. Verifique se etapas que levam tempo para
concluir seguirão observáveis até o fechamento e declare como tratar eventos ainda pendentes.

Recalcule os limites nas condições do piloto. Se o orçamento é fixo, a quantidade mínima e o custo
máximo por unidade podem decidir a mesma coisa. Em um processo com etapas, explicite as taxas de
passagem implícitas. Com poucas observações, aponte quais resultados ainda seriam inconclusivos.
Quando o modelo de Poisson for apropriado à contagem, use um intervalo exato de 95% e informe o
período de exposição. Para custo por unidade, avalie o efeito da incerteza no denominador.

Confira o que será liberado em caso de GO e quais dependências exigem verificação separada.
Proponha uma faixa de extensão ou revisão para os casos em que os indicadores divergirem ou
ficarem na borda. A decisão final sobre as faixas é do responsável.

## Comparar projetos

Para uma meta acumulativa com progresso aproximadamente linear, divida o progresso observado pelo
progresso programado para a data, considerando a diferença entre o valor inicial e o alvo. Use o
cronograma de marcos se ele tiver outro perfil. Quando houver várias metas, aplique ao projeto
a pior cor entre as metas e os bloqueios.

| Cor | Critério |
|---|---|
| 🔴 Vermelho | Progresso abaixo de 40% do esperado ou bloqueio sem responsável |
| 🟡 Amarelo | Progresso de 40% a menos de 60% do esperado ou bloqueio ativo com responsável. Se faltar plano, registre sua definição como próxima ação |
| 🟢 Verde | Progresso de pelo menos 60% do esperado e nenhum bloqueio ativo |

Se faltar meta, prazo ou dado de progresso, registre a lacuna e considere só os bloqueios.
Faça o mesmo se não houver progresso programado até a data. Marque como sem classificação se os
dados disponíveis não sustentarem uma cor. Liste dependências que ameaçam mais de um projeto e
indique até três decisões por urgência. Se não houver vermelho, considere uma revisão assíncrona
quando o grupo já tiver combinado como registrar a aprovação.

## Entregar

Para cada meta, mostre a fonte, os pontos validados, as lacunas e o ajuste indicado. Se houver falhas,
inclua a redação corrigida com os dados disponíveis. Para piloto, dê uma resposta direta sobre a
janela, o volume e a faixa inconclusiva. Para portfólio, mostre um projeto por linha com situação,
motivo e próxima ação com responsável. Informe quais decisões precisam de aprovação, até três.
Entregue na conversa. Altere o documento de origem só com autorização.
