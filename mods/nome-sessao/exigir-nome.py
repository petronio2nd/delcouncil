"""Hook de Stop: segura o fim do turno até a sessão do app desktop ser renomeada.

A regra do nome da sessão (CLAUDE.md, seção "Nome da sessão") é só texto, e cerca de
1 sessão em 5 terminava sem renomear. O hook lê o histórico da sessão e, se nunca houve
uma chamada a set_session_title, devolve "block" com o motivo, e o Claude continua o turno
para renomear. Vale uma vez por sessão: depois do primeiro nome, não interfere mais.

Nunca atrapalha o resto: fora do app desktop, com stop_hook_active (já bloqueou neste
turno), sem histórico ou com entrada estranha, sai sem dizer nada.
"""

import json
import os
import re
import sys

FERRAMENTA = re.compile(rb'"name"\s*:\s*"mcp__ccd_session_mgmt__set_session_title"')
SESSAO_APP = re.compile(r"^local_[A-Za-z0-9-]{1,64}$")

MOTIVO = (
    "Esta sessão do app ainda não foi renomeada (CLAUDE.md, seção \"Nome da sessão\"). "
    "Carregue mcp__ccd_session_mgmt__set_session_title com o ToolSearch e renomeie com "
    "session_id \"self\", no formato emoji + texto que diz onde a sessão parou ou o que "
    "espera do usuário. Depois encerre sem escrever mais nada: a resposta anterior continua "
    "sendo a mensagem final."
)


def chamou_renomear(linha):
    # O regex só filtra; a chamada conta se for um bloco tool_use do assistente principal,
    # e não um "name" aninhado no input de outra ferramenta nem uma chamada de subagente.
    if not FERRAMENTA.search(linha):
        return False
    try:
        registro = json.loads(linha)
    except (ValueError, UnicodeDecodeError):
        return False
    if not isinstance(registro, dict) or registro.get("type") != "assistant" or registro.get("isSidechain"):
        return False
    mensagem = registro.get("message")
    conteudo = mensagem.get("content") if isinstance(mensagem, dict) else None
    return isinstance(conteudo, list) and any(
        isinstance(bloco, dict) and bloco.get("type") == "tool_use"
        and bloco.get("name") == "mcp__ccd_session_mgmt__set_session_title"
        for bloco in conteudo
    )


def ja_renomeada(caminho):
    # Linha a linha, parando no primeiro acerto: o histórico pode ter centenas de MB.
    with open(caminho, "rb") as f:
        return any(chamou_renomear(linha) for linha in f)


def main():
    try:
        entrada = json.load(sys.stdin)
    except (ValueError, UnicodeDecodeError):
        return
    if not isinstance(entrada, dict) or entrada.get("stop_hook_active"):
        return
    if not SESSAO_APP.match(os.environ.get("CLAUDE_CODE_HOST_SESSION_ID", "")):
        return
    caminho = entrada.get("transcript_path")
    if not isinstance(caminho, str) or not os.path.isfile(caminho):
        return
    try:
        if ja_renomeada(caminho):
            return
    except OSError:
        return
    print(json.dumps({"decision": "block", "reason": MOTIVO}, ensure_ascii=False))


if __name__ == "__main__":
    main()
