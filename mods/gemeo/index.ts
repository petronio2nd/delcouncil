// Mod `gemeo`: dá ao OpenCode as ferramentas do Claude Code desktop com os MESMOS nomes
// (set_session_title, set_pinned, archive_session, start_session, spawn_task, SendMessage,
// list_events, request_directory, get_usage), para as skills e o CLAUDE.md rodarem nos dois
// harness sem mudar. Também avisa o modelo no system prompt, grava a cota do ChatGPT lida dos
// cabeçalhos x-codex-* e registra o comando /cpa.

import { Plugin } from "@opencode/plugin";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ESQUEMA_ROTA, NOTA_ROTEAMENTO, conferirFatia, reservarFatia, type Rota } from "../orquestra/hooks/roteamento.ts";
import { conferirFonte, conferirFontePrevia, executarFontes } from "./fontes.ts";
import { aplicarRotaNova, esforcoDoModelo, lerRota, modeloDaRota } from "./rota.ts";

const COTA_CHATGPT = join(homedir(), ".local", "share", "dupla", "cota-chatgpt.json");
// O SDK do plugin (2.1.4) descarta `archived` no session.update; o CLI faz o PATCH inteiro.
const OPENCODE_CLI = [
  join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Programs", "@opencodedesktop", "resources", "opencode-cli.exe"),
  "opencode",
];

function arquivarPeloCli(sessionID: string): Promise<void> {
  const semCaminho = (p: string) => !p.includes("\\") && !p.includes("/");
  const exe = OPENCODE_CLI.find((p) => semCaminho(p) || existsSync(p));
  if (!exe) return Promise.reject(new Error("opencode-cli.exe não encontrado"));
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      ["api", "patch", `/api/session/${sessionID}`, "--data", JSON.stringify({ archived: true })],
      { windowsHide: true, timeout: 15_000 },
      (erro, _stdout, stderr) => (erro ? reject(new Error(`${erro.message}${stderr ? `: ${stderr}` : ""}`)) : resolve()),
    );
  });
}

type Json = Record<string, unknown>;
type ReservaRota = Rota & { esforcoSelecionado?: string | null };
type ModelRef = { providerID: string; id: string; variant?: string };
type ModelInfo = {
  providerID: string;
  id: string;
  enabled?: boolean;
  variants?: readonly { id: string }[];
  time?: { released?: number };
};

const FAMILIAS = ["haiku", "sonnet", "opus", "fable"] as const;
const FAMILIAS_GPT = ["luna", "terra", "sol", "astra"] as const;
const PARAMETROS_IGNORADOS = ["name", "context", "initiation", "use_worktree"];

function texto(valor: unknown): string {
  return JSON.stringify(valor, null, 2);
}

function familiaDe(id: string): string | undefined {
  const m = /^claude-(haiku|sonnet|opus|fable)/.exec(id) ?? /^gpt-[\d.]+-(luna|terra|sol|astra)$/.exec(id);
  return m?.[1];
}

// O mais novo da família na lista (anthropic para Claude, openai para GPT), sem os `-fast` (custam o
// dobro); em empate de data, o id mais curto (o alias sem sufixo de data).
function maisNovoDaFamilia(modelos: readonly ModelInfo[], familia: string): ModelInfo | undefined {
  const provider = (FAMILIAS_GPT as readonly string[]).includes(familia) ? "openai" : "anthropic";
  const candidatos = modelos.filter(
    (m) => m.providerID === provider && m.enabled !== false && familiaDe(m.id) === familia && !m.id.endsWith("-fast"),
  );
  candidatos.sort((a, b) => {
    const dif = (b.time?.released ?? 0) - (a.time?.released ?? 0);
    if (dif !== 0) return dif;
    return a.id.length - b.id.length;
  });
  return candidatos[0];
}

