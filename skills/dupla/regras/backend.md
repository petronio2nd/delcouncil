# Regras de backend (scripts, serviços, dados)

- Valide a entrada na borda (argumento, arquivo, resposta de API) e falhe com mensagem clara.
- Não engula erro: `catch` vazio só onde a falha não muda o resultado, com um comentário dizendo por quê.
- Gravação em disco ou banco: no lugar certo, sem apagar o que já existe sem a tarefa pedir.
- Caminho de erro também tem teste, não só o caminho feliz.
- Encoding explícito (UTF-8) ao ler e gravar texto.
