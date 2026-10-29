import { useEffect, useRef, useState } from "react";
import { executar, msgErro } from "./api";
import type { Acao, Pr } from "./tipos";

const ACOES: Record<Acao, { rotulo: string; confirma: string; andando: string; feito: string; cls: string }> = {
  aprovar: { rotulo: "Aprovar", confirma: "Confirmar aprovação", andando: "Aprovando…", feito: "Aprovado ✓", cls: "ok" },
  mergear: { rotulo: "Mergear", confirma: "Confirmar merge", andando: "Mergeando…", feito: "Mergeado ✓", cls: "ok" },
  fechar: { rotulo: "Fechar PR", confirma: "Confirmar fechamento", andando: "Fechando…", feito: "Fechado ✓", cls: "perigo" },
};

type Props = {
  tipo: Acao;
  pr: Pr;
  bloqueio?: string | null; // motivo para o botão ficar desabilitado
  aoConcluir: () => void;
  aoErro: (msg: string) => void;
};

/** Botão de duas etapas: o primeiro clique pede confirmação, o segundo executa. */
export function BotaoAcao({ tipo, pr, bloqueio, aoConcluir, aoErro }: Props) {
  const a = ACOES[tipo];
  const [fase, setFase] = useState<"parado" | "confirmando" | "andando" | "feito">("parado");
  const timer = useRef<number>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const clicar = async () => {
    if (fase === "parado") {
      setFase("confirmando");
      timer.current = window.setTimeout(() => setFase("parado"), 5000);
      return;
    }
    clearTimeout(timer.current);
    setFase("andando");
    try {
      await executar(tipo, pr.repo, pr.number);
      aoErro("");
      setFase("feito");
      aoConcluir();
    } catch (e) {
      setFase("parado");
      aoErro(msgErro(e));
    }
  };

  const texto = { parado: a.rotulo, confirmando: a.confirma, andando: a.andando, feito: a.feito }[fase];
  return (
    <button
      className={`${a.cls}${fase === "confirmando" ? " sim" : ""}`}
      disabled={!!bloqueio || fase === "andando" || fase === "feito"}
      title={bloqueio ?? undefined}
      onClick={clicar}
    >
      {texto}
    </button>
  );
}

/** Mergear só habilita com todos os checks verdes; o motor confere de novo antes de mesclar. */
export function bloqueioMerge(p: Pr): string | null {
  const c = p.checks;
  if (c.falhou.length) return "Checks falhando: " + c.falhou.join(", ");
  if (c.andando.length) return "Aguardando pipelines: " + c.andando.join(", ");
  return null;
}

/** Só os meus PRs, prontos e sem conflito; revisões obrigatórias o GitHub valida no merge. */
export const podeMergear = (p: Pr) => !p.isDraft && p.mergeable !== "CONFLICTING";
