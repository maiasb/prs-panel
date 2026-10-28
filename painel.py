#!/usr/bin/env python3
"""Painel local de PRs abertos da conta GitHub (usa o `gh` já autenticado).

Mostra os seus PRs e os que aguardam a sua revisão, com diff e botão de aprovar.
Uso: python3 painel.py [porta]   (padrão 8765) — abre o navegador sozinho.
"""
import json
import re
import secrets
import subprocess
import sys
import threading
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
TOKEN = secrets.token_urlsafe(24)  # barra POST vindo de outras páginas abertas no navegador
HOSTS_OK = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
CAMPOS = "repository,title,url,number,createdAt,updatedAt,isDraft,labels,commentsCount,author"
ACOES = {  # rota -> comando do gh
    "/api/aprovar": ("pr", "review", "--approve"),
    "/api/fechar": ("pr", "close"),
}
REPO_RE = re.compile(r"^[\w.-]+/[\w.-]+$")
LIMITE_DIFF = 400_000

PAGINA = """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel de PRs</title>
<style>
:root{
  --bg:#0c0e12;--superficie:#13161c;--elevado:#1a1e26;--linha:#232831;--linha2:#2f3540;
  --txt:#e9ebef;--mudo:#8d95a3;--fraco:#5d6573;
  --acento:#9aa5ff;--acento-bg:rgba(154,165,255,.12);
  --ok:#4ac28a;--erro:#ff6b6b;--aviso:#e2b04a;--rascunho:#6b7382;
  --raio:12px;
}
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--txt);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--acento);outline-offset:2px;border-radius:6px}
.pagina{max-width:1040px;margin:0 auto;padding:0 24px 64px}

/* topo */
.topo{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:36px 0 20px}
.topo h1{margin:0;font-size:26px;font-weight:650;letter-spacing:-.02em}
.topo p{margin:2px 0 0;color:var(--mudo);font-size:13px}

/* botões */
button{font:inherit;font-size:13px;font-weight:500;color:var(--txt);background:var(--elevado);
  border:1px solid var(--linha2);border-radius:8px;padding:6px 12px;cursor:pointer;
  transition:background .12s,border-color .12s,color .12s}
button:hover{border-color:var(--fraco)}
button:disabled{opacity:.55;cursor:default}
button.suave{background:transparent;border-color:transparent;color:var(--mudo)}
button.suave:hover{background:var(--elevado);color:var(--txt)}
button.ok{color:var(--ok);border-color:rgba(74,194,138,.4);background:rgba(74,194,138,.08)}
button.ok:hover{border-color:var(--ok)}
button.ok.sim{background:var(--ok);color:#06241a;border-color:var(--ok)}
button.perigo{background:transparent;border-color:transparent;color:var(--mudo)}
button.perigo:hover{color:var(--erro);background:rgba(255,107,107,.08)}
button.perigo.sim{background:var(--erro);color:#2b0807;border-color:var(--erro)}

/* barra de filtros */
.barra{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:28px}
#busca{flex:1 1 260px;min-width:0;background:var(--superficie);color:var(--txt);border:1px solid var(--linha);
  border-radius:10px;padding:9px 14px;font:inherit;font-size:14px}
#busca::placeholder{color:var(--fraco)}
#busca:focus{outline:none;border-color:var(--acento)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;gap:8px;align-items:center;border-radius:999px;padding:6px 14px;
  background:var(--superficie);border:1px solid var(--linha);color:var(--mudo)}
.chip b{font-weight:600;color:var(--txt)}
.chip[aria-pressed=true]{background:var(--acento-bg);border-color:rgba(154,165,255,.5);color:var(--acento)}
.chip[aria-pressed=true] b{color:var(--acento)}

/* blocos */
.bloco{margin-bottom:36px}
.bloco-titulo{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:17px;font-weight:600}
.bloco-titulo .n{font-size:12px;font-weight:600;color:var(--mudo);background:var(--elevado);border-radius:999px;padding:1px 9px}
.bloco.destaque .bloco-titulo .n{background:var(--acento-bg);color:var(--acento)}
.lista{background:var(--superficie);border:1px solid var(--linha);border-radius:var(--raio);overflow:hidden}
.bloco.destaque .lista{border-color:rgba(154,165,255,.35)}
.repo{display:flex;align-items:center;justify-content:space-between;padding:9px 18px;
  background:var(--elevado);font-size:13px;color:var(--mudo);border-top:1px solid var(--linha)}
.repo:first-child{border-top:0}
.repo a{color:var(--txt);font-weight:550}.repo a:hover{color:var(--acento)}

/* linha de PR */
.pr{display:grid;grid-template-columns:76px 1fr auto;gap:0 16px;align-items:center;
  padding:14px 18px;border-top:1px solid var(--linha)}
.repo + .pr{border-top:0}
.pr:hover{background:rgba(255,255,255,.02)}
.idade{text-align:right}
.idade b{display:block;font-size:20px;font-weight:600;line-height:1.1;letter-spacing:-.02em}
.idade small{font-size:11px;color:var(--fraco)}
.idade.velho b{color:var(--aviso)}
.corpo{min-width:0}
.titulo-pr{display:flex;gap:10px;align-items:baseline;font-weight:550}
.titulo-pr a{overflow-wrap:anywhere}.titulo-pr a:hover{color:var(--acento)}
.ponto{flex:none;width:8px;height:8px;border-radius:50%;background:var(--ok);transform:translateY(-1px)}
.ponto.rascunho{background:var(--rascunho)}.ponto.conflito{background:var(--erro)}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;margin-top:3px;color:var(--mudo);font-size:12.5px}
.tag{border-radius:6px;padding:0 7px;font-size:11.5px;font-weight:550;background:var(--elevado);color:var(--mudo)}
.tag.conflito{background:rgba(255,107,107,.12);color:var(--erro)}
.tag.parado{background:rgba(226,176,74,.12);color:var(--aviso)}
.acoes{display:flex;gap:6px;align-items:center}
.msg{font-size:12px;color:var(--mudo)}.msg.erro{color:var(--erro);max-width:260px}
.vazio{padding:28px 18px;color:var(--mudo);text-align:center}
.erro-geral{padding:20px;border:1px solid rgba(255,107,107,.4);border-radius:var(--raio);color:var(--erro);white-space:pre-wrap}

/* diff */
#modal{position:fixed;inset:0;background:rgba(5,7,10,.78);display:none;z-index:5;padding:3vh 3vw}
#modal.aberto{display:block}
.caixa{background:var(--bg);border:1px solid var(--linha2);border-radius:var(--raio);height:100%;
  display:flex;flex-direction:column;overflow:hidden}
.caixa-topo{display:flex;align-items:center;gap:12px;padding:14px 18px;background:var(--superficie);border-bottom:1px solid var(--linha)}
.caixa-topo h3{margin:0;font-size:15px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stat-add{color:var(--ok)}.stat-del{color:var(--erro)}
#diff{flex:1;overflow:auto;padding:8px 0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
#diff div{padding:0 18px;white-space:pre;min-width:max-content}
#diff .add{background:rgba(74,194,138,.13)}
#diff .del{background:rgba(255,107,107,.13)}
#diff .hunk{color:var(--acento);background:var(--acento-bg);margin-top:4px}
#diff .arq{position:sticky;top:-8px;color:var(--txt);font-weight:600;background:var(--elevado);
  border-top:1px solid var(--linha);margin-top:16px;padding-top:7px;padding-bottom:7px}
#diff .meta2{color:var(--fraco)}

@media (max-width:640px){
  .pagina{padding:0 16px 48px}
  .topo{padding-top:24px}
  .pr{grid-template-columns:1fr;gap:8px}
  .idade{text-align:left;display:flex;gap:6px;align-items:baseline}
  .idade b{font-size:14px}
  .acoes{flex-wrap:wrap}
  #modal{padding:0}.caixa{border-radius:0}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body>
<div class="pagina">
  <header class="topo">
    <div><h1>Pull requests</h1><p id="resumo">Carregando…</p></div>
    <button id="atualizar">Atualizar</button>
  </header>
  <div class="barra">
    <input id="busca" type="search" placeholder="Buscar por título, repositório ou autor" aria-label="Buscar PRs">
    <div class="chips" id="chips"></div>
  </div>
  <main id="conteudo"></main>
</div>
<div id="modal" role="dialog" aria-modal="true" aria-labelledby="m-titulo"><div class="caixa">
  <div class="caixa-topo">
    <h3 id="m-titulo"></h3><span id="m-stat" class="msg"></span><span id="m-msg" class="msg"></span>
    <span id="m-acao" class="acoes"></span><button id="m-fechar" class="suave">Fechar diff</button>
  </div>
  <div id="diff"></div>
</div></div>
<script>
const TOKEN = "__TOKEN__";
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const dias = iso => Math.floor((Date.now() - new Date(iso)) / 864e5);
const idade = d => d < 1 ? ["hoje", ""] : d < 30 ? [d, "dias"] : d < 365 ? [Math.floor(d / 30), "meses"] : [Math.floor(d / 365), "anos"];
const PARADO = 30;

let dados = { meus: [], revisao: [] };
const filtro = { escopo: "todos", conflito: false, parado: false, busca: "" };

async function api(url, corpo) {
  const r = await fetch(url, corpo ? { method: "POST", headers: { "X-Painel-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {});
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || r.statusText);
  return d;
}

// Botão de duas etapas: o primeiro clique pede confirmação, o segundo executa.
const ACOES = {
  aprovar: { rotulo: "Aprovar", confirma: "Confirmar aprovação", andando: "Aprovando…", feito: "Aprovado ✓", rota: "/api/aprovar", cls: "ok" },
  fechar: { rotulo: "Fechar PR", confirma: "Confirmar fechamento", andando: "Fechando…", feito: "Fechado ✓", rota: "/api/fechar", cls: "perigo" },
};
function botaoAcao(tipo, p, msg, aoConcluir) {
  const a = ACOES[tipo], b = el("button", a.cls, a.rotulo);
  let timer;
  b.onclick = async () => {
    if (!b.classList.contains("sim")) {
      b.classList.add("sim"); b.textContent = a.confirma;
      timer = setTimeout(() => { b.classList.remove("sim"); b.textContent = a.rotulo; }, 5000);
      return;
    }
    clearTimeout(timer); b.disabled = true; b.textContent = a.andando;
    try {
      await api(a.rota, { repo: p.repository.nameWithOwner, n: p.number });
      b.textContent = a.feito; msg.className = "msg"; msg.textContent = ""; aoConcluir && aoConcluir();
    } catch (e) {
      b.disabled = false; b.classList.remove("sim"); b.textContent = a.rotulo;
      msg.className = "msg erro"; msg.textContent = e.message;
    }
  };
  return b;
}

function linhaDiff(l) {
  const d = el("div", null, l || " ");
  if (l.startsWith("diff --git")) d.className = "arq";
  else if (l.startsWith("@@")) d.className = "hunk";
  else if (/^(index |--- |\\+\\+\\+ |new file|deleted file|similarity|rename|old mode|new mode)/.test(l)) d.className = "meta2";
  else if (l[0] === "+") d.className = "add";
  else if (l[0] === "-") d.className = "del";
  return d;
}

async function abrirDiff(p, podeAprovar) {
  $("m-titulo").textContent = `${p.repository.nameWithOwner} #${p.number} · ${p.title}`;
  $("m-msg").textContent = ""; $("m-stat").replaceChildren(); $("m-acao").replaceChildren();
  if (podeAprovar) $("m-acao").append(botaoAcao("aprovar", p, $("m-msg"), carregar));
  $("m-acao").append(botaoAcao("fechar", p, $("m-msg"), () => { fecharDiff(); setTimeout(carregar, 1500); }));
  $("diff").replaceChildren(el("div", "msg", "Carregando diff…"));
  $("modal").classList.add("aberto");
  try {
    const d = await api(`/api/diff?repo=${encodeURIComponent(p.repository.nameWithOwner)}&n=${p.number}`);
    const linhas = d.diff.split("\\n");
    const frag = document.createDocumentFragment();
    let add = 0, del = 0;
    for (const l of linhas) {
      if (l[0] === "+" && !l.startsWith("+++")) add++;
      else if (l[0] === "-" && !l.startsWith("---")) del++;
      frag.append(linhaDiff(l));
    }
    if (d.truncado) frag.append(el("div", "msg", "Diff truncado. Abra o PR no GitHub para ver o restante."));
    $("diff").replaceChildren(frag);
    $("m-stat").append(el("span", "stat-add", "+" + add), " ", el("span", "stat-del", "−" + del));
  } catch (e) { $("diff").replaceChildren(el("div", "erro-geral", e.message)); }
}
const fecharDiff = () => $("modal").classList.remove("aberto");
$("m-fechar").onclick = fecharDiff;
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharDiff(); });

function linhaPR(p, podeAprovar) {
  const conflito = p.mergeable === "CONFLICTING", velho = dias(p.updatedAt) > PARADO;
  const box = el("div", "pr");
  const [valor, unidade] = idade(dias(p.updatedAt));
  const id = el("div", "idade" + (velho ? " velho" : ""));
  id.append(el("b", null, valor), el("small", null, unidade || "atualizado"));
  id.title = "Tempo desde a última atualização do PR";

  const corpo = el("div", "corpo"), t = el("div", "titulo-pr");
  const a = el("a", null, p.title); a.href = p.url; a.target = "_blank"; a.rel = "noopener";
  t.append(el("span", "ponto" + (conflito ? " conflito" : p.isDraft ? " rascunho" : "")), a);

  const meta = el("div", "meta");
  meta.append(el("span", null, "#" + p.number));
  if (podeAprovar && p.author) meta.append(el("span", null, "de " + p.author.login));
  if (conflito) { const c = el("span", "tag conflito", "Conflito na branch"); c.title = "A branch tem conflitos com a base e não pode ser mesclada até resolver"; meta.append(c); }
  if (p.isDraft) meta.append(el("span", "tag", "Rascunho"));
  if (velho) meta.append(el("span", "tag parado", "Parado"));
  for (const l of p.labels) meta.append(el("span", "tag", l.name));
  const [v2, u2] = idade(dias(p.createdAt));
  meta.append(el("span", null, "aberto " + (u2 ? `há ${v2} ${u2}` : "hoje")));
  if (p.commentsCount) meta.append(el("span", null, p.commentsCount + (p.commentsCount > 1 ? " comentários" : " comentário")));
  corpo.append(t, meta);

  const acoes = el("div", "acoes"), msg = el("span", "msg");
  const depois = () => setTimeout(carregar, 1500);
  const bd = el("button", "suave", "Ver diff"); bd.onclick = () => abrirDiff(p, podeAprovar);
  acoes.append(bd);
  if (podeAprovar) acoes.append(botaoAcao("aprovar", p, msg, depois));
  acoes.append(botaoAcao("fechar", p, msg, depois), msg);

  box.append(id, corpo, acoes);
  return box;
}

function bloco(titulo, prs, podeAprovar, vazio, destaque) {
  const sec = el("section", "bloco" + (destaque ? " destaque" : ""));
  const h = el("h2", "bloco-titulo", titulo); h.append(el("span", "n", prs.length));
  const lista = el("div", "lista");
  if (!prs.length) lista.append(el("div", "vazio", vazio));
  const porRepo = {};
  for (const p of prs) (porRepo[p.repository.nameWithOwner] ||= []).push(p);
  const repos = Object.keys(porRepo).sort((a, b) => porRepo[b].length - porRepo[a].length || a.localeCompare(b));
  for (const nome of repos) {
    const cab = el("div", "repo"), link = el("a", null, nome);
    link.href = `https://github.com/${nome}/pulls`; link.target = "_blank"; link.rel = "noopener";
    cab.append(link, el("span", null, porRepo[nome].length + (porRepo[nome].length > 1 ? " PRs" : " PR")));
    lista.append(cab);
    for (const p of porRepo[nome].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) lista.append(linhaPR(p, podeAprovar));
  }
  sec.append(h, lista);
  return sec;
}

function desenharChips() {
  const todos = [...dados.revisao, ...dados.meus];
  const itens = [
    { rot: "Todos", n: todos.length, on: filtro.escopo === "todos", clique: () => filtro.escopo = "todos" },
    { rot: "Para revisar", n: dados.revisao.length, on: filtro.escopo === "revisao", clique: () => filtro.escopo = filtro.escopo === "revisao" ? "todos" : "revisao" },
    { rot: "Meus", n: dados.meus.length, on: filtro.escopo === "meus", clique: () => filtro.escopo = filtro.escopo === "meus" ? "todos" : "meus" },
    { rot: "Com conflito", n: todos.filter(p => p.mergeable === "CONFLICTING").length, on: filtro.conflito, clique: () => filtro.conflito = !filtro.conflito },
    { rot: "Parados", n: todos.filter(p => dias(p.updatedAt) > PARADO).length, on: filtro.parado, clique: () => filtro.parado = !filtro.parado },
  ];
  $("chips").replaceChildren(...itens.map(i => {
    const b = el("button", "chip"); b.setAttribute("aria-pressed", i.on);
    b.append(i.rot, el("b", null, i.n));
    b.onclick = () => { i.clique(); render(); };
    return b;
  }));
}

function render() {
  desenharChips();
  const q = filtro.busca.toLowerCase();
  const passa = p => (!filtro.conflito || p.mergeable === "CONFLICTING") && (!filtro.parado || dias(p.updatedAt) > PARADO)
    && (!q || `${p.title} ${p.repository.nameWithOwner} ${p.author?.login || ""}`.toLowerCase().includes(q));
  const filtrando = filtro.conflito || filtro.parado || q;
  const alvo = $("conteudo"); alvo.replaceChildren();
  if (filtro.escopo !== "meus")
    alvo.append(bloco("Aguardando sua revisão", dados.revisao.filter(passa), true,
      filtrando ? "Nenhum PR com esses filtros." : "Nenhum PR aguardando sua revisão.", true));
  if (filtro.escopo !== "revisao")
    alvo.append(bloco("Seus PRs abertos", dados.meus.filter(passa), false,
      filtrando ? "Nenhum PR com esses filtros." : "Você não tem PRs abertos."));
}

async function carregar() {
  $("resumo").textContent = "Atualizando…";
  try {
    dados = await api("/api/prs");
    render();
    $("resumo").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Recarrega a cada 5 minutos.`;
  } catch (e) {
    $("conteudo").replaceChildren(el("div", "erro-geral", "Não foi possível consultar o GitHub.\\n" + e.message + "\\nConfira se o gh está logado: gh auth status"));
    $("resumo").textContent = "Falha ao atualizar";
  }
}
$("atualizar").onclick = carregar;
$("busca").oninput = e => { filtro.busca = e.target.value.trim(); render(); };
setInterval(() => { if (!$("modal").classList.contains("aberto")) carregar(); }, 5 * 60 * 1000);
carregar();
</script></body></html>""".replace("__TOKEN__", TOKEN)


