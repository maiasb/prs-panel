//! Cliente do GitHub: GraphQL para as listas, REST para diff e ações.
//! O token vem de `gh auth token`; nada é gravado em disco.

use chrono::{Duration, Utc};
use reqwest::{Client, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::process::Command;
use tokio::sync::{OnceCell, RwLock};

const API: &str = "https://api.github.com";
const LIMITE_DIFF: usize = 400_000;
const JANELA_PUSH_DIAS: i64 = 7; // só branches enviadas nesse período entram em "sem PR"

const CAMPOS_PR: &str = "number title url createdAt updatedAt isDraft mergeable
    repository { nameWithOwner } author { login } labels(first: 20) { nodes { name } }
    comments { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
        __typename
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
    } } } } } }";

// ---- modelos entregues à interface ----

#[derive(Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct Checks {
    pub ok: Vec<String>,
    pub andando: Vec<String>,
    pub falhou: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_draft: bool,
    pub mergeable: String,
    pub repo: String,
    pub author: Option<String>,
    pub labels: Vec<String>,
    pub comments_count: u64,
    pub checks: Checks,
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Default)]
pub struct Abertos {
    pub meus: Vec<Pr>,
    pub revisao: Vec<Pr>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fechado {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub closed_at: String,
    pub repo: String,
    pub merged: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub repo: String,
    pub branch: String,
    pub base: String,
    pub ahead: u64,
    pub pushed_at: String,
    pub url: String,
}

#[derive(Serialize)]
pub struct Diff {
    pub diff: String,
    pub truncado: bool,
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Acao {
    Aprovar,
    Mergear,
    Fechar,
}

// ---- formato bruto do GraphQL ----

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<Option<T>>,
}

#[derive(Deserialize)]
struct Busca<T> {
    nodes: Vec<Option<T>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrBruto {
    number: u64,
    title: String,
    url: String,
    created_at: String,
    updated_at: String,
    is_draft: bool,
    mergeable: String,
    repository: RepoBruto,
    author: Option<Login>,
    labels: Nodes<Rotulo>,
    comments: Total,
    commits: Nodes<CommitBruto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoBruto {
    name_with_owner: String,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct Rotulo {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Total {
    total_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitBruto {
    commit: CommitInterno,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitInterno {
    status_check_rollup: Option<Rollup>,
}

#[derive(Deserialize)]
struct Rollup {
    contexts: Nodes<Contexto>,
}

#[derive(Deserialize)]
#[serde(tag = "__typename")]
enum Contexto {
    CheckRun {
        name: String,
        status: String,
        conclusion: Option<String>,
    },
    StatusContext {
        context: String,
        state: String,
    },
    #[serde(other)]
    Outro,
}

/// Separa os checks em ok, andando (em execução ou na fila) e falhou.
fn resumir_checks(rollup: Option<Rollup>) -> Checks {
    let mut c = Checks::default();
    for ctx in rollup.into_iter().flat_map(|r| r.contexts.nodes).flatten() {
        let (nome, grupo) = match ctx {
            Contexto::StatusContext { context, state } => {
                let g = match state.as_str() {
                    "SUCCESS" => 0,
                    "PENDING" | "EXPECTED" => 1,
                    _ => 2,
                };
                (context, g)
            }
            Contexto::CheckRun { name, status, conclusion } => {
                let g = if status != "COMPLETED" {
                    1
                } else if matches!(conclusion.as_deref(), Some("SUCCESS" | "NEUTRAL" | "SKIPPED")) {
                    0
                } else {
                    2
                };
                (name, g)
            }
            Contexto::Outro => continue,
        };
        match grupo {
            0 => c.ok.push(nome),
            1 => c.andando.push(nome),
            _ => c.falhou.push(nome),
        }
    }
    c
}

impl From<PrBruto> for Pr {
    fn from(p: PrBruto) -> Self {
        let rollup = p.commits.nodes.into_iter().flatten().next().and_then(|c| c.commit.status_check_rollup);
        Pr {
            number: p.number,
            title: p.title,
            url: p.url,
            created_at: p.created_at,
            updated_at: p.updated_at,
            is_draft: p.is_draft,
            mergeable: p.mergeable,
            repo: p.repository.name_with_owner,
            author: p.author.map(|a| a.login),
            labels: p.labels.nodes.into_iter().flatten().map(|l| l.name).collect(),
            comments_count: p.comments.total_count,
            checks: resumir_checks(rollup),
        }
    }
}

fn desserializar<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("resposta inesperada do GitHub: {e}"))
}

/// `dono/repo` com caracteres seguros para montar URL.
pub fn repo_valido(repo: &str) -> bool {
    let parte = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c));
    repo.split_once('/').is_some_and(|(d, r)| parte(d) && parte(r))
}

fn codificar_branch(b: &str) -> String {
    b.bytes()
        .map(|c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (c as char).to_string(),
            _ => format!("%{c:02X}"),
        })
        .collect()
}

pub struct Github {
    http: Client,
    token: RwLock<Option<String>>,
    login: OnceCell<String>,
}

impl Github {
    pub fn novo() -> Self {
        Github { http: Client::new(), token: RwLock::new(None), login: OnceCell::new() }
    }

