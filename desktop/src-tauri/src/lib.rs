mod github;

use github::{Abertos, Acao, Branch, Diff, Fechado, Github, repo_valido};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{Mutex, Notify};

const INTERVALO_RAPIDO: Duration = Duration::from_secs(20); // enquanto houver pipeline em execução
const INTERVALO_LENTO: Duration = Duration::from_secs(300);
const INTERVALO_SEM_PR: Duration = Duration::from_secs(300);

/// Última lista de PRs abertos; também vai para o disco para a janela abrir já preenchida.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[serde(flatten)]
    abertos: Abertos,
    atualizado_em: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Status {
    atualizando: bool,
    atualizado_em: Option<String>,
    erro: Option<String>,
}

struct Estado {
    gh: Arc<Github>,
    acordar: Arc<Notify>,
    ultimo: Mutex<Option<Snapshot>>,
    arquivo: PathBuf,
}

fn agora() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn repo_ou_erro(repo: &str) -> Result<(), String> {
    if repo_valido(repo) { Ok(()) } else { Err("repositório inválido".into()) }
}

#[tauri::command]
async fn estado_inicial(estado: State<'_, Arc<Estado>>) -> Result<Option<Snapshot>, String> {
    Ok(estado.ultimo.lock().await.clone())
}

#[tauri::command]
fn atualizar(estado: State<'_, Arc<Estado>>) {
    estado.acordar.notify_one();
}

#[tauri::command]
async fn fechados(estado: State<'_, Arc<Estado>>) -> Result<Vec<Fechado>, String> {
    estado.gh.fechados().await
}

#[tauri::command]
async fn diff(estado: State<'_, Arc<Estado>>, repo: String, n: u64) -> Result<Diff, String> {
    repo_ou_erro(&repo)?;
    estado.gh.diff(&repo, n).await
}

#[tauri::command]
async fn acao(estado: State<'_, Arc<Estado>>, tipo: Acao, repo: String, n: u64) -> Result<(), String> {
    repo_ou_erro(&repo)?;
    estado.gh.executar(tipo, &repo, n).await
}

/// Atualiza os PRs abertos e avisa a tela só se algo mudou. Devolve se há pipeline em execução.
async fn ciclo_abertos(app: &AppHandle, estado: &Estado) -> bool {
    let _ = app.emit("status", Status { atualizando: true, atualizado_em: None, erro: None });
    let resultado = estado.gh.abertos().await;
    let (erro, andando) = match resultado {
        Ok(novo) => {
            let andando = novo.meus.iter().chain(&novo.revisao).any(|p| !p.checks.andando.is_empty());
            let mut ultimo = estado.ultimo.lock().await;
            if ultimo.as_ref().map(|s| &s.abertos) != Some(&novo) {
                let snap = Snapshot { abertos: novo, atualizado_em: agora() };
                let _ = std::fs::write(&estado.arquivo, serde_json::to_vec(&snap).unwrap_or_default());
                let _ = app.emit("abertos", &snap);
                *ultimo = Some(snap);
            }
            (None, andando)
        }
        Err(e) => (Some(e), false),
    };
    let _ = app.emit("status", Status { atualizando: false, atualizado_em: Some(agora()), erro });
    andando
}

async fn ciclo_sem_pr(app: &AppHandle, estado: &Estado) {
    let branches: Option<Vec<Branch>> = estado.gh.sem_pr().await.ok(); // None = a consulta falhou
    let _ = app.emit("sem-pr", branches);
}

async fn laco(app: AppHandle, estado: Arc<Estado>) {
    let mut ultimo_sem_pr: Option<tokio::time::Instant> = None;
    loop {
        let sem_pr_vencido = ultimo_sem_pr.is_none_or(|t| t.elapsed() >= INTERVALO_SEM_PR);
        let andando = if sem_pr_vencido {
            ultimo_sem_pr = Some(tokio::time::Instant::now());
            tokio::join!(ciclo_abertos(&app, &estado), ciclo_sem_pr(&app, &estado)).0
        } else {
            ciclo_abertos(&app, &estado).await
        };
        let espera = if andando { INTERVALO_RAPIDO } else { INTERVALO_LENTO };
        tokio::select! {
            _ = tokio::time::sleep(espera) => {}
            _ = estado.acordar.notified() => { ultimo_sem_pr = None; } // "Atualizar" recarrega tudo
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_cache_dir()?;
            let _ = std::fs::create_dir_all(&dir);
            let arquivo = dir.join("abertos.json");
            let ultimo = std::fs::read(&arquivo).ok().and_then(|b| serde_json::from_slice(&b).ok());
            let estado = Arc::new(Estado { gh: Arc::new(Github::novo()), acordar: Arc::new(Notify::new()), ultimo: Mutex::new(ultimo), arquivo });
            app.manage(estado.clone());
            tauri::async_runtime::spawn(laco(app.handle().clone(), estado));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![estado_inicial, atualizar, fechados, diff, acao])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o painel");
}