def gh(*args, timeout=60):
    return subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout)


def buscar(filtro):
    r = gh("search", "prs", filtro, "@me", "--state", "open", "--limit", "200", "--json", CAMPOS)
    if r.returncode:
        raise RuntimeError(r.stderr.strip() or "falha no gh")
    prs = json.loads(r.stdout)
    with ThreadPoolExecutor(8) as ex:  # a busca não traz o estado de merge; um `pr view` por PR
        for pr, estado in zip(prs, ex.map(estado_merge, prs)):
            pr["mergeable"] = estado
    return prs


def estado_merge(pr):
    r = gh("pr", "view", str(pr["number"]), "--repo", pr["repository"]["nameWithOwner"],
           "--json", "mergeable", "--jq", ".mergeable")
    return r.stdout.strip() if r.returncode == 0 else "UNKNOWN"


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, obj):
        dados = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _host_ok(self):
        if self.headers.get("Host") in HOSTS_OK:  # evita DNS rebinding
            return True
        self._json(403, {"erro": "host não permitido"})
        return False

    def _pr_valido(self, repo, n):
        if REPO_RE.match(repo or "") and str(n).isdigit():
            return True
        self._json(400, {"erro": "repositório ou número inválido"})
        return False

    def do_GET(self):
        if not self._host_ok():
            return
        url = urlparse(self.path)
        try:
            if url.path == "/":
                dados = PAGINA.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)
            elif url.path == "/api/prs":
                self._json(200, {"meus": buscar("--author"), "revisao": buscar("--review-requested")})
            elif url.path == "/api/diff":
                q = parse_qs(url.query)
                repo, n = q.get("repo", [""])[0], q.get("n", [""])[0]
                if not self._pr_valido(repo, n):
                    return
                r = gh("pr", "diff", n, "--repo", repo, timeout=90)
                if r.returncode:
                    return self._json(500, {"erro": r.stderr.strip()})
                self._json(200, {"diff": r.stdout[:LIMITE_DIFF], "truncado": len(r.stdout) > LIMITE_DIFF})
            else:
                self._json(404, {"erro": "não encontrado"})
        except Exception as e:
            self._json(500, {"erro": str(e)})

    def do_POST(self):
        if not self._host_ok():
            return
        if self.path not in ACOES:
            return self._json(404, {"erro": "não encontrado"})
        if not secrets.compare_digest(self.headers.get("X-Painel-Token", ""), TOKEN):
            return self._json(403, {"erro": "token inválido; recarregue a página"})
        try:
            corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            repo, n = corpo.get("repo"), corpo.get("n")
            if not self._pr_valido(repo, n):
                return
            cmd = ACOES[self.path]
            r = gh(*cmd[:2], str(n), "--repo", repo, *cmd[2:])
            if r.returncode:
                return self._json(500, {"erro": r.stderr.strip() or "falha ao executar a ação"})
            self._json(200, {"ok": True})
        except Exception as e:
            self._json(500, {"erro": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    url = f"http://127.0.0.1:{PORT}"
    servidor = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Painel em {url} (Ctrl+C para sair)")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
