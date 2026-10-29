export type Checks = { ok: string[]; andando: string[]; falhou: string[] };

export type Pr = {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  mergeable: string;
  repo: string;
  author: string | null;
  labels: string[];
  commentsCount: number;
  checks: Checks;
};

export type Abertos = { meus: Pr[]; revisao: Pr[] };
export type Snapshot = Abertos & { atualizadoEm: string };
export type Status = { atualizando: boolean; atualizadoEm: string | null; erro: string | null };

export type Fechado = {
  number: number;
  title: string;
  url: string;
  closedAt: string;
  repo: string;
  merged: boolean;
};

export type Branch = {
  repo: string;
  branch: string;
  base: string;
  ahead: number;
  pushedAt: string;
  url: string;
};

export type Acao = "aprovar" | "mergear" | "fechar";
export type DiffDados = { diff: string; truncado: boolean };
