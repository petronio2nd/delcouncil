# Uso dos modelos num período, por fornecedor e modelo, e o peso estimado que ficou fora do Claude Max.
# Só leitura. Uso: python -I -X utf8 uso_modelos.py [--desde AAAA-MM-DD] [--ate AAAA-MM-DD]
#   (padrão: os últimos 3 dias, até agora). Imprime markdown.
# Fontes:
#   Claude Max : transcrições do Claude Code (~/.claude/projects/**/*.jsonl), message.usage sem repetir message.id
#   GPT        : sessões do Codex CLI (~/.codex/sessions, último token_count) e do OpenCode com provedor openai
#   API        : OpenCode com provedor anthropic (custo do próprio OpenCode; o Console é a conta oficial)
#   agy        : bancos de conversa (~/.gemini/antigravity-cli/conversations/*.db), tabela gen_metadata em
#                protobuf sem esquema publicado: .1.21 é o nome do modelo, .1.4.2 a entrada e .1.4.3 a saída
#                (lidos pelo formato em 2026-10-28, não por documentação)
# Do banco do OpenCode só a tabela de sessões: ele também guarda credenciais.
import argparse
import glob
import json
import os
import sqlite3
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timedelta

H = os.path.expanduser("~")
# US$ por milhão: entrada, saída, leitura de cache; a escrita de cache é 1,25 vez a entrada.
PRECO = {"opus": (4, 20, 0.20), "sonnet": (2, 10, 0.20), "haiku": (0.10, 0.50, 0.01), "fable": (10, 50, 0.25)}


def preco(fam, t):
    i, o, cr = PRECO[fam]
    return (t["in"] * i + t["cw"] * i * 1.25 + t["cr"] * cr + t["out"] * o) / 1e6


def novo():
    return defaultdict(float)


def claude_code(ini, fim):
    # A mesma resposta aparece numa linha por bloco: vale o maior uso visto de cada message.id.
    msgs = {}
    for f in glob.glob(os.path.join(H, ".claude", "projects", "**", "*.jsonl"), recursive=True):
        if os.path.getmtime(f) < ini.timestamp():
            continue
        sub = "subagents" in f.replace("\\", "/")
        with open(f, encoding="utf-8", errors="ignore") as fh:
            for linha in fh:
                if '"usage"' not in linha:
                    continue
                try:
                    d = json.loads(linha)
                except ValueError:
                    continue
                m = d.get("message") or {}
                u = m.get("usage")
                ts = d.get("timestamp") or ""
                if not u or not ts:
                    continue
                quando = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
                if not ini <= quando < fim:
                    continue
                fam = next((x for x in PRECO if x in (m.get("model") or "")), None)
                if not fam:
                    continue
                novo_u = {"in": u.get("input_tokens") or 0, "cw": u.get("cache_creation_input_tokens") or 0,
                          "cr": u.get("cache_read_input_tokens") or 0, "out": u.get("output_tokens") or 0}
                mid = m.get("id") or d.get("uuid")
                velho = msgs.get(mid)
                if velho:
                    for k in ("in", "cw", "cr", "out"):
                        velho[1][k] = max(velho[1][k], novo_u[k])
                else:
                    msgs[mid] = (fam, novo_u, sub)
    por = defaultdict(novo)
    for fam, u, sub in msgs.values():
        t = por[fam]
        for k in ("in", "cw", "cr", "out"):
            t[k] += u[k]
        t["msgs"] += 1
        if sub:
            t["sub"] += sum(u.values())
    return por


def codex(ini, fim):
    t = novo()
    for f in glob.glob(os.path.join(H, ".codex", "sessions", "*", "*", "*", "*.jsonl")):
        if os.path.getmtime(f) < ini.timestamp():
            continue
        # total_token_usage é o acumulado da sessão: vale o que cresceu dentro do período, o último acumulado
        # antes do fim menos o último antes do começo.
        zero = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
        antes, ate = zero, zero
        with open(f, encoding="utf-8", errors="ignore") as fh:
            for linha in fh:
                if "total_token_usage" not in linha:
                    continue
                try:
                    d = json.loads(linha)
                    acum = d["payload"]["info"]["total_token_usage"]
                    q = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
                except (ValueError, KeyError, TypeError, AttributeError):
                    continue
                if q < ini:
                    antes = acum
                if q < fim:
                    ate = acum
        dif = {k: ate.get(k, 0) - antes.get(k, 0) for k in zero}
        if any(dif.values()):
            t["in"] += dif["input_tokens"] - dif["cached_input_tokens"]
            t["cr"] += dif["cached_input_tokens"]
            t["out"] += dif["output_tokens"]
            t["sessoes"] += 1
    return t


