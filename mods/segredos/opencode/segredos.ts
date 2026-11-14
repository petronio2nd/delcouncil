// Mod `segredos` no OpenCode: recusa ler ou mostrar arquivo de senha e chave, pelo nome do arquivo,
// no read, no grep, no glob e no shell. Mesma regra do mod do Claude Code (../hooks/rules.ts).
//
// Arquivo único e sem import relativo de propósito: o `dupla` (opencode-comum.ps1) copia só este
// arquivo para a pasta de config isolada do executor, e um import quebraria lá. Por isso as regras
// vão embutidas; `segredos.test.ts` confere que dão o mesmo veredito que o rules.ts do mod.
// Instalação: `instalar.ps1 -OpenCode` copia para ~/.config/opencode/plugins/segredos.ts.
//
// Limites herdados do mod do Claude Code (decisão de manter a paridade): o shell só olha o primeiro
// verbo de cada trecho (não vê `sudo cat .env`, `$(<.env)` nem `xargs cat < .env`); o grep sem
// filtro de arquivo, ou com um diretório como alvo, ainda alcança o conteúdo de um .env. A rede de
// baixo é a lista `deny` de `read` do opencode.json e a trava do dupla; este plugin é a camada a mais.
//
// A recusa é um `throw` no hook `execute.before`; a mensagem começa por "segredos:" (o
// testar-trava-opencode.ps1 usa esse prefixo para provar que ESTE plugin carregou, já que a trava
// de `read` do opencode.json também nega por conta própria).

import type { Plugin } from "@opencode/plugin";

// ---- Regras (espelho de ../hooks/rules.ts) ----

const SECRET_NAMES = [
  /^\.env(\.(?!example$|sample$|template$|dist$)[\w.-]+)?$/i,
  /^id_[a-z0-9_-]+$/i,
  /\.(pem|key|p12|pfx|kdbx|ppk)$/i,
  /recovery-key/i,
  /^credentials(\.[\w]+)?$/i,
  /^secrets?\.(json|ya?ml|toml|txt|env)$/i,
];

