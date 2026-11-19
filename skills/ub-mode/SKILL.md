---
name: ub-mode
description: >
  Disciplina de mudança de código (adaptada dos princípios do Uncle Bob): teste que falha primeiro,
  forma do dado antes da lógica, dado validado na entrada, menor mudança, causa raiz e commit que diz
  por quê, o quê e como foi provado. Use ao corrigir defeito ou mudar comportamento de código num
  repositório (Python, JS, PowerShell, scripts de skill, mods). NÃO use para texto, documento, análise,
  mensagens, configuração simples nem edição de uma linha.
---

# ub-mode

Adaptado de "ub-mode" de Robert C. Martin (MIT, ver `LICENSE`).

## 1. Primeiro, funcionar

- **Forma do dado antes da lógica.** Escolha a estrutura que torna o estado errado impossível.
  Exemplo: um conjunto de identificadores impede registrar o mesmo item duas vezes.
- **Teste que falha primeiro.** Escreva o teste, rode e veja falhar pelo motivo esperado; só então
  mude o código. Se um teste honesto não é viável, não escreva um teste ruim: diga isso.
- **Menor mudança** que faz o teste passar. Uma decisão mora num lugar só.
- **Subtraia antes de somar.** Requisito novo não é remendo no desenho velho: pergunte como seria
  se existisse desde o início.
- **Dado validado na entrada.** Arquivo, API e argumento são lidos e checados uma vez, na fronteira,
  com erro claro; dentro, confie. Lógica de negócio em função pura.
- **Idempotente.** Rodar duas vezes, ou depois de cair no meio, termina no mesmo estado.
- **Duas correções com a mesma premissa falharam?** Escreva a premissa numa frase e ataque-a antes
  da terceira tentativa.
- **Trabalho repetitivo ou em lote:** faça um item à mão e depois a ferramenta que repete igual.

## 2. Depois, certo

- **Causa raiz.** Reproduza, corrija a causa. Guarda que só esconde o erro não é correção. Falha que
  já existia antes da sua mudança: confirme comparando com a versão anterior e relate à parte.
- **Teste de comportamento.** O teste chama o código como o usuário chama e confere o que ele veria.
  Se passaria com todas as funções devolvendo nada, jogue fora.
- **Refatorar:** fixe o comportamento com teste, mude a estrutura, prove que nada mudou.
- **Unidades pequenas conferidas:** termine e confira uma antes da próxima.

## 3. Prática

- **Log curto no fim:** até 7 linhas "ação → motivo", em português, na mensagem final.
- **Commit** pequeno, dizendo por quê, o quê e como foi provado (testes rodados, conferência ao vivo).
  Siga o fluxo de commit e push do repositório.
- A cada parada com o usuário, uma linha dizendo que princípio acabou de aplicar.
