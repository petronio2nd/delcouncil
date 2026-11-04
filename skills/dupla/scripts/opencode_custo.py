# Custo da API da Anthropic gasto pelo OpenCode, lido do banco dele (~/.local/share/opencode/opencode.db),
# só leitura e só a tabela de sessões (o banco também guarda as credenciais: nunca leia outra tabela).
#   python -I opencode_custo.py sessao <id>   -> custo da sessão em US$ (vazio se ela ainda não existe)
#   python -I opencode_custo.py modelo <id>   -> modelo que a sessão usou, provedor/id#variante (vazio se não há)
#   python -I opencode_custo.py mes [AAAA-MM] -> JSON com o gasto do mês (padrão: o atual) no provedor anthropic
#   python -I opencode_custo.py ciclo         -> JSON com o gasto no ciclo atual do crédito do Max (dia 20 ao 19)
# O custo é o que o OpenCode calcula pela tabela de preços dele; o Console da Anthropic é a conta oficial.
import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone

BANCO = os.path.join(os.path.expanduser("~"), ".local", "share", "opencode", "opencode.db")
# O crédito de US$ 100 do Max chega a cada ciclo de cobrança da assinatura e expira no fim dele (Console,
# Créditos promocionais: concedido em 20/10/2026 00:00 UTC, expira em 19/11/2026). Mudou o dia da cobrança, mude aqui.
DIA_CICLO = 20


def conectar():
    if not os.path.exists(BANCO):
        sys.exit(f"banco do OpenCode não encontrado: {BANCO}")
    return closing(sqlite3.connect(f"file:{BANCO}?mode=ro", uri=True, timeout=10))


def custo_sessao(sid):
    with conectar() as c:
        r = c.execute("select cost from session_v2 where id = ?", (sid,)).fetchone()
    if r is not None:
        print(f"{float(r[0] or 0):.6f}")


def modelo_sessao(sid):
    with conectar() as c:
        r = c.execute("select model from session_v2 where id = ?", (sid,)).fetchone()
    try:
        m = json.loads((r and r[0]) or "{}")
    except ValueError:
        return
    if m.get("id"):
        variante = f"#{m['variant']}" if m.get("variant") else ""
        print(f"{m.get('providerID', '?')}/{m['id']}{variante}")


def mes_seguinte(d):
    return d.replace(year=d.year + 1, month=1) if d.month == 12 else d.replace(month=d.month + 1)


def custo_periodo(ini, fim):
    ms = lambda d: int(d.timestamp() * 1000)
    with conectar() as c:
        linhas = c.execute(
            "select model, cost from session_v2 where time_created >= ? and time_created < ?", (ms(ini), ms(fim))
        ).fetchall()
    total, sessoes, modelos = 0.0, 0, {}
    for modelo, custo in linhas:
        try:
            m = json.loads(modelo or "{}")
        except ValueError:
            continue
        if m.get("providerID") != "anthropic":
            continue
        total += float(custo or 0)
        sessoes += 1
        modelos[m.get("id", "?")] = round(modelos.get(m.get("id", "?"), 0) + float(custo or 0), 4)
    return {"custo": round(total, 4), "sessoes": sessoes, "modelos": modelos}


def custo_mes(mes):
    ini = datetime.strptime(mes, "%Y-%m")  # horário local, como o mês do usuário
    print(json.dumps({"mes": mes, **custo_periodo(ini, mes_seguinte(ini))}))


def custo_ciclo(agora=None):
    agora = agora or datetime.now(timezone.utc)
    ini = agora.replace(day=DIA_CICLO, hour=0, minute=0, second=0, microsecond=0)
    if agora < ini:
        ini = ini.replace(year=ini.year - 1, month=12) if ini.month == 1 else ini.replace(month=ini.month - 1)
    fim = mes_seguinte(ini)
    # *_ts em segundos Unix: o ConvertFrom-Json do PowerShell 7 converte a data ISO conforme a cultura.
    print(json.dumps({"inicio": ini.isoformat(), "fim": fim.isoformat(), "inicio_ts": int(ini.timestamp()),
                      "fim_ts": int(fim.timestamp()), **custo_periodo(ini, fim)}))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "sessao":
        custo_sessao(sys.argv[2])
    elif len(sys.argv) >= 3 and sys.argv[1] == "modelo":
        modelo_sessao(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == "mes":
        custo_mes(sys.argv[2] if len(sys.argv) >= 3 else datetime.now().strftime("%Y-%m"))
    elif len(sys.argv) >= 2 and sys.argv[1] == "ciclo":
        custo_ciclo()
    else:
        sys.exit(__doc__ or "uso: opencode_custo.py sessao <id> | modelo <id> | mes [AAAA-MM] | ciclo")
