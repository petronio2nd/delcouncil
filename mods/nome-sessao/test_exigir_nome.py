import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exigir-nome.py")
ID_APP = "local_bcca7ba3-e9a0-4aeb-8c56-331d7e1419b2"

CHAMADA = {
    "type": "assistant",
    "message": {"content": [{"type": "tool_use", "id": "toolu_1",
                             "name": "mcp__ccd_session_mgmt__set_session_title",
                             "input": {"session_id": "self", "title": "✅ feito"}}]},
}
TEXTO_QUE_CITA = {
    "type": "assistant",
    "message": {"content": [{"type": "text",
                             "text": 'o histórico grava "name":"mcp__ccd_session_mgmt__set_session_title"'}]},
}
NOME_ANINHADO = {
    "type": "assistant",
    "message": {"content": [{"type": "tool_use", "id": "toolu_3", "name": "outra_ferramenta",
                             "input": {"name": "mcp__ccd_session_mgmt__set_session_title"}}]},
}
CHAMADA_DE_SUBAGENTE = {**CHAMADA, "isSidechain": True}
OUTRA_FERRAMENTA = {
    "type": "assistant",
    "message": {"content": [{"type": "tool_use", "id": "toolu_2", "name": "Bash", "input": {}}]},
}


def rodar(entrada, linhas=None, id_app=ID_APP, sem_historico=False, separadores=(",", ":")):
    with tempfile.TemporaryDirectory() as pasta:
        caminho = os.path.join(pasta, "sessao.jsonl")
        if not sem_historico:
            with open(caminho, "w", encoding="utf-8") as f:
                for linha in linhas or []:
                    f.write(json.dumps(linha, ensure_ascii=False, separators=separadores) + "\n")
        if isinstance(entrada, dict):
            entrada = json.dumps({"transcript_path": caminho, **entrada})
        env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CODE_HOST_SESSION_ID"}
        if id_app is not None:
            env["CLAUDE_CODE_HOST_SESSION_ID"] = id_app
        r = subprocess.run([sys.executable, "-I", "-X", "utf8", SCRIPT], input=entrada,
                           capture_output=True, text=True, encoding="utf-8", env=env, timeout=30)
        return r


class ExigirNome(unittest.TestCase):
    def bloqueou(self, r):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["decision"], "block")

    def liberou(self, r):
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "")

    def test_sem_nome_bloqueia(self):
        self.bloqueou(rodar({"stop_hook_active": False}, [OUTRA_FERRAMENTA]))

    def test_com_nome_libera(self):
        self.liberou(rodar({"stop_hook_active": False}, [OUTRA_FERRAMENTA, CHAMADA]))

    def test_json_com_espacos_libera(self):
        self.liberou(rodar({"stop_hook_active": False}, [CHAMADA], separadores=(", ", ": ")))

    def test_texto_que_so_cita_a_ferramenta_nao_conta(self):
        self.bloqueou(rodar({"stop_hook_active": False}, [TEXTO_QUE_CITA]))

    def test_nome_aninhado_em_outra_ferramenta_nao_conta(self):
        self.bloqueou(rodar({"stop_hook_active": False}, [NOME_ANINHADO]))

    def test_chamada_de_subagente_nao_conta(self):
        self.bloqueou(rodar({"stop_hook_active": False}, [CHAMADA_DE_SUBAGENTE]))

    def test_segunda_parada_do_turno_libera(self):
        self.liberou(rodar({"stop_hook_active": True}, [OUTRA_FERRAMENTA]))

    def test_fora_do_app_libera(self):
        self.liberou(rodar({"stop_hook_active": False}, [OUTRA_FERRAMENTA], id_app=None))
        self.liberou(rodar({"stop_hook_active": False}, [OUTRA_FERRAMENTA], id_app="abc"))

    def test_sem_historico_libera(self):
        self.liberou(rodar({"stop_hook_active": False}, sem_historico=True))

    def test_entrada_estranha_libera(self):
        self.liberou(rodar("isto não é json"))
        self.liberou(rodar("[1, 2]"))
        self.liberou(rodar(json.dumps({"transcript_path": 5})))


if __name__ == "__main__":
    unittest.main()
