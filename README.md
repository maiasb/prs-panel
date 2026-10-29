# prs-panel

Painel local para acompanhar seus pull requests abertos no GitHub: os que você abriu e os que aguardam a sua revisão. Roda no seu computador e consulta o GitHub pelo `gh` (GitHub CLI), então não guarda token nem senha.

## Duas versões

- **Navegador** (pasta `python/`: `painel.py` + `prs.sh`): descrita abaixo. Continua funcionando.
- **Aplicativo de desktop** (pasta `desktop/`): a mesma tela em React, numa janela nativa (Tauri v2), com o motor em Rust. Veja a seção [Aplicativo de desktop](#aplicativo-de-desktop-app).

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
chmod +x python/prs.sh
mkdir -p ~/.local/bin
ln -s "$PWD/python/prs.sh" ~/.local/bin/prs
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

Sem o `prs.sh`, dá para rodar direto: `python3 python/painel.py [porta]`.

## O que o painel mostra

- **Para revisar**: PRs em que pediram a sua revisão como pessoa (`--review-requested @me`). Pedidos feitos a um time seu não aparecem.
- **Meus**: PRs abertos por você.
- Filtros: **Todos**, **Para revisar**, **Meus**, **Com conflito** e **Parados** (sem atualização há mais de 30 dias), além da busca por título, repositório ou autor.
- Cada PR mostra o estado dos checks (pipelines em execução, falhando ou ok). Enquanto houver pipeline em execução, a lista atualiza sozinha a cada 20 s; sem pipeline, a cada 5 min. Depois de aprovar, mergear ou fechar, o PR sai da lista na hora e a lista é recarregada em seguida.
- **Branches sem PR** (abaixo dos seus PRs abertos): branches que você enviou nos últimos 7 dias, que estão à frente da branch padrão, ainda existem e nunca tiveram PR. O botão **Abrir PR** leva à tela de comparação do GitHub. Veja as limitações abaixo.
- Aba **Fechados**: seus PRs fechados (até 100, mais recentes primeiro), com filtro Mesclados / Fechados sem merge e busca. Link direto: `#fechados`.
- **Ver diff** abre o diff do PR no painel.
- **Aprovar** (nos PRs para revisar), **Mergear** (nos seus PRs, exceto rascunhos e com conflito; fica desabilitado enquanto houver pipeline em execução ou check falhando, e o servidor confere de novo antes de mesclar) e **Fechar** executam `gh pr review --approve`, `gh pr merge --merge` e `gh pr close`. Cada um pede um segundo clique de confirmação. Se o repositório bloquear o merge (checks pendentes, revisão obrigatória, método não permitido), o erro do GitHub aparece ao lado do botão.

## Limitações conhecidas

**Branches sem PR**

- A lista vem dos eventos de push da sua conta, e a API do GitHub guarda poucos eventos recentes. Com muitos pushes, ou pushes antigos, algumas branches podem não aparecer.
- O critério é do painel, não o do aviso "Compare & pull request" do GitHub, então a lista pode divergir do banner. A janela de 7 dias é a constante `JANELA_PUSH_DIAS` em `painel.py`.
- Depois que você abre o PR de uma branch, ela só sai da lista na próxima atualização automática (20 s a 5 min).

## Aplicativo de desktop (`desktop/`)

Mesmas funções do painel acima (revisar, meus, filtros, branches sem PR, fechados, diff, aprovar, mergear e fechar). Diferenças:

- O motor em Rust busca tudo em **uma query GraphQL** (PRs, `mergeable` e checks), em vez de um `gh pr view` por PR, e usa o token de `gh auth token` direto na API (sem subir um processo `gh` a cada consulta).
- A interface **não faz polling**: o motor atualiza em segundo plano (20 s com pipeline em execução, 5 min sem) e só avisa a tela quando algo mudou.
- O último estado é guardado em `~/.cache/dev.maiasb.painelprs/abertos.json`, então a janela abre já preenchida e atualiza em seguida.
- Links abrem no navegador do sistema.

Requisitos além do `gh` logado: Node 22+, Rust (via [rustup](https://rustup.rs)) e as bibliotecas do Tauri. No Debian/Ubuntu:

```bash
sudo apt install -y build-essential pkg-config libwebkit2gtk-4.1-dev libsoup-3.0-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev
```

```bash
cd desktop
npm install
npm run tauri dev     # desenvolvimento, com recarga automática
npm run tauri build   # gera o executável e os pacotes em desktop/src-tauri/target/release
```

Estrutura: `desktop/src/` é o React (TypeScript); `desktop/src-tauri/src/github.rs` é o cliente do GitHub e `lib.rs` os comandos e o laço de atualização.

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

O `prs.sh` não funciona no Windows (clique duplo não executa `.sh`, e o script usa recursos do Linux). Use o WSL, ou rode `python python/painel.py` com o `gh` instalado e logado.

## Manutenção do README

Toda alteração que mude o uso, os requisitos, os comandos ou o comportamento do painel deve atualizar este arquivo no mesmo commit.
