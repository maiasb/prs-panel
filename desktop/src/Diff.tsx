import { memo, useEffect, useMemo, useState } from "react";
import { BotaoAcao, bloqueioMerge, podeMergear } from "./BotaoAcao";
import { buscarDiff, msgErro } from "./api";
import type { DiffDados, Pr } from "./tipos";

type Alvo = { repo: string; number: number; title: string };

const META = /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename|old mode|new mode)/;

function classe(l: string) {
  if (l.startsWith("diff --git")) return "arq";
  if (l.startsWith("@@")) return "hunk";
  if (META.test(l)) return "meta2";
  if (l[0] === "+") return "add";
  if (l[0] === "-") return "del";
  return undefined;
}

// Memoizado: o diff pode ter milhares de linhas e não deve redesenhar a cada estado da janela.
const Linhas = memo(function Linhas({ linhas }: { linhas: string[] }) {
  return (
    <>
      {linhas.map((l, i) => (
        <div key={i} className={classe(l)}>
          {l || " "}
        </div>
      ))}
    </>
  );
});

type Props = {
  alvo: Alvo;
  // quem pode agir: undefined = só leitura (PRs fechados)
  acoes?: { pr: Pr; podeAprovar: boolean };
  aoFechar: () => void;
  aoAgir: () => void;
};

export function Diff({ alvo, acoes, aoFechar, aoAgir }: Props) {
  const [dados, setDados] = useState<DiffDados | null>(null);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    buscarDiff(alvo.repo, alvo.number).then(
      (d) => vivo && setDados(d),
      (e) => vivo && setErro(msgErro(e)),
    );
    return () => {
      vivo = false;
    };
  }, [alvo.repo, alvo.number]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [aoFechar]);

  const linhas = useMemo(() => dados?.diff.split("\n") ?? [], [dados]);
  const [add, del] = useMemo(() => {
    let a = 0, d = 0;
    for (const l of linhas) {
      if (l[0] === "+" && !l.startsWith("+++")) a++;
      else if (l[0] === "-" && !l.startsWith("---")) d++;
    }
    return [a, d];
  }, [linhas]);

  const concluir = () => {
    aoFechar();
    aoAgir();
  };

  return (
    <div id="modal" className="aberto" role="dialog" aria-modal="true" aria-labelledby="m-titulo">
      <div className="caixa">
        <div className="caixa-topo">
          <h3 id="m-titulo">
            {alvo.repo} #{alvo.number} · {alvo.title}
          </h3>
          {dados && (
            <span className="msg">
              <span className="stat-add">+{add}</span> <span className="stat-del">−{del}</span>
            </span>
          )}
          <span className="msg erro">{msg}</span>
          <span className="acoes">
            {acoes &&
              (acoes.podeAprovar ? (
                <BotaoAcao tipo="aprovar" pr={acoes.pr} aoConcluir={aoAgir} aoErro={setMsg} />
              ) : (
                podeMergear(acoes.pr) && (
                  <BotaoAcao tipo="mergear" pr={acoes.pr} bloqueio={bloqueioMerge(acoes.pr)} aoConcluir={concluir} aoErro={setMsg} />
                )
              ))}
            {acoes && <BotaoAcao tipo="fechar" pr={acoes.pr} aoConcluir={concluir} aoErro={setMsg} />}
          </span>
          <button className="suave" onClick={aoFechar}>
            Fechar diff
          </button>
        </div>
        <div id="diff">
          {erro ? (
            <div className="erro-geral">{erro}</div>
          ) : !dados ? (
            <div className="msg">Carregando diff…</div>
          ) : (
            <>
              <Linhas linhas={linhas} />
              {dados.truncado && <div className="msg">Diff truncado. Abra o PR no GitHub para ver o restante.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