function baseName(path: string): string {
  const clean = path.replace(/^['"]|['"]$/g, "").replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() ?? clean;
}

function isSecretPath(path: string): boolean {
  const name = baseName(path);
  return name !== "" && SECRET_NAMES.some((re) => re.test(name));
}

const SHOWS_CONTENT =
  /^(cat|type|more|less|head|tail|nl|tac|grep|egrep|fgrep|rg|sed|awk|cut|sort|uniq|strings|xxd|od|hexdump|base64|diff|cmp|jq|yq|bat|gc|Get-Content|Select-String|Format-Hex|Import-Csv|ConvertFrom-Json)$/i;

function revealsSecret(command: string): boolean {
  return command
    .split(/&&|\|\||[;|\n`()]|\$\(/)
    .map((part) => part.trim())
    .some((part) => {
      const words = part.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      const verb = (words[0] ?? "").replace(/^.*[\\/]/, "");
      if (!SHOWS_CONTENT.test(verb)) return false;
      return words.slice(1).some((word) => !word.startsWith("-") && isSecretPath(word));
    });
}

// ---- Extensão do OpenCode: curingas (glob do grep e da ferramenta glob) ----

// Curinga que mira segredo: o texto fixo do nome tem um dos trechos abaixo (.env*, **/id_*, *.pem,
// *credentials*) E o curinga casa com algum nome-sonda. `*`, `*.*`, `*.json`, `*.txt` e `*.ts`
// seguem livres: listar tudo não é pedir o segredo, e o conteúdo é barrado pelo nome no read.
const TRECHOS = [".env", "id_", ".pem", ".key", ".p12", ".pfx", ".kdbx", ".ppk", "recovery-key", "credentials", "secret.", "secrets."];
const SONDAS = [
  ".env", ".env.local", ".env.production", "id_rsa", "id_ed25519", "id_vm", "cert.pem", "server.key",
  "store.p12", "store.pfx", "vault.kdbx", "chave.ppk", "restic-recovery-key.txt", "credentials", "credentials.json",
  "secrets.json", "secret.yaml",
];

function globParaRegex(g: string): RegExp {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") { while (g[i + 1] === "*") i++; re += "[^\\\\/]*"; }
    else if (c === "?") re += "[^\\\\/]";
    else if (c === "[") {
      const fim = g.indexOf("]", i + 1);
      if (fim === -1) re += "\\[";
      else { re += "[" + g.slice(i + 1, fim).replace(/^!/, "^").replace(/\\/g, "\\\\") + "]"; i = fim; }
    } else re += c.replace(/[.+^$|(){}\\\]]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i");
}

// Expande {a,b} (inclusive aninhado e com barra dentro) em padrões sem chaves, no máximo 64.
function expandirChaves(g: string): string[] {
  const ini = g.indexOf("{");
  if (ini === -1) return [g];
  let nivel = 0;
  let fim = -1;
  const cortes: number[] = [];
  for (let i = ini; i < g.length; i++) {
    if (g[i] === "{") nivel++;
    else if (g[i] === "}" && --nivel === 0) { fim = i; break; }
    else if (g[i] === "," && nivel === 1) cortes.push(i);
  }
  if (fim === -1) return [g];
  const pontas = [ini, ...cortes, fim];
  const saida: string[] = [];
  for (let k = 0; k < pontas.length - 1 && saida.length < 64; k++) {
    for (const resto of expandirChaves(g.slice(pontas[k] + 1, pontas[k + 1]) + g.slice(fim + 1))) {
      saida.push(g.slice(0, ini) + resto);
      if (saida.length >= 64) break;
    }
  }
  return saida;
}

// O nome concreto (regra do mod) e, para curinga, o nome com cada curinga trocado por nada, por uma letra e
// pelo primeiro item da classe; mais o casamento com as sondas quando o texto fixo cita um segredo.
function isSecretGlob(padrao: string): boolean {
  if (isSecretPath(padrao)) return true;
  return expandirChaves(padrao.replace(/^['"]|['"]$/g, "")).some((alt) => {
    if (isSecretPath(alt)) return true;
    const nome = baseName(alt);
    if (!/[*?[]/.test(nome)) return false;
    const classe = nome.replace(/\[!?([^\]])[^\]]*\]/g, "$1");
    for (const sub of ["", "a", "_"]) {
      if (isSecretPath(classe.replace(/[*?]+/g, sub))) return true;
    }
    if (!TRECHOS.some((t) => classe.replace(/[*?]/g, "").toLowerCase().includes(t))) return false;
    const re = globParaRegex(nome);
    return SONDAS.some((s) => re.test(s));
  });
}

// ---- Ferramenta do OpenCode -> recusa ----

const RECUSA =
  "segredos: o conteúdo de arquivos de senha e chave não é lido nem mostrado. " +
  "Dá para usar o arquivo (ssh -i, carregar o .env num comando), gravar, copiar e mover; para conferir um valor, peça ao usuário.";

const texto = (input: Record<string, unknown>, ...chaves: string[]): string[] =>
  chaves.map((k) => input[k]).filter((v): v is string => typeof v === "string" && v !== "");

// A recusa, ou undefined quando a chamada pode seguir.
function recusa(ferramenta: string, input: Record<string, unknown>): string | undefined {
  switch (ferramenta.toLowerCase()) {
    case "read":
      return texto(input, "filePath", "file_path", "path").some(isSecretPath) ? RECUSA : undefined;
    case "grep":
      // `pattern` do grep é o que se procura dentro dos arquivos, não um caminho.
      return texto(input, "path", "include", "glob").some(isSecretGlob) ? RECUSA : undefined;
    case "glob":
      return texto(input, "pattern", "path").some(isSecretGlob) ? RECUSA : undefined;
    case "shell":
    case "bash":
      return texto(input, "command").some(revealsSecret) ? RECUSA : undefined;
    default:
      return undefined;
  }
}

const Segredos: Plugin.Plugin = {
  id: "segredos",
  setup: async (ctx) => {
    const registro = await ctx.tool.hook("execute.before", async (event) => {
      const motivo = recusa(String(event.tool), (event.input ?? {}) as Record<string, unknown>);
      if (motivo) throw new Error(motivo);
    });
    return async () => {
      await registro.dispose();
    };
  },
};

export default Segredos;
