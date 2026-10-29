import { Fragment } from "react";
import { Link } from "./Link";
import { LinhaPR } from "./LinhaPR";
import type { Branch, Fechado, Pr } from "./tipos";
import { dias, idade, plural } from "./util";

type BlocoProps = {
  titulo: string;
  prs: Pr[];
  podeAprovar: boolean;
  vazio: string;
  destaque?: boolean;
  aoVerDiff: (p: Pr) => void;
  aoAgir: (p: Pr) => void;
};

export function Bloco({ titulo, prs, podeAprovar, vazio, destaque, aoVerDiff, aoAgir }: BlocoProps) {
  const porRepo = new Map<string, Pr[]>();
  for (const p of prs) porRepo.set(p.repo, [...(porRepo.get(p.repo) ?? []), p]);
  const repos = [...porRepo.keys()].sort((a, b) => porRepo.get(b)!.length - porRepo.get(a)!.length || a.localeCompare(b));
  return (
    <section className={`bloco${destaque ? " destaque" : ""}`}>
      <h2 className="bloco-titulo">
        {titulo}
        <span className="n">{prs.length}</span>
      </h2>
      <div className="lista">
        {!prs.length && <div className="vazio">{vazio}</div>}
        {repos.map((nome) => {
          const doRepo = porRepo.get(nome)!.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
          return (
            <Fragment key={nome}>
              <div className="repo">
                <Link href={`https://github.com/${nome}/pulls`}>{nome}</Link>
                <span>{plural(doRepo.length, "PR", "PRs")}</span>
              </div>
              {doRepo.map((p) => (
                <LinhaPR key={p.url} pr={p} podeAprovar={podeAprovar} aoVerDiff={aoVerDiff} aoAgir={aoAgir} />
              ))}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

/** `branches` é null quando a consulta falhou e undefined enquanto não chegou. */
export function BlocoSemPr({ branches, busca }: { branches: Branch[] | null | undefined; busca: string }) {
  const q = busca.toLowerCase();
  const itens = (branches ?? []).filter((b) => !q || `${b.branch} ${b.repo}`.toLowerCase().includes(q));
  return (
    <section className="bloco">
      <h2 className="bloco-titulo">
        Branches sem PR
        <span className="n">{branches === null ? "?" : (branches?.length ?? "…")}</span>
      </h2>
      <div className="lista">
        {branches === null && <div className="vazio">Não foi possível consultar as branches enviadas.</div>}
        {branches && !itens.length && <div className="vazio">{q ? "Nenhuma branch com essa busca." : "Nenhuma branch recente sem PR."}</div>}
        {itens.map((b) => {
          const [v, u] = idade(dias(b.pushedAt));
          return (
            <div className="pr" key={`${b.repo}:${b.branch}`}>
              <div className="idade" title="Tempo desde o último push">
                <b>{v}</b>
                <small>{u || "enviado"}</small>
              </div>
              <div className="corpo">
                <div className="titulo-pr">
                  <span className="ponto rascunho" />
                  <Link href={b.url}>{b.branch}</Link>
                </div>
                <div className="meta">
                  <span>{b.repo}</span>
                  <span>
                    {plural(b.ahead, "commit", "commits")} à frente de {b.base}
                  </span>
                </div>
              </div>
              <div className="acoes">
                <Link href={b.url}>
                  <button className="ok">Abrir PR</button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type FiltroFechado = "todos" | "merged" | "closed";

export function ListaFechados({ fechados, estado, busca, aoVerDiff }: { fechados: Fechado[]; estado: FiltroFechado; busca: string; aoVerDiff: (f: Fechado) => void }) {
  const q = busca.toLowerCase();
  const lista = fechados
    .filter((p) => (estado === "todos" || p.merged === (estado === "merged")) && (!q || `${p.title} ${p.repo}`.toLowerCase().includes(q)))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt));
  return (
    <section className="bloco">
      <h2 className="bloco-titulo">
        Seus PRs fechados
        <span className="n">{lista.length}</span>
      </h2>
      <div className="lista">
        {!lista.length && <div className="vazio">{q || estado !== "todos" ? "Nenhum PR com esses filtros." : "Nenhum PR fechado."}</div>}
        {lista.map((p) => {
          const [valor, unidade] = idade(dias(p.closedAt));
          return (
            <div className="pr" key={p.url}>
              <div className="idade" title={`Tempo desde que o PR foi ${p.merged ? "mesclado" : "fechado"}`}>
                <b>{valor}</b>
                <small>{unidade || (p.merged ? "mesclado" : "fechado")}</small>
              </div>
              <div className="corpo">
                <div className="titulo-pr">
                  <span className={`ponto ${p.merged ? "mesclado" : "fechado"}`} />
                  <Link href={p.url}>{p.title}</Link>
                </div>
                <div className="meta">
                  <span>#{p.number}</span>
                  <span className={`tag${p.merged ? " mesclado" : ""}`}>{p.merged ? "Mesclado" : "Fechado sem merge"}</span>
                </div>
              </div>
              <div className="acoes">
                <button className="suave" onClick={() => aoVerDiff(p)}>
                  Ver diff
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