    async fn token(&self, renovar: bool) -> Result<String, String> {
        if !renovar && let Some(t) = self.token.read().await.clone() {
            return Ok(t);
        }
        let saida = Command::new("gh").args(["auth", "token"]).output().await.map_err(|e| format!("não foi possível executar o gh: {e}"))?;
        let t = String::from_utf8_lossy(&saida.stdout).trim().to_string();
        if !saida.status.success() || t.is_empty() {
            return Err("o gh não está logado. Rode: gh auth login".into());
        }
        *self.token.write().await = Some(t.clone());
        Ok(t)
    }

    /// Envia a requisição; se o token estiver vencido (401), renova pelo `gh` e tenta uma vez mais.
    async fn enviar(&self, montar: impl Fn(&Client, &str) -> RequestBuilder) -> Result<Response, String> {
        let mut renovar = false;
        loop {
            let token = self.token(renovar).await?;
            let r = montar(&self.http, &token).send().await.map_err(|e| format!("sem conexão com o GitHub: {e}"))?;
            if r.status().as_u16() == 401 && !renovar {
                renovar = true;
                continue;
            }
            return Ok(r);
        }
    }

    fn pedido(http: &Client, token: &str, metodo: Method, url: &str) -> RequestBuilder {
        http.request(metodo, url)
            .bearer_auth(token)
            .header("User-Agent", "painel-prs")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    async fn graphql(&self, query: &str, variaveis: Value) -> Result<Value, String> {
        let corpo = json!({ "query": query, "variables": variaveis });
        let r = self.enviar(|h, t| Self::pedido(h, t, Method::POST, &format!("{API}/graphql")).json(&corpo)).await?;
        let status = r.status();
        let v: Value = r.json().await.map_err(|e| format!("resposta inválida do GitHub: {e}"))?;
        match v.get("data").filter(|d| !d.is_null()) {
            Some(d) => Ok(d.clone()), // erros parciais (ex.: branch apagada) vêm com dados
            None => Err(v["errors"][0]["message"].as_str().map(String::from).unwrap_or_else(|| format!("GitHub respondeu {status}"))),
        }
    }

    async fn rest(&self, metodo: Method, caminho: &str, corpo: Option<Value>, aceita: &str) -> Result<Response, String> {
        let url = format!("{API}{caminho}");
        let r = self
            .enviar(|h, t| {
                let b = Self::pedido(h, t, metodo.clone(), &url).header("Accept", aceita);
                match &corpo {
                    Some(c) => b.json(c),
                    None => b,
                }
            })
            .await?;
        if r.status().is_success() {
            return Ok(r);
        }
        let status = r.status();
        let msg = r.json::<Value>().await.ok().and_then(|v| v["message"].as_str().map(String::from));
        Err(msg.unwrap_or_else(|| format!("GitHub respondeu {status}")))
    }

    async fn login(&self) -> Result<&str, String> {
        self.login
            .get_or_try_init(|| async {
                let d = self.graphql("query { viewer { login } }", json!({})).await?;
                d["viewer"]["login"].as_str().map(String::from).ok_or_else(|| "login não encontrado".to_string())
            })
            .await
            .map(String::as_str)
    }

    pub async fn abertos(&self) -> Result<Abertos, String> {
        let login = self.login().await?;
        let q = format!(
            "query($m: String!, $r: String!) {{
                meus: search(query: $m, type: ISSUE, first: 100) {{ nodes {{ ... on PullRequest {{ {CAMPOS_PR} }} }} }}
                revisao: search(query: $r, type: ISSUE, first: 100) {{ nodes {{ ... on PullRequest {{ {CAMPOS_PR} }} }} }}
            }}"
        );
        let vars = json!({
            "m": format!("is:pr is:open author:{login} archived:false"),
            "r": format!("is:pr is:open review-requested:{login} archived:false"),
        });
        let mut d = self.graphql(&q, vars).await?;
        let mut lista = |k: &str| -> Result<Vec<Pr>, String> {
            let b: Busca<PrBruto> = desserializar(d[k].take())?;
            Ok(b.nodes.into_iter().flatten().map(Pr::from).collect())
        };
        Ok(Abertos { meus: lista("meus")?, revisao: lista("revisao")? })
    }

