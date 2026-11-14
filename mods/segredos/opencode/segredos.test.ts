// Testes do plugin segredos do OpenCode. Rodar: node --test segredos.test.ts (nesta pasta).
// O plugin é carregado de verdade; só o ctx é de mentira (captura o hook execute.before).
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import plugin from "./segredos.ts";
import { isSecretPath, revealsSecret } from "../hooks/rules.ts";

type Hook = (event: { tool: string; input?: Record<string, unknown> }) => Promise<void>;

async function carregar() {
  let hook: Hook | undefined;
  let nome = "";
  let descartado = false;
  const ctx = {
    tool: {
      hook: async (n: string, cb: Hook) => {
        nome = n;
        hook = cb;
        return { dispose: async () => { descartado = true; } };
      },
    },
  };
  const limpar = await (plugin as any).setup(ctx);
  assert.equal((plugin as any).id, "segredos");
  assert.equal(nome, "execute.before");
  return {
    chamar: (tool: string, input: Record<string, unknown>) => hook!({ tool, input }),
    descarregar: async () => { await limpar(); return descartado; },
  };
}

async function recusado(h: Awaited<ReturnType<typeof carregar>>, tool: string, input: Record<string, unknown>) {
  try { await h.chamar(tool, input); return false; }
  catch (e) { assert.match((e as Error).message, /^segredos:/); return true; }
}

test("registra o hook e descarrega", async () => {
  const h = await carregar();
  assert.equal(await h.descarregar(), true);
});

test("read: nome secreto recusa, o resto passa", async () => {
  const h = await carregar();
  for (const p of ["D:\\p\\.env", "/home/p/.ssh/id_vm", "cert.pem", "restic-recovery-key.txt", "credentials.json", ".env.local"]) {
    assert.equal(await recusado(h, "read", { filePath: p }), true, p);
  }
  assert.equal(await recusado(h, "read", { file_path: "x/.env" }), true);
  assert.equal(await recusado(h, "read", { path: "x/.env" }), true);
  for (const p of [".env.example", "id_vm.pub", "README.md", "keys.ts"]) {
    assert.equal(await recusado(h, "read", { filePath: p }), false, p);
  }
});

test("shell e bash: mostrar não, usar sim", async () => {
  const h = await carregar();
  for (const tool of ["shell", "bash", "Bash"]) {
    assert.equal(await recusado(h, tool, { command: "cat .env" }), true);
    assert.equal(await recusado(h, tool, { command: "ls && Get-Content \"C:\\x\\restic-recovery-key.txt\"" }), true);
    assert.equal(await recusado(h, tool, { command: "echo $(cat ~/.ssh/id_vm)" }), true);
    assert.equal(await recusado(h, tool, { command: "ssh -i ~/.ssh/id_vm vm uptime" }), false);
    assert.equal(await recusado(h, tool, { command: "cp .env .env.bak" }), false);
    assert.equal(await recusado(h, tool, { command: "cat .env.example" }), false);
  }
});

test("grep: caminho e filtro de arquivo; o padrão buscado não conta", async () => {
  const h = await carregar();
  assert.equal(await recusado(h, "grep", { pattern: "KEY", path: ".env" }), true);
  assert.equal(await recusado(h, "grep", { pattern: "KEY", include: ".env*" }), true);
  assert.equal(await recusado(h, "grep", { pattern: "KEY", glob: "**/*.pem" }), true);
  assert.equal(await recusado(h, "grep", { pattern: "\\.env", path: "src" }), false);
  assert.equal(await recusado(h, "grep", { pattern: "credentials", include: "*.ts" }), false);
  assert.equal(await recusado(h, "grep", { pattern: "KEY", include: "*.json" }), false);
});

