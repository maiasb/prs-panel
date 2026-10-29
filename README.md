# prs-panel

Painel local para acompanhar seus pull requests abertos no GitHub: os que você abriu e os que aguardam a sua revisão. Roda no seu computador e consulta o GitHub pelo `gh` (GitHub CLI), então não guarda token nem senha.

## Requisitos

- Linux (o `prs.sh` usa `setsid`, `/proc` e `xdg-open`)
- `python3` (só biblioteca padrão, sem `pip install`)
- [`gh`](https://cli.github.com/) instalado e logado:

```bash
gh auth login
gh auth status   # confirma que está logado
```

## Instalação

```bash
git clone git@github.com:maiasb/prs-panel.git
cd prs-panel
chmod +x prs.sh
mkdir -p ~/.local/bin
ln -s "$PWD/prs.sh" ~/.local/bin/prs
```

O `~/.local/bin` precisa estar no `PATH`. O link simbólico é suportado: o script resolve o caminho real para achar o `painel.py`.

## Uso

```bash
prs init          # sobe o painel em segundo plano e abre o navegador (porta 8765)
prs init 9000     # usa outra porta
prs status        # mostra se está rodando e em qual endereço
prs stop          # encerra o painel
```

`prs` sem argumento equivale a `prs init`. Se o painel já estiver rodando, o comando só reabre o navegador.

O endereço é `http://127.0.0.1:<porta>`. O log fica em `~/.local/state/painel-prs/painel.log`.

Sem o `prs.sh`, dá para rodar direto: `python3 painel.py [porta]`.

## O que o painel mostra

- **Para revisar**: PRs em que pediram a sua revisão como pessoa (`--review-requested @me`). Pedidos feitos a um time seu não aparecem.
- **Meus**: PRs abertos por você.
- Filtros: **Todos**, **Para revisar**, **Meus**, **Com conflito** e **Parados** (sem atualização há mais de 30 dias), além da busca por título, repositório ou autor.
- Cada PR mostra o estado dos checks (pipelines em execução, falhando ou ok). Enquanto houver pipeline em execução, a lista atualiza sozinha a cada 20 s; sem pipeline, a cada 5 min. Depois de aprovar, mergear ou fechar, o PR sai da lista na hora e a lista é recarregada em seguida.
- Aba **Fechados**: seus PRs fechados (até 100, mais recentes primeiro), com filtro Mesclados / Fechados sem merge e busca. Link direto: `#fechados`.
- **Ver diff** abre o diff do PR no painel.
- **Aprovar** (nos PRs para revisar), **Mergear** (nos seus PRs, exceto rascunhos e com conflito; fica desabilitado enquanto houver pipeline em execução ou check falhando, e o servidor confere de novo antes de mesclar) e **Fechar** executam `gh pr review --approve`, `gh pr merge --merge` e `gh pr close`. Cada um pede um segundo clique de confirmação. Se o repositório bloquear o merge (checks pendentes, revisão obrigatória, método não permitido), o erro do GitHub aparece ao lado do botão.

## Segurança

- O servidor escuta só em `127.0.0.1` e rejeita requisições com `Host` diferente (proteção contra DNS rebinding).
- As ações (aprovar, mergear, fechar) exigem um token gerado a cada execução, para que outras páginas abertas no navegador não consigam disparar POSTs.
- O projeto não contém segredos. Se um dia precisar de algum, use variáveis de ambiente lidas com `os.environ` e um `.env` (já ignorado pelo `.gitignore`).

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `Não foi possível consultar o GitHub` | O `gh` não está logado. Rode `gh auth status` e `gh auth login`. |
| `Falhou ao subir` | Veja o log em `~/.local/state/painel-prs/painel.log`. Se a porta estiver ocupada, use `prs init <outra porta>`. |
| `prs: comando não encontrado` | Confira o link em `~/.local/bin/prs` e se essa pasta está no `PATH`. |
| `.../painel.py: No such file` | Link antigo ou `prs.sh` desatualizado. Atualize o repositório e refaça o link. |

## Windows

O `prs.sh` não funciona no Windows (clique duplo não executa `.sh`, e o script usa recursos do Linux). Use o WSL, ou rode `python painel.py` com o `gh` instalado e logado.

## Manutenção do README

Toda alteração que mude o uso, os requisitos, os comandos ou o comportamento do painel deve atualizar este arquivo no mesmo commit.
