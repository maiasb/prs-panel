export const PARADO = 30; // dias sem atualização para o PR contar como parado

export const dias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);

/** [valor, unidade]; unidade vazia quando é de hoje. */
export const idade = (d: number): [string | number, string] =>
  d < 1 ? ["hoje", ""] : d < 30 ? [d, "dias"] : d < 365 ? [Math.floor(d / 30), "meses"] : [Math.floor(d / 365), "anos"];

export const plural = (n: number, um: string, varios: string) => `${n} ${n > 1 ? varios : um}`;
