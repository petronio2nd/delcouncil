# session-band

A Claude Code mod: one band above the prompt with the session at a glance.

- **Band**: turn number, output speed of the last response (tok/s), cost of the last turn and of the session, a countdown of the 1-hour prompt cache since the last answer, and context fill. The band gets an amber frame 20 minutes before the cache expires and a red one at 10. The row drops details as the window narrows instead of wrapping; `×` hides it for the rest of the session.
- **Cache warning**: at 10 and 5 minutes left, a system notification with Claude's icon, titled `<project> — <session title>`, saying how many minutes the cache has left. In the desktop app, clicking it opens the session. Nothing fires while a turn runs.

## The notifier (macOS)

The warning is posted by a small helper app, built once on your Mac (needs Xcode's command line tools; the icon is taken from your installed Claude.app):

```bash
plugins/session-band/notifier/build.sh
```

It builds `notifier/Session Band.app` next to the script; on its first notification macOS asks whether to allow notifications from "Session Band". Build it in the folder the mod is loaded from, or copy the built app there. Without the helper (or on another OS) the mod falls back to Claude Code's own notification, which also reaches your phone over Remote Control but has no title or click-through; when you are already at the session that one is skipped and a toast says it instead.

## Commands

- `/session_data`: show or hide the band.
- `/session_data demo <minutes>`: pretend the cache has that many minutes left, to preview the colors and the warning; the next answer resets it.

Install instructions are in the [repository README](../../README.md).

## Nesta cópia

Veio de [johnnyvizz/claude-kit](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/session-band) 0.2.0 (MIT). Mudanças nesta cópia:

- 0.3.0 (14/10/2026): anéis de 5h (relógio, rosa) e semana (calendário, castanho) no mesmo desenho do contexto, com barra 🟡 a partir de 60% e 🔴 a partir de 85%; entra no lugar do mod `medidor`. Os níveis de largura ganharam um degrau: as barras de 5h e semana somem primeiro quando a faixa estreita.
- 0.3.1 (14/10/2026, revisão do Codex): 5h e semana somem na faixa mais estreita, e uma janela sem leitura some em vez de mostrar a % antiga.