    pub async fn fechados(&self) -> Result<Vec<Fechado>, String> {
        let login = self.login().await?;
        let q = "query($q: String!) { search(query: $q, type: ISSUE, first: 100) { nodes { ... on PullRequest {
            number title url closedAt state repository { nameWithOwner } } } } }";
        let vars = json!({ "q": format!("is:pr is:closed author:{login} archived:false sort:updated-desc") });
        let mut d = self.graphql(q, vars).await?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct F {
            number: u64,
            title: String,
            url: String,
            closed_at: String,
            state: String,
            repository: RepoBruto,
        }
        let b: Busca<F> = desserializar(d["search"].take())?;
        Ok(b.nodes
            .into_iter()
            .flatten()
            .map(|f| Fechado {
                number: f.number,
                title: f.title,
                url: f.url,
                closed_at: f.closed_at,
                repo: f.repository.name_with_owner,
                merged: f.state == "MERGED",
            })
            .collect())
    }

    /// Branches enviadas recentemente (eventos de push) que estão à frente da padrão e nunca tiveram PR.
    pub async fn sem_pr(&self) -> Result<Vec<Branch>, String> {
        let login = self.login().await?;
        let eventos: Vec<Value> = self
            .rest(Method::GET, &format!("/users/{login}/events?per_page=100"), None, "application/vnd.github+json")
            .await?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let corte = (Utc::now() - Duration::days(JANELA_PUSH_DIAS)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let mut pushes: Vec<(String, String, String)> = Vec::new(); // (repo, branch, quando), mais recentes primeiro
        for e in &eventos {
            let (Some(repo), Some(r), Some(quando)) = (e["repo"]["name"].as_str(), e["payload"]["ref"].as_str(), e["created_at"].as_str()) else { continue };
            let Some(branch) = r.strip_prefix("refs/heads/") else { continue };
            // as datas são ISO em UTC com o mesmo formato, então a comparação de texto vale
            if e["type"] == "PushEvent" && quando >= corte.as_str() && repo_valido(repo) && !pushes.iter().any(|p| p.0 == repo && p.1 == branch) {
                pushes.push((repo.into(), branch.into(), quando.into()));
            }
        }
        if pushes.is_empty() {
            return Ok(vec![]);
        }
        // um alias por branch; nomes vão como variáveis, nunca concatenados na query
        let (mut decl, mut corpo, mut vars) = (String::new(), String::new(), serde_json::Map::new());
        for (i, (repo, branch, _)) in pushes.iter().enumerate() {
            let (dono, nome) = repo.split_once('/').unwrap_or_default();
            decl += &format!("$o{i}: String!, $n{i}: String!, $b{i}: String!, $f{i}: String!, ");
            corpo += &format!(
                "r{i}: repository(owner: $o{i}, name: $n{i}) {{
                    defaultBranchRef {{ name compare(headRef: $b{i}) {{ aheadBy }} }}
                    ref(qualifiedName: $f{i}) {{ associatedPullRequests(first: 1) {{ totalCount }} }}
                }} "
            );
            vars.insert(format!("o{i}"), dono.into());
            vars.insert(format!("n{i}"), nome.into());
            vars.insert(format!("b{i}"), branch.as_str().into());
            vars.insert(format!("f{i}"), format!("refs/heads/{branch}").into());
        }
        let d = self.graphql(&format!("query({decl}) {{ {corpo} }}"), Value::Object(vars)).await?;
        let mut achadas = Vec::new();
        for (i, (repo, branch, quando)) in pushes.into_iter().enumerate() {
            let r = &d[format!("r{i}")];
            let base = r["defaultBranchRef"]["name"].as_str().unwrap_or_default();
            let ahead = r["defaultBranchRef"]["compare"]["aheadBy"].as_u64().unwrap_or(0);
            let tem_pr = r["ref"]["associatedPullRequests"]["totalCount"].as_u64().unwrap_or(1) > 0;
            // ref nula = branch apagada; sem comparação ou sem commits novos = nada a abrir
            if r["ref"].is_null() || base.is_empty() || branch == base || ahead == 0 || tem_pr {
                continue;
            }
            achadas.push(Branch {
                url: format!("https://github.com/{repo}/compare/{}?expand=1", codificar_branch(&branch)),
                base: base.into(),
                repo,
                branch,
                ahead,
                pushed_at: quando,
            });
        }
        Ok(achadas)
    }

    pub async fn diff(&self, repo: &str, n: u64) -> Result<Diff, String> {
        let mut texto = self.rest(Method::GET, &format!("/repos/{repo}/pulls/{n}"), None, "application/vnd.github.diff").await?.text().await.map_err(|e| e.to_string())?;
        let truncado = texto.len() > LIMITE_DIFF;
        if truncado {
            let mut fim = LIMITE_DIFF;
            while !texto.is_char_boundary(fim) {
                fim -= 1;
            }
            texto.truncate(fim);
        }
        Ok(Diff { diff: texto, truncado })
    }

    async fn checks_do_pr(&self, repo: &str, n: u64) -> Result<Checks, String> {
        let (dono, nome) = repo.split_once('/').unwrap_or_default();
        let q = "query($o: String!, $n: String!, $num: Int!) { repository(owner: $o, name: $n) { pullRequest(number: $num) {
            commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
                __typename ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } } } } }";
        let mut d = self.graphql(q, json!({ "o": dono, "n": nome, "num": n })).await?;
        let commits: Nodes<CommitBruto> = desserializar(d["repository"]["pullRequest"]["commits"].take())?;
        Ok(resumir_checks(commits.nodes.into_iter().flatten().next().and_then(|c| c.commit.status_check_rollup)))
    }

    pub async fn executar(&self, acao: Acao, repo: &str, n: u64) -> Result<(), String> {
        let json = "application/vnd.github+json";
        let base = format!("/repos/{repo}/pulls/{n}");
        match acao {
            Acao::Aprovar => self.rest(Method::POST, &format!("{base}/reviews"), Some(json!({ "event": "APPROVE" })), json).await?,
            Acao::Fechar => self.rest(Method::PATCH, &base, Some(json!({ "state": "closed" })), json).await?,
            Acao::Mergear => {
                // a trava do botão não basta: confere os checks de novo antes de mesclar
                let c = self.checks_do_pr(repo, n).await.map_err(|_| "não foi possível ler os checks do PR".to_string())?;
                if !c.falhou.is_empty() || !c.andando.is_empty() {
                    return Err(format!("checks sem sucesso: {}", [c.falhou, c.andando].concat().join(", ")));
                }
                self.rest(Method::PUT, &format!("{base}/merge"), Some(json!({ "merge_method": "merge" })), json).await?
            }
        };
        Ok(())
    }
}