// Aceita "provider/id", apelido do Claude Code (haiku, sonnet, opus, fable) e id solto
// ("claude-sonnet-5-5", "gpt-6-luna").
function resolverModelo(pedido: string, modelos: readonly ModelInfo[]): ModelRef | undefined {
  const p = pedido.trim();
  if (!p) return undefined;
  if (p.includes("/")) {
    const barra = p.indexOf("/");
    return { providerID: p.slice(0, barra), id: p.slice(barra + 1) };
  }
  const apelido = p.toLowerCase();
  if ((FAMILIAS as readonly string[]).includes(apelido) || (FAMILIAS_GPT as readonly string[]).includes(apelido)) {
    const m = maisNovoDaFamilia(modelos, apelido);
    return m ? { providerID: m.providerID, id: m.id } : undefined;
  }
  const exato = modelos.find((m) => m.id === p && m.enabled !== false && (m.providerID === "anthropic" || m.providerID === "openai"));
  if (exato) return { providerID: exato.providerID, id: exato.id };
  const familia = familiaDe(p);
  if (familia) {
    const m = maisNovoDaFamilia(modelos, familia);
    return m ? { providerID: m.providerID, id: m.id } : undefined;
  }
  if (p.startsWith("gpt")) return { providerID: "openai", id: p };
  return undefined;
}

function variantePara(effort: string | undefined, modelo: ModelRef, modelos: readonly ModelInfo[]): string | undefined {
  if (!effort) return undefined;
  const info = modelos.find((m) => m.providerID === modelo.providerID && m.id === modelo.id);
  const ids = (info?.variants ?? []).map((v) => v.id);
  const e = effort.trim().toLowerCase();
  return ids.includes(e) ? e : undefined;
}

function idDaSessao(valor: unknown): string {
  const s = String(valor ?? "").trim();
  return s.startsWith("local_") ? s.slice("local_".length) : s;
}

