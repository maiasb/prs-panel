import { useCallback, useEffect, useMemo, useState } from "react";
import { atualizar, buscarFechados, estadoInicial, msgErro, ouvir } from "./api";
import { Diff } from "./Diff";
import { Bloco, BlocoSemPr, ListaFechados, type FiltroFechado } from "./Listas";
import type { Abertos, Branch, Fechado, Pr, Status } from "./tipos";
import { PARADO, dias } from "./util";

type Aba = "abertos" | "fechados";
type Escopo = "todos" | "revisao" | "meus";
type Aberto = { pr: Pr; podeAprovar: boolean } | { fechado: Fechado };

const OCULTAR_MS = 60_000; // o GitHub demora a refletir a ação; o PR fica fora da lista nesse período
const VAZIO: Abertos = { meus: [], revisao: [] };

export default function App() {
  const [aba, setAba] = useState<Aba>("abertos");
  const [dados, setDados] = useState<Abertos>(VAZIO);
  const [status, setStatus] = useState<Status>({ atualizando: true, atualizadoEm: null, erro: null });
  const [semPr, setSemPr] = useState<Branch[] | null | undefined>(undefined);
  const [fechados, setFechados] = useState<Fechado[]>([]);
  const [erroFechados, setErroFechados] = useState("");
  const [ocultos, setOcultos] = useState<Record<string, number>>({});
  const [diff, setDiff] = useState<Aberto | null>(null);

  const [escopo, setEscopo] = useState<Escopo>("todos");
  const [conflito, setConflito] = useState(false);
  const [parado, setParado] = useState(false);
  const [busca, setBusca] = useState("");
  const [estadoFechado, setEstadoFechado] = useState<FiltroFechado>("todos");

  // O motor empurra as mudanças; a tela só assina os eventos.
  useEffect(() => {
    const cancelar = [ouvir("abertos", (s) => setDados(s)), ouvir("status", setStatus), ouvir("sem-pr", setSemPr)];
    estadoInicial().then((s) => s && setDados((atual) => (atual === VAZIO ? s : atual)));
    return () => cancelar.forEach((c) => c());
  }, []);

  const carregarFechados = useCallback(() => {
    buscarFechados().then(
      (f) => (setFechados(f), setErroFechados("")),
      (e) => setErroFechados(msgErro(e)),
    );
  }, []);
  useEffect(() => {
    if (aba === "fechados") carregarFechados();
  }, [aba, carregarFechados]);

  const recarregar = () => {
    atualizar();
    if (aba === "fechados") carregarFechados();
  };

  // Tira o PR da lista na hora e reconcilia com o GitHub logo depois.
  const aoAgir = useCallback((p: Pr) => {
    setOcultos((o) => ({ ...o, [p.url]: Date.now() + OCULTAR_MS }));
    setTimeout(atualizar, 2000);
  }, []);
  const fecharDiff = useCallback(() => setDiff(null), []);
  const verDiff = useCallback((pr: Pr) => setDiff({ pr, podeAprovar: false }), []);

  const abertos = useMemo(() => {
    const vivo = (l: Pr[]) => l.filter((p) => !(ocultos[p.url] > Date.now()));
    return { meus: vivo(dados.meus), revisao: vivo(dados.revisao) };
  }, [dados, ocultos]);
  const todos = [...abertos.revisao, ...abertos.meus];
  const q = busca.trim().toLowerCase();
  const passa = (p: Pr) =>
    (!conflito || p.mergeable === "CONFLICTING") &&
    (!parado || dias(p.updatedAt) > PARADO) &&
    (!q || `${p.title} ${p.repo} ${p.author ?? ""}`.toLowerCase().includes(q));
  const filtrando = conflito || parado || !!q;

  const alternar = (e: Escopo) => setEscopo((atual) => (atual === e ? "todos" : e));
  const chipsAbertos = [
    { rot: "Todos", n: todos.length, on: escopo === "todos", clique: () => setEscopo("todos") },
    { rot: "Para revisar", n: abertos.revisao.length, on: escopo === "revisao", clique: () => alternar("revisao") },
    { rot: "Meus", n: abertos.meus.length, on: escopo === "meus", clique: () => alternar("meus") },
    { rot: "Com conflito", n: todos.filter((p) => p.mergeable === "CONFLICTING").length, on: conflito, clique: () => setConflito((v) => !v) },
    { rot: "Parados", n: todos.filter((p) => dias(p.updatedAt) > PARADO).length, on: parado, clique: () => setParado((v) => !v) },
  ];
  const nFechados = (merged: boolean) => fechados.filter((f) => f.merged === merged).length;
  const chipsFechados = [
    { rot: "Todos", n: fechados.length, on: estadoFechado === "todos", clique: () => setEstadoFechado("todos") },
    { rot: "Mesclados", n: nFechados(true), on: estadoFechado === "merged", clique: () => setEstadoFechado("merged") },
    { rot: "Fechados sem merge", n: nFechados(false), on: estadoFechado === "closed", clique: () => setEstadoFechado("closed") },
  ];
  const chips = aba === "abertos" ? chipsAbertos : chipsFechados;

  const resumo = status.atualizando
    ? "Atualizando…"
    : status.erro
      ? "Falha ao atualizar"
      : status.atualizadoEm
        ? `Atualizado às ${new Date(status.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Recarrega sozinho.`
        : "";
  const semDados = !dados.meus.length && !dados.revisao.length;

  return (
    <>
      <div className="pagina">
        <header className="topo">
          <div>
            <h1>Pull requests</h1>
            <p>{resumo}</p>
          </div>
          <div className="topo-acoes">
            <nav className="abas" aria-label="Seção">
              {(["abertos", "fechados"] as const).map((a) => (
                <button key={a} aria-pressed={aba === a} onClick={() => setAba(a)}>
                  {a === "abertos" ? "Abertos" : "Fechados"}
                </button>
              ))}
            </nav>
            <button onClick={recarregar}>Atualizar</button>
          </div>
        </header>
        <div className="barra">
          <input id="busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por título, repositório ou autor" aria-label="Buscar PRs" />
          <div className="chips">
            {chips.map((c) => (
              <button key={c.rot} className="chip" aria-pressed={c.on} onClick={c.clique}>
                {c.rot}
                <b>{c.n}</b>
              </button>
            ))}
          </div>
        </div>
        <main>
          {aba === "fechados" ? (
            erroFechados ? (
              <div className="erro-geral">{erroFechados}</div>
            ) : (
              <ListaFechados fechados={fechados} estado={estadoFechado} busca={q} aoVerDiff={(f) => setDiff({ fechado: f })} />
            )
          ) : status.erro && semDados ? (
            <div className="erro-geral">{`Não foi possível consultar o GitHub.\n${status.erro}\nConfira se o gh está logado: gh auth status`}</div>
          ) : (
            <>
              {escopo !== "meus" && (
                <Bloco
                  titulo="Aguardando sua revisão"
                  prs={abertos.revisao.filter(passa)}
                  podeAprovar
                  destaque
                  vazio={filtrando ? "Nenhum PR com esses filtros." : "Nenhum PR aguardando sua revisão."}
                  aoVerDiff={(p) => setDiff({ pr: p, podeAprovar: true })}
                  aoAgir={aoAgir}
                />
              )}
              {escopo !== "revisao" && (
                <>
                  <Bloco
                    titulo="Seus PRs abertos"
                    prs={abertos.meus.filter(passa)}
                    podeAprovar={false}
                    vazio={filtrando ? "Nenhum PR com esses filtros." : "Você não tem PRs abertos."}
                    aoVerDiff={verDiff}
                    aoAgir={aoAgir}
                  />
                  <BlocoSemPr branches={semPr} busca={q} />
                </>
              )}
            </>
          )}
        </main>
      </div>
      {diff && (
        <Diff
          alvo={"pr" in diff ? diff.pr : diff.fechado}
          acoes={"pr" in diff ? diff : undefined}
          aoFechar={fecharDiff}
          aoAgir={() => "pr" in diff && aoAgir(diff.pr)}
        />
      )}
    </>
  );
}