def opencode(ini, fim):
    banco = os.path.join(H, ".local", "share", "opencode", "opencode.db")
    por = defaultdict(novo)
    if not os.path.exists(banco):
        return por
    ms = lambda d: int(d.timestamp() * 1000)
    with closing(sqlite3.connect(f"file:{banco}?mode=ro", uri=True, timeout=10)) as c:
        linhas = c.execute(
            "select model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write"
            " from session_v2 where time_created >= ? and time_created < ?", (ms(ini), ms(fim))).fetchall()
    for model, cost, ti, to, tr, tcr, tcw in linhas:
        try:
            m = json.loads(model or "{}")
        except ValueError:
            continue
        t = por[f"{m.get('providerID', '?')}/{m.get('id', '?')}"]
        t["in"] += ti or 0
        t["out"] += (to or 0) + (tr or 0)
        t["cr"] += tcr or 0
        t["cw"] += tcw or 0
        t["custo"] += cost or 0
        t["sessoes"] += 1
    return por


def _varint(b, i):
    r = s = 0
    while True:
        x = b[i]
        i += 1
        r |= (x & 0x7F) << s
        s += 7
        if x < 0x80:
            return r, i


def _pb(b, caminho="", saida=None):
    # Protobuf bruto, sem esquema: devolve (caminho do campo, valor) dos inteiros e textos curtos.
    saida = [] if saida is None else saida
    i = 0
    try:
        while i < len(b):
            k, i = _varint(b, i)
            campo, tipo = k >> 3, k & 7
            p = f"{caminho}.{campo}"
            if tipo == 0:
                v, i = _varint(b, i)
                saida.append((p, v))
            elif tipo == 1:
                i += 8
            elif tipo == 5:
                i += 4
            elif tipo == 2:
                n, i = _varint(b, i)
                sub = b[i:i + n]
                i += n
                try:
                    s = sub.decode("utf-8")
                    if s.isprintable() and len(s) < 120:
                        saida.append((p, s))
                        continue
                except UnicodeDecodeError:
                    pass
                _pb(sub, p, saida)
            else:
                return saida
    except IndexError:
        pass
    return saida


def agy(ini, fim):
    # O banco não traz a hora de cada chamada: vale a conversa mexida dentro do período (o despacho e a
    # transcrição são de uma rodada só). A transcrição de áudio do um-transcritor roda numa pasta audio--*.
    por = defaultdict(novo)
    for f in glob.glob(os.path.join(H, ".gemini", "antigravity-cli", "conversations", "*.db")):
        if not ini.timestamp() <= os.path.getmtime(f) < fim.timestamp():
            continue
        try:
            with closing(sqlite3.connect(f"file:{f}?mode=ro", uri=True, timeout=5)) as c:
                linhas = c.execute("select data from gen_metadata").fetchall()
                try:
                    meta = c.execute("select data from trajectory_metadata_blob").fetchone()
                except sqlite3.Error:
                    meta = None
        except sqlite3.Error:
            continue
        audio = bool(meta and meta[0] and b"audio-" in meta[0])
        contou = set()
        for (data,) in linhas:
            d = _pb(data)
            nome = next((v for p, v in d if p == ".1.21"), None)
            nome = f"{nome} · áudio" if nome and audio else nome
            u = {p: v for p, v in d if p.startswith(".1.4.") and isinstance(v, int)}
            if not nome or ".1.4.2" not in u:
                continue
            t = por[nome]
            t["in"] += u[".1.4.2"]
            t["out"] += u.get(".1.4.3", 0)
            t["chamadas"] += 1
            if nome not in contou:
                t["conversas"] += 1
                contou.add(nome)
    return por


def br(v, casas=0):
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def mi(n):
    return f"{br(n / 1e6, 1)} M"