function numero(valor: string | undefined): number | null {
  if (valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function resumoDeMensagem(m: Json, limite = 400): Json {
  const tipo = String(m.type ?? "?");
  let conteudo = "";
  if (tipo === "user" || tipo === "synthetic" || tipo === "system" || tipo === "shell") {
    conteudo = typeof m.text === "string" ? m.text : "";
  } else if (tipo === "assistant" && Array.isArray(m.content)) {
    conteudo = (m.content as Json[])
      .map((parte) => {
        if (parte.type === "text" && typeof parte.text === "string") return parte.text;
        if (parte.type === "tool") return `[tool: ${String(parte.tool ?? parte.name ?? "?")}]`;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  const out: Json = { id: m.id, papel: tipo, texto: conteudo.slice(0, limite) };
  const criado = (m.time as Json | undefined)?.created;
  if (typeof criado === "number") out.quando = new Date(criado).toISOString();
  return out;
}

export default Plugin.define({
  id: "gemeo",
  async setup(ctx) {
    const registros: { dispose(): Promise<void> }[] = [];
    const reservasRota = new Map<string, Promise<Json>>();

    const sessaoDe = (input: Json, context: { sessionID: string }): string => {
      const pedido = String(input.session_id ?? "self");
      return pedido === "self" ? context.sessionID : idDaSessao(pedido);
    };

    // Preparo e despacho compartilham a mesma reserva. Serializa só o mesmo chamador,
    // inclusive dois dispatches simultâneos; cada sessão continua independente.
    async function prepararRota(sessionID: string, rota: Rota, modelo?: ModelRef): Promise<Json> {
      const anterior = reservasRota.get(sessionID) ?? Promise.resolve({});
      const reserva = anterior.catch(() => ({})).then(async () => {
        const ativa = await ctx.storage.get(`rota/${sessionID}`) as { pedido?: Rota; aplicado?: ModelRef; esforco?: { valor?: string } } | undefined;
        const preparada = await ctx.storage.get(`rota-preparada/${sessionID}`) as { pedido?: Rota } | undefined;
        const reservas = await ctx.storage.get(`rotas/${sessionID}`) as Record<string, ReservaRota> | undefined;
        conferirFatia(ativa?.pedido, rota);
        conferirFatia(preparada?.pedido, rota);
        const atualizadas: Record<string, ReservaRota> = reservarFatia(reservas, rota);
        // Ausência do campo identifica reserva antiga, que só permitia o esforço exato.
        // null identifica preparo novo que ainda não selecionou modelo para despacho.
        const antiga = reservas && Object.hasOwn(reservas, rota.fatia) ? reservas[rota.fatia] : undefined;
        let reservado = antiga?.esforcoSelecionado ?? null;
        if (antiga && antiga.esforcoSelecionado === undefined) reservado = antiga.esforco;
        const ativo = ativa?.pedido?.fatia === rota.fatia && ativa.aplicado
          ? ativa.esforco?.valor ?? esforcoDoModelo(ativa.pedido, ativa.aplicado) : undefined;
        const selecionado = modelo ? esforcoDoModelo(rota, modelo) : reservado ?? ativo ?? null;
        if ((reservado !== null && reservado !== selecionado) || (ativo !== undefined && ativo !== selecionado)) {
          throw new Error("esforço selecionado fixo para a fatia; catálogo mudou: use outra fatia/tentativa");
        }
        atualizadas[rota.fatia] = { ...antiga, ...rota, esforcoSelecionado: selecionado };
        const estado = { pedido: rota, esforcoSelecionado: selecionado, aplicado: null, estado: "pendente: esta sessão não foi alterada; passe rota ao próximo despacho" };
        await ctx.storage.set(`rotas/${sessionID}`, atualizadas);
        await ctx.storage.set(`rota-preparada/${sessionID}`, estado);
        return estado;
      });
      reservasRota.set(sessionID, reserva);
      try { return await reserva; }
      finally { if (reservasRota.get(sessionID) === reserva) reservasRota.delete(sessionID); }
    }

    async function abrirSessao(input: Json, context: { sessionID: string }): Promise<Json> {
      const cwd = String(input.cwd ?? "").trim();
      const prompt = String(input.prompt ?? "").trim();
      if (!cwd) throw new Error("cwd é obrigatório");
      if (!prompt) throw new Error("prompt é obrigatório");
      if (input.model !== undefined && (typeof input.model !== "string" || !input.model.trim())) throw new Error("modelo explícito inválido; nenhum prompt enviado");
      const avisos: string[] = [];
      // A escolha pertence ao agente; o plugin valida a política e aplica antes do primeiro prompt.
      const rota = input.rota ? await lerRota(input.rota as Json) : undefined;
      let modeloDaPolitica: ModelRef | undefined;
      if (rota) {
        if (input.model !== undefined || input.effort !== undefined) throw new Error("rota e model/effort explícitos não podem competir; preserve a escolha do usuário");
        const lista = (await ctx.model.list()) as unknown;
        const modelos = (Array.isArray(lista) ? lista : ((lista as Json)?.data as unknown[]) ?? []) as readonly ModelInfo[];
        modeloDaPolitica = modeloDaRota(rota, modelos, resolverModelo);
        await conferirFonte(modeloDaPolitica);
        await prepararRota(context.sessionID, rota, modeloDaPolitica);
      }
      const ignorados = PARAMETROS_IGNORADOS.filter((k) => input[k] !== undefined);
      if (ignorados.length) avisos.push(`ignorados no OpenCode: ${ignorados.join(", ")}`);

      const sessao = await ctx.session.create({
        title: typeof input.title === "string" && input.title.trim() ? input.title : undefined,
        location: { directory: cwd },
        metadata: { gemeo: { aberta_por: context.sessionID } },
      } as Parameters<typeof ctx.session.create>[0]);
      const sessionID = sessao.id;

      let modeloUsado: ModelRef | undefined;
      let rotaConfirmada: Json | undefined;
      // Se o modelo ou o prompt falharem, a sessão recém-criada é removida: não fica órfã na barra.
      try {
        if (modeloDaPolitica && rota) {
          modeloUsado = await aplicarRotaNova(sessionID, modeloDaPolitica, ctx.session);
          const esforcoAplicado = esforcoDoModelo(rota, modeloUsado);
          if (esforcoAplicado !== rota.esforco) avisos.push(`Antigravity: esforço pedido ${rota.esforco}, aplicado ${esforcoAplicado}.`);
          rotaConfirmada = { pedido: rota, aplicado: modeloUsado,
            esforco: { valor: esforcoAplicado, representacao: rota.canal === "antigravity" ? "embutido_no_id" : "variant" },
            estado: "confirmado antes do primeiro prompt" };
          await ctx.storage.set(`rota/${sessionID}`, rotaConfirmada);
        } else if (typeof input.model === "string" && input.model.trim()) {
          const lista = (await ctx.model.list()) as unknown;
          const modelos = (Array.isArray(lista) ? lista : ((lista as Json)?.data as unknown[]) ?? []) as readonly ModelInfo[];
          const ref = resolverModelo(input.model, modelos);
          if (!ref) {
            throw new Error(`modelo explícito "${input.model}" não reconhecido; nenhum prompt enviado`);
          } else {
            const variant = variantePara(typeof input.effort === "string" ? input.effort : undefined, ref, modelos);
            if (input.effort && !variant) avisos.push(`effort "${String(input.effort)}" sem variante nesse modelo: ignorado`);
            modeloUsado = variant ? { ...ref, variant } : ref;
            await conferirFonte(modeloUsado);
            await ctx.session.switchModel({ sessionID, model: modeloUsado });
          }
        } else if (input.effort) {
          avisos.push("effort só se aplica junto com model: ignorado");
        }

        const fundo = typeof input.background === "string" && input.background.trim() ? `\n\nContexto: ${input.background.trim()}` : "";
        // Espera só a admissão do prompt (não a resposta): erro de modelo, cota ou rede volta ao chamador.
        await conferirFontePrevia(modeloUsado ?? (await ctx.session.get({ sessionID })).model);
        await ctx.session.prompt({ sessionID, text: prompt + fundo });
      } catch (erro) {
        await ctx.session.remove({ sessionID }).catch(() => undefined);
        throw new Error(`sessão não aberta (removida): ${erro instanceof Error ? erro.message : String(erro)}`);
      }

      const out: Json = { session_id: sessionID };
      if (rotaConfirmada) out.rota = rotaConfirmada;
      if (modeloUsado) out.model = modeloUsado.variant ? `${modeloUsado.providerID}/${modeloUsado.id} (${modeloUsado.variant})` : `${modeloUsado.providerID}/${modeloUsado.id}`;
      if (avisos.length) out.avisos = avisos;
      return out;
    }

    const esquemaSessao = (extra: Json = {}, required: string[] = ["session_id"]) => ({
      type: "object",
      properties: {
        session_id: { type: "string", description: '"self" para a própria sessão, ou o id (ses_...)' },
        ...extra,
      },
      required,
      additionalProperties: true,
    });

    const esquemaAbrir = {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Pasta do projeto da sessão nova (caminho absoluto)" },
        prompt: { type: "string", description: "Prompt inicial, autossuficiente" },
        title: { type: "string", description: "Nome da sessão (emoji + texto curto)" },
        model: { type: "string", description: 'Modelo: "provider/id", apelido (haiku, sonnet, opus, fable) ou id (claude-sonnet-5-5)' },
        effort: { type: "string", description: "Raciocínio: low, medium, high, xhigh ou max (vira a variante do modelo)" },
        rota: ESQUEMA_ROTA,
        background: { type: "string", description: "Contexto anexado ao fim do prompt" },
        name: { type: "string", description: "Ignorado no OpenCode" },
        context: { type: "string", description: "Ignorado no OpenCode (sempre fresh)" },
        initiation: { type: "string", description: "Ignorado no OpenCode" },
        use_worktree: { type: "boolean", description: "Ignorado no OpenCode" },
      },
      required: ["cwd", "prompt"],
      additionalProperties: true,
    };

    registros.push(
      await ctx.tool.transform((editor) => {
        editor.add({
          name: "rotear_tarefa",
          description: "Valida N1/N2/N3 e esforço pela política comum. Prepara rota para start_session/spawn_task; não troca o modelo desta sessão em andamento. Use rota no próximo despacho, ou despachar.ps1 da dupla com capacidade. Não envie prompt de teste nem abra sessão sem autorização de escopo.",
          input: ESQUEMA_ROTA,
          options: { codemode: true },
          execute: async (input, context) => {
            const rota = await lerRota(input as Json);
            const estado = await prepararRota(context.sessionID, rota);
            return { content: texto({ ...estado, rota: input }) };
          },
        });
        editor.add({
          name: "set_session_title",
          description: 'Renomeia uma sessão do OpenCode (igual ao Claude Code). session_id "self" é a própria sessão.',
          input: esquemaSessao({ title: { type: "string", description: "Novo nome: emoji + espaço + texto em minúsculas" } }, ["session_id", "title"]),
          options: { codemode: true },
          execute: async (input, context) => {
            const sessionID = sessaoDe(input as Json, context);
            const title = String((input as Json).title ?? "").trim();
            if (!title) throw new Error("title é obrigatório");
            await ctx.session.update({ sessionID, title });
            return { content: texto({ ok: true, session_id: sessionID, title }) };
          },
        });

        editor.add({
          name: "set_pinned",
          description: "Fixa ou desafixa uma sessão. O OpenCode não tem fixar na barra: o estado fica guardado no plugin e nos metadados da sessão.",
          input: esquemaSessao({ pinned: { type: "boolean" } }, ["session_id", "pinned"]),
          options: { codemode: true },
          execute: async (input, context) => {
            const sessionID = sessaoDe(input as Json, context);
            const pinned = Boolean((input as Json).pinned);
            await ctx.storage.set(`pinned/${sessionID}`, { pinned, at: new Date().toISOString() });
            try {
              const atual = await ctx.session.get({ sessionID });
              const metadata = { ...((atual.metadata as Json | undefined) ?? {}), gemeo: { ...(((atual.metadata as Json | undefined)?.gemeo as Json | undefined) ?? {}), pinned } };
              await ctx.session.update({ sessionID, metadata });
            } catch (erro) {
              console.warn("gemeo: set_pinned não gravou nos metadados", erro);
            }
            return { content: texto({ ok: true, session_id: sessionID, pinned, note: "sem fixar na barra: guardado" }) };
          },
        });

        editor.add({
          name: "archive_session",
          description: 'Arquiva uma sessão (archived: true). Renomeie para "🗄️ ..." antes, pela regra do CLAUDE.md.',
          input: esquemaSessao({ reason: { type: "string", description: "Motivo (só registrado na resposta)" } }),
          options: { codemode: true },
          execute: async (input, context) => {
            const sessionID = sessaoDe(input as Json, context);
            const arquivada = async () => Boolean(((await ctx.session.get({ sessionID })).time as Json).archived);
            await ctx.session.update({ sessionID, archived: true } as Parameters<typeof ctx.session.update>[0]);
            let via = "sdk";
            if (!(await arquivada())) {
              await arquivarPeloCli(sessionID);
              via = "cli";
              if (!(await arquivada())) throw new Error(`sessão ${sessionID} não ficou arquivada (sdk e cli)`);
            }
            const out: Json = { ok: true, session_id: sessionID, archived: true, via };
            if (typeof (input as Json).reason === "string") out.reason = (input as Json).reason;
            return { content: texto(out) };
          },
        });

        editor.add({
          name: "start_session",
          description: "Abre uma sessão nova do OpenCode na pasta cwd, com modelo e effort opcionais, e manda o prompt sem esperar. Devolve { session_id }.",
          input: esquemaAbrir,
          options: { codemode: true },
          execute: async (input, context) => ({ content: texto(await abrirSessao(input as Json, context)) }),
        });

        editor.add({
          name: "spawn_task",
          description: "Mesmo que start_session. No OpenCode não há cartão: a sessão abre direto.",
          input: esquemaAbrir,
          options: { codemode: true },
          execute: async (input, context) => ({ content: texto({ ...(await abrirSessao(input as Json, context)), note: "aberta direto" }) }),
        });

        editor.add({
          name: "SendMessage",
          description: 'Manda um prompt a outra sessão do OpenCode. `to` aceita "local_<id>" ou "<id>".',
          input: {
            type: "object",
            properties: {
              to: { type: "string", description: "Id da sessão de destino" },
              message: { type: "string" },
            },
            required: ["to", "message"],
            additionalProperties: true,
          },
          options: { codemode: true },
          execute: async (input) => {
            const sessionID = idDaSessao((input as Json).to);
            const message = String((input as Json).message ?? "");
            if (!sessionID) throw new Error("to é obrigatório");
            if (!message.trim()) throw new Error("message é obrigatório");
            await conferirFontePrevia((await ctx.session.get({ sessionID })).model);
            const admitida = await ctx.session.prompt({ sessionID, text: message });
            return { content: texto({ ok: true, session_id: sessionID, message_id: (admitida as Json | undefined)?.id ?? null }) };
          },
        });

        editor.add({
          name: "list_events",
          description: "Últimas mensagens de uma sessão, resumidas (papel + primeiros 400 caracteres). limit padrão 20.",
          input: esquemaSessao({ limit: { type: "integer", minimum: 1, maximum: 200 } }),
          options: { codemode: true },
          execute: async (input, context) => {
            const sessionID = sessaoDe(input as Json, context);
            const limite = Math.max(1, Math.min(200, Number((input as Json).limit ?? 20) || 20));
            const resposta = (await ctx.session.context({ sessionID })) as unknown;
            const mensagens = (Array.isArray(resposta) ? resposta : ((resposta as Json)?.data as unknown[]) ?? []) as Json[];
            const ultimas = mensagens.slice(-limite).map((m) => resumoDeMensagem(m));
            return { content: texto({ session_id: sessionID, total: mensagens.length, mensagens: ultimas }) };
          },
        });

        editor.add({
          name: "request_directory",
          description: "No Claude Code pede acesso a uma pasta; no OpenCode não há essa trava. Devolve ok.",
          input: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: true },
          options: { codemode: true },
          execute: async (input) => ({ content: texto({ ok: true, path: (input as Json).path, note: "no OpenCode não há trava de pasta" }) }),
        });

        editor.add({
          name: "get_usage",
          description: "No Claude Code lê o uso do plano Max; no OpenCode não há essa leitura.",
          input: { type: "object", properties: {}, additionalProperties: true },
          options: { codemode: true },
          execute: async () => ({
            content: texto({ unavailable: true, note: "no OpenCode não há leitura do Max; use recursos.ps1 ou o painel do app" }),
          }),
        });
      }),
    );

    registros.push(
      await ctx.session.hook("context", async (event) => {
        await conferirFonte(event.model);
        const modelo = `${event.model.providerID}/${event.model.id}${event.model.variant ? ` (${event.model.variant})` : ""}`;
        const rota = await ctx.storage.get(`rota/${event.sessionID}`);
        event.system.push({
          type: "text",
          text:
            `Você está no OpenCode (gêmeo do Claude Code), sessão ${event.sessionID}, modelo ${modelo}. ${NOTA_ROTEAMENTO} ` +
            "No OpenCode rotear_tarefa prepara; só start_session/spawn_task com rota confirma modelo/variante antes do primeiro prompt. Sessão existente não muda; use despachar da dupla para a execução com capacidade adequada. " +
            `Rota deste despacho: ${JSON.stringify(rota ?? null)}. ` +
            "As ferramentas do Claude Code existem aqui com os mesmos nomes (set_session_title, set_pinned, start_session, spawn_task, SendMessage, archive_session, list_events, request_directory, get_usage). " +
            "Não há `responder`: pergunta de sim/não ao usuário vai pela ferramenta `question`. O /code-review e o /cpa existem como comandos.",
        });
      }),
    );

    // Fronteiras reais, inclusive títulos, compactação e socket reutilizado.
    // Nunca troca modelo nem canal de uma rota fixa quando a fonte é travada.
    for (const fronteira of ["model.request", "http.request", "experimental.ws.handshake", "experimental.ws.send"] as const) {
      registros.push(await ctx.session.hook(fronteira, async (event) => { await conferirFonte(event.model); }));
    }

    registros.push(
      await ctx.session.hook(
        "http.response",
        async (event) => {
          const headers: Record<string, string> = {};
          event.response.headers.forEach((valor, nome) => {
            const n = nome.toLowerCase();
            // x-codex-turn-state é estado opaco do turno (~1 KB), sem uso aqui.
            if (n.startsWith("x-codex-") && n !== "x-codex-turn-state") headers[n] = valor;
          });
          if (Object.keys(headers).length === 0) return;
          const agora = new Date();
          const janela = (nome: "primary" | "secondary") => {
            const reset = numero(headers[`x-codex-${nome}-reset-after-seconds`]);
            return {
              used_percent: numero(headers[`x-codex-${nome}-used-percent`]),
              resets_at: reset === null ? null : new Date(agora.getTime() + reset * 1000).toISOString(),
            };
          };
          const cota: Json = { at: agora.toISOString(), headers, primary: janela("primary"), secondary: janela("secondary") };
          // Nem toda resposta traz percentual (às vezes só x-codex-turn-state): nesse caso o último
          // percentual visto fica, com a hora em que veio.
          const temPercentual = Object.keys(headers).some((h) => h.includes("-used-percent") || h.includes("-reset-after-"));
          if (temPercentual) cota.quota_at = cota.at;
          else {
            const anterior = await readFile(COTA_CHATGPT, "utf8").then((t) => JSON.parse(t) as Json).catch(() => undefined);
            if (anterior?.quota_at) {
              cota.primary = anterior.primary;
              cota.secondary = anterior.secondary;
              cota.quota_at = anterior.quota_at;
            } else cota.quota_at = null;
          }
          try {
            await mkdir(dirname(COTA_CHATGPT), { recursive: true });
            // Grava num temporário e renomeia: duas sessões GPT respondendo juntas não deixam o JSON pela metade.
            const tmp = `${COTA_CHATGPT}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(tmp, JSON.stringify(cota, null, 2) + "\n", "utf8");
            await rename(tmp, COTA_CHATGPT);
          } catch (erro) {
            console.warn("gemeo: não gravou cota-chatgpt.json", erro);
          }
        },
        { providerID: "openai" },
      ),
    );

    registros.push(
      await ctx.command.transform((editor) => {
        editor.add({
          name: "fontes",
          description: "Lista ou liga/desliga fontes globais: /fontes [desligar|ligar <id>]. Sem inferência.",
          execute: async ({ sessionID, prompt }) => {
            let text: string;
            try { text = await executarFontes(prompt.text ?? ""); }
            catch (e) { text = `⚠️ ${e instanceof Error ? e.message : String(e)}`; }
            // resume:false registra a resposta local sem acordar o modelo travado.
            await ctx.session.synthetic({ sessionID, text, resume: false });
          },
        });
        editor.add({
          name: "cpa",
          description: "Commit, push e arquivar a sessão (skill cpa)",
          execute: async ({ sessionID, prompt, delivery }) => {
            await conferirFontePrevia(prompt.model ?? (await ctx.session.get({ sessionID })).model);
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              text: `Siga a skill cpa. Argumentos: ${prompt.text ?? ""}`.trimEnd(),
              delivery,
            });
          },
        });
      }),
    );

    return async () => {
      for (const registro of registros) {
        try {
          await registro.dispose();
        } catch {
          // descarregar é o melhor esforço
        }
      }
    };
  },
});
