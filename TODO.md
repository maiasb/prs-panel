# TODO

## Em andamento

- Aplicativo de desktop em `desktop/` (Tauri v2 + React): falta conferir a interface na janela (dev rodando), medir `tauri build` e decidir o que fazer com `python/`.

## Pendente

- Conferir visualmente na janela: listas, chips, busca, Ver diff, links abrindo no navegador, aba Fechados, Branches sem PR.
- Testar as ações (Aprovar, Mergear, Fechar) em um PR de teste; o motor usa REST (`/reviews`, `/merge`, `PATCH state=closed`) em vez do `gh`.
- Confirmar que a CSP (`tauri.conf.json`) não bloqueia nada na janela.
- Gerar o pacote com `npm run tauri build` e criar um atalho de lançamento (equivalente ao `prs init`).
- Decidir se a pasta `python/` continua depois que o app cobrir tudo.
- Bandeja do sistema e notificação de desktop (checks falhando, PR novo para revisar): ideia, não pedida ainda.
- Testes automatizados do motor Rust (`resumir_checks`, `repo_valido`, `codificar_branch`) e do front.

## Feito

- 2026-10-29: esqueleto Tauri v2 + React/TypeScript em `desktop/`; motor em Rust (GraphQL, cache em disco, eventos); interface React portada do `painel.py`.
- 2026-10-29: conferido contra o painel antigo: mesmos PRs, mesmo `mergeable`, mesma branch em "sem PR". PRs abertos ~1 s (antigo ~2,9 s); sem PR ~2–3,5 s (antigo ~4,1 s).
