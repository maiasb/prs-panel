import { memo, useState } from "react";
import { BotaoAcao, bloqueioMerge, podeMergear } from "./BotaoAcao";
import { Link } from "./Link";
import type { Checks, Pr } from "./tipos";
import { PARADO, dias, idade, plural } from "./util";

function TagChecks({ c }: { c: Checks }) {
  const [lista, cls, rotulo] = c.falhou.length
    ? [c.falhou, "falhou", plural(c.falhou.length, "check falhou", "checks falharam")]
    : c.andando.length
      ? [c.andando, "andando", plural(c.andando.length, "pipeline em execução", "pipelines em execução")]
      : c.ok.length
        ? [c.ok, "ok", "checks ok"]
        : [[], "", ""];
  if (!lista.length) return null;
  return (
    <span className={`tag ${cls}`} title={lista.join("\n")}>
      {rotulo}
    </span>
  );
}

type Props = {
  pr: Pr;
  podeAprovar: boolean;
  aoVerDiff: (p: Pr) => void;
  aoAgir: (p: Pr) => void; // depois de aprovar, mergear ou fechar
};

export const LinhaPR = memo(function LinhaPR({ pr: p, podeAprovar, aoVerDiff, aoAgir }: Props) {
  const [erro, setErro] = useState("");
  const conflito = p.mergeable === "CONFLICTING";
  const velho = dias(p.updatedAt) > PARADO;
  const [valor, unidade] = idade(dias(p.updatedAt));
  const [v2, u2] = idade(dias(p.createdAt));
  const depois = () => aoAgir(p);

  return (
    <div className="pr">
      <div className={`idade${velho ? " velho" : ""}`} title="Tempo desde a última atualização do PR">
        <b>{valor}</b>
        <small>{unidade || "atualizado"}</small>
      </div>
      <div className="corpo">
        <div className="titulo-pr">
          <span className={`ponto${conflito ? " conflito" : p.isDraft ? " rascunho" : ""}`} />
          <Link href={p.url}>{p.title}</Link>
        </div>
        <div className="meta">
          <span>#{p.number}</span>
          {podeAprovar && p.author && <span>de {p.author}</span>}
          {conflito && (
            <span className="tag conflito" title="A branch tem conflitos com a base e não pode ser mesclada até resolver">
              Conflito na branch
            </span>
          )}
          {p.isDraft && <span className="tag">Rascunho</span>}
          <TagChecks c={p.checks} />
          {velho && <span className="tag parado">Parado</span>}
          {p.labels.map((l) => (
            <span className="tag" key={l}>
              {l}
            </span>
          ))}
          <span>aberto {u2 ? `há ${v2} ${u2}` : "hoje"}</span>
          {p.commentsCount > 0 && <span>{plural(p.commentsCount, "comentário", "comentários")}</span>}
        </div>
      </div>
      <div className="acoes">
        <button className="suave" onClick={() => aoVerDiff(p)}>
          Ver diff
        </button>
        {podeAprovar ? (
          <BotaoAcao tipo="aprovar" pr={p} aoConcluir={depois} aoErro={setErro} />
        ) : (
          podeMergear(p) && <BotaoAcao tipo="mergear" pr={p} bloqueio={bloqueioMerge(p)} aoConcluir={depois} aoErro={setErro} />
        )}
        <BotaoAcao tipo="fechar" pr={p} aoConcluir={depois} aoErro={setErro} />
        {erro && <span className="msg erro">{erro}</span>}
      </div>
    </div>
  );
});