def total(t):
    return t["in"] + t["cw"] + t["cr"] + t["out"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde")
    ap.add_argument("--ate")
    a = ap.parse_args()
    fim = datetime.strptime(a.ate, "%Y-%m-%d") + timedelta(days=1) if a.ate else datetime.now()
    ini = datetime.strptime(a.desde, "%Y-%m-%d") if a.desde else fim - timedelta(days=3)

    cc, cx, oc, ag = claude_code(ini, fim), codex(ini, fim), opencode(ini, fim), agy(ini, fim)
    gpt = novo()
    for t in [cx] + [v for k, v in oc.items() if k.startswith("openai/")]:
        for x in ("in", "cw", "cr", "out"):
            gpt[x] += t[x]
    api = [v for k, v in oc.items() if k.startswith("anthropic/")]
    # agy no lugar do Claude: Argon e Pro valem Sonnet a Opus; o resto (Flash e Claude executores) Haiku a
    # Sonnet. A transcrição de áudio fica fora: o Claude não transcreve.
    argon, resto = novo(), novo()
    for k, v in ag.items():
        if "áudio" in k:
            continue
        alvo = argon if ("Argon" in k or "Pro" in k) else resto
        alvo["in"] += v["in"]
        alvo["out"] += v["out"]

    tmax = sum(total(t) for t in cc.values()) or 1
    print(f"# Uso dos modelos de {ini:%d/%m %H:%M} a {fim:%d/%m %H:%M}\n")
    print("| Fornecedor | Tokens | Saída | Custo |\n|---|---:|---:|---|")
    print(f"| Claude Max | {mi(tmax)} | {mi(sum(t['out'] for t in cc.values()))} | assinatura |")
    print(f"| GPT (Codex e OpenCode) | {mi(total(gpt))} | {mi(gpt['out'])} | assinatura do ChatGPT |")
    print(f"| API Anthropic (OpenCode) | {mi(sum(total(t) for t in api))} | {mi(sum(t['out'] for t in api))} | "
          f"US$ {br(sum(t['custo'] for t in api), 2)} |")
    print(f"| agy | {mi(sum(t['in'] for t in ag.values()))} de entrada | {mi(sum(t['out'] for t in ag.values()))} | plano Google |")

    print("\n## Claude Max por modelo\n\n| Modelo | Tokens | % | Saída | Mensagens | Subagentes |\n|---|---:|---:|---:|---:|---:|")
    for fam, t in sorted(cc.items(), key=lambda x: -total(x[1])):
        print(f"| {fam} | {mi(total(t))} | {100 * total(t) / tmax:.0f}% | {mi(t['out'])} | {int(t['msgs'])} | {mi(t['sub'])} |")

    print("\n## OpenCode por modelo\n\n| Modelo | Sessões | Tokens | Saída | US$ |\n|---|---:|---:|---:|---:|")
    for k, t in sorted(oc.items(), key=lambda x: -total(x[1])):
        print(f"| {k} | {int(t['sessoes'])} | {mi(total(t))} | {mi(t['out'])} | {br(t['custo'], 2)} |")
    if cx["sessoes"]:
        print(f"\nCodex CLI: {int(cx['sessoes'])} sessões, {mi(total(cx))}.")

    print("\n## agy por modelo\n\n| Modelo | Conversas | Chamadas | Entrada | Saída |\n|---|---:|---:|---:|---:|")
    for k, t in sorted(ag.items(), key=lambda x: -x[1]["in"]):
        print(f"| {k} | {int(t['conversas'])} | {int(t['chamadas'])} | {mi(t['in'])} | {mi(t['out'])} |")

    real = sum(preco(f, t) for f, t in cc.items())
    tudo_opus = sum(preco("fable" if f == "fable" else "opus", t) for f, t in cc.items())
    print("\n## Peso estimado fora do Max (preço de tabela da API da Anthropic)\n")
    print(f"- Max no período: US$ {br(real)}.")
    if tudo_opus:
        print(f"- Sonnet e Haiku no lugar do Opus: US$ {br(tudo_opus - real)} ({100 * (tudo_opus - real) / tudo_opus:.0f}%).")
    print(f"- GPT, se rodasse no Claude: US$ {br(preco('sonnet', gpt))} (Sonnet) a US$ {br(preco('opus', gpt))} (Opus).")
    print(f"- Argon e Pro pelo agy, se rodassem no Claude: US$ {br(preco('sonnet', argon))} a US$ {br(preco('opus', argon))}.")
    print(f"- Resto do agy (Flash e Claude executores): US$ {br(preco('haiku', resto))} (Haiku) a "
          f"US$ {br(preco('sonnet', resto))} (Sonnet). A transcrição de áudio fica fora: o Claude não transcreve.")
    baixo = tudo_opus - real + preco("sonnet", gpt) + preco("sonnet", argon) + preco("haiku", resto)
    alto = tudo_opus - real + preco("opus", gpt) + preco("opus", argon) + preco("sonnet", resto)
    if tudo_opus:
        print(f"- Somando: US$ {br(baixo)} a US$ {br(alto)}, {100 * baixo / (real + baixo):.0f}% a "
              f"{100 * alto / (real + alto):.0f}% do peso total do período.")
    print("\nLimites: o OpenCode e o agy contam a sessão ou conversa inteira pela data em que ela foi criada ou "
          "mexida por último (não guardam a hora de cada chamada); os campos de tokens do agy foram lidos do "
          "protobuf sem esquema publicado.")


if __name__ == "__main__":
    main()
