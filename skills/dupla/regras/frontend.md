# Regras de frontend (telas, painéis, páginas)

- Toda lista e todo dado têm os estados vazio, carregando e erro, não só o cheio.
- Texto longo não quebra o layout: corte ou quebre de propósito.
- Cor nunca é o único sinal: o estado também aparece em texto ou ícone.
- Use os componentes e as cores (tokens) que o projeto já tem; nada de valor solto.
- A lógica fica fora do componente, em função pura testável; o componente só desenha.
