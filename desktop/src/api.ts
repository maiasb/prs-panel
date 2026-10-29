import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Acao, Branch, DiffDados, Fechado, Snapshot, Status } from "./tipos";

// invoke rejeita com o texto do erro vindo do Rust
const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const estadoInicial = () => invoke<Snapshot | null>("estado_inicial");
export const atualizar = () => invoke<void>("atualizar");
export const buscarFechados = () => invoke<Fechado[]>("fechados");
export const buscarDiff = (repo: string, n: number) => invoke<DiffDados>("diff", { repo, n });
export const executar = (tipo: Acao, repo: string, n: number) => invoke<void>("acao", { tipo, repo, n });
export const abrirLink = (url: string) => openUrl(url).catch(() => {});
export { msgErro };

type Eventos = { abertos: Snapshot; status: Status; "sem-pr": Branch[] | null };

/** Assina um evento do motor; devolve a função que cancela. */
export function ouvir<K extends keyof Eventos>(nome: K, fn: (dados: Eventos[K]) => void) {
  const pronto = listen<Eventos[K]>(nome, (e) => fn(e.payload));
  return () => void pronto.then((cancelar) => cancelar());
}