test("glob: curingas que alcançam segredo recusam", async () => {
  const h = await carregar();
  for (const p of [".env*", "**/.env*", "*.env", "**/id_*", "*credentials*", "**/*.pem", "*.key", "**/*recovery-key*", "**/.env", ".env.{local,prod}"]) {
    assert.equal(await recusado(h, "glob", { pattern: p }), true, p);
  }
  // Casos que dependem da lógica de curinga (não do nome concreto).
  for (const p of ["*.{pem,key}", "{.env,.env.local}", "{id_rsa,id_ed25519}", "{credentials,secrets}.json", ".[e]nv*", "*.p[e]m", "{.env,src/.env}",
    "{.env,src/.env*}", ".env.dev*", ".env.{dev,prod}", "id_ecdsa*", "secrets.toml*", "secrets.yml*", "credentials.yaml*", "ca-*.{pem,key}", "*.pem*",
    "src/{a,b/{.env,x}}"]) {
    assert.equal(await recusado(h, "glob", { pattern: p }), true, p);
  }
  assert.equal(await recusado(h, "glob", { pattern: "*", path: "D:\\p\\.env" }), true);
  for (const p of ["*", "*.*", "**/*.ts", "src/**/*.md", ".*ignore", "*.env.example", "keys.ts", "**/package.json", "*.json", "*.txt", "*.yaml", "*.local", "**/*.json", "{*.json,*.txt}", "src/{a,b}/*.ts", "*.[jt]s", "credentials-doc.md.bak2"]) {
    assert.equal(await recusado(h, "glob", { pattern: p }), false, p);
  }
});

test("outras ferramentas não são tocadas", async () => {
  const h = await carregar();
  assert.equal(await recusado(h, "write", { filePath: ".env", content: "x" }), false);
  assert.equal(await recusado(h, "edit", { filePath: ".env" }), false);
  assert.equal(await recusado(h, "read", {}), false);
});

test("paridade com hooks/rules.ts do mod do Claude Code", async () => {
  const h = await carregar();
  const nomes = [
    ".env", ".env.local", ".env.example", ".env.sample", ".env.template", ".env.dist", "x/.env.production", "id_rsa", "id_ed25519",
    "id_vm.pub", "a.pem", "a.key", "a.p12", "a.pfx", "a.kdbx", "a.ppk", "restic-recovery-key.txt", "Recovery-Key.md", "credentials",
    "credentials.json", "credentials.json.bak", "secret.json", "secrets.yaml", "secrets.toml", "secrets.md", "secret.txt", "environment.md",
    "keys.ts", "README.md", "D:\\p\\.env", "'/x/.env'", "\"C:\\a\\id_vm\"", "dir/", "", ".envrc", "myenv", "ID_RSA", ".ENV",
  ];
  for (const n of nomes) {
    assert.equal(await recusado(h, "read", { filePath: n }), isSecretPath(n), `read ${JSON.stringify(n)}`);
  }
  const comandos = [
    "cat .env", "type .env", "grep X /srv/app/.env.production", "Get-Content id_rsa", "head -n1 a.pem", "ssh -i id_vm vm", "cp .env .env.bak",
    "cat README.md | grep env", "echo hi >> .env", "ls && cat credentials.json", "echo $(cat id_rsa)", "sed -n 1p .env", "base64 a.key",
    "git status", "jq . secrets.json", "less .env.example", "cat -n .env", "bat `cat .env`", "C:\\bin\\cat.exe .env",
  ];
  for (const c of comandos) {
    assert.equal(await recusado(h, "shell", { command: c }), revealsSecret(c), `shell ${c}`);
  }
});

test("as regexes embutidas são as mesmas do rules.ts", () => {
  const regexes = (arquivo: string) =>
    readFileSync(new URL(arquivo, import.meta.url), "utf8").split(/\r?\n/)
      .map((l) => l.trim().replace(/[,;]$/, ""))
      .filter((l) => l.startsWith("/") && l.endsWith("/i"))
      .sort();
  const mod = regexes("../hooks/rules.ts");
  const plugin_ = regexes("./segredos.ts");
  assert.ok(mod.length >= 7, `poucas regexes lidas do mod: ${mod.length}`);
  // O plugin tem, além das do mod, só as regexes de curinga (que não terminam em /i com barra no nome).
  for (const r of mod) assert.ok(plugin_.includes(r), `falta no plugin: ${r}`);
  assert.deepEqual(plugin_.filter((r) => !mod.includes(r)), [], "o plugin tem regex que o mod não tem");
});
