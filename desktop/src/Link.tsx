import type { ReactNode } from "react";
import { abrirLink } from "./api";

/** Link externo: abre no navegador do sistema, não dentro da janela. */
export function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void abrirLink(href);
      }}
    >
      {children}
    </a>
  );
}
