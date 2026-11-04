//! "This computer" mode (ADR-0003): the shell runs PostgreSQL 17 and the
//! laicpmsdb service on this machine, starts both when asked by the shell
//! page (on launch, or from the first-run wizard), reports progress as
//! `local-service://status` events, and stops both on quit.
//!
//! Files (see docs/installing.md):
//! - `<app local data>/laicpmsdb/pg/`          PostgreSQL data directory
//! - `<app local data>/laicpmsdb/postgresql/`  unpacked bundled binaries
//! - `<app local data>/laicpmsdb/shell.pid`    which UPb Studio owns them
//! - `<app local data>/laicpmsdb/service.pid`  the running service, for clean-up after a crash
//! - `<app log dir>/postgres.log`, `laicpmsdb.log`
//! - store `local-service.json`                 generated passwords and secret key

pub mod guard;
mod health;
mod pidfile;
mod ports;
mod postgres;
mod process;
mod service;

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::async_runtime::Mutex as AsyncMutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::SHELL_WEBVIEW;
use pidfile::{assess_owner, assess_service, OwnerState};
use process::OsProbe;

pub const EVENT_STATUS: &str = "local-service://status";
const STORE: &str = "local-service.json";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(60);
const PG_READY_TIMEOUT: Duration = Duration::from_secs(60);
const SERVICE_GRACE: Duration = Duration::from_secs(5);
const TAIL_LINES: usize = 40;

#[derive(Clone, Copy, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Idle,
    Starting,
    Ready,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    /// PostgreSQL: "bundled 17.11.0" or "PG_BIN …"; service: "bundle" or "dev".
    pub source: Option<String>,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: Phase,
    /// What is happening now, for people ("Starting PostgreSQL…").
    pub step: String,
    pub postgres: Part,
    pub service: Part,
    /// `http://127.0.0.1:<port>` once healthy.
    pub url: Option<String>,
    pub error: Option<String>,
    /// Tail of the log of the part that failed.
    pub log_tail: Option<String>,
    /// Version of the service bundle in this build, if any.
    pub bundle: Option<String>,
    /// Development builds: the laicpmsdb checkout pinned as `local` in modules.lock.json.
    pub dev_default: Option<String>,
    pub log_dir: String,
    pub data_dir: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    pub data_root: String,
    #[serde(default)]
    pub dev_path: Option<String>,
    #[serde(default)]
    pub pg_bin: Option<String>,
}

struct Running {
    bins: postgres::Binaries,
    pg: Option<Child>,
    svc: Option<Child>,
    source: Option<service::Source>,
    env: Vec<(String, String)>,
    data_root: PathBuf,
}

#[derive(Default)]
pub struct LocalService {
    status: Mutex<Status>,
    run: Mutex<Option<Running>>,
    /// One start, stop or bootstrap at a time.
    op: AsyncMutex<()>,
    cancel: AtomicBool,
    guard: Mutex<Option<guard::Guard>>,
}

struct Paths {
    base: PathBuf,
    data: PathBuf,
    install: PathBuf,
    owner: PathBuf,
    service_pid: PathBuf,
    logs: PathBuf,
    pg_log: PathBuf,
    svc_log: PathBuf,
}

fn paths<R: Runtime>(app: &AppHandle<R>) -> Result<Paths, String> {
    // Local, not roaming, app data on Windows (%LOCALAPPDATA%): a database
    // and 100 MB of binaries must not travel with a roaming profile. On
    // macOS both are ~/Library/Application Support/<identifier>.
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("laicpmsdb");
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    Ok(Paths {
        data: base.join("pg"),
        install: base.join("postgresql"),
        owner: base.join("shell.pid"),
        service_pid: base.join("service.pid"),
        pg_log: logs.join("postgres.log"),
        svc_log: logs.join("laicpmsdb.log"),
        logs,
        base,
    })
}

fn emit<R: Runtime>(app: &AppHandle<R>, status: Status) {
    if let Err(e) = app.emit_to(EventTarget::webview(SHELL_WEBVIEW), EVENT_STATUS, status) {
        log::debug!("local-service status not delivered: {e}");
    }
}

fn update<R: Runtime>(app: &AppHandle<R>, f: impl FnOnce(&mut Status)) {
    let state = app.state::<LocalService>();
    let snapshot = {
        let mut s = state.status.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut s);
        s.clone()
    };
    emit(app, snapshot);
}

fn step<R: Runtime>(app: &AppHandle<R>, text: &str) {
    log::info!("[local-service] {text}");
    let text = text.to_string();
    update(app, |s| s.step = text);
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS random number generator");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

struct Secrets {
    superuser: String,
    role: String,
    secret_key: String,
}

/// Generated once per installation, kept in the Tauri store.
fn secrets<R: Runtime>(app: &AppHandle<R>) -> Result<Secrets, String> {
    let store = app.store(STORE).map_err(|e| format!("could not open {STORE}: {e}"))?;
    let get = |key: &str, bytes: usize| {
        if let Some(v) = store.get(key).and_then(|v| v.as_str().map(str::to_string)).filter(|v| !v.is_empty()) {
            return v;
        }
        let v = random_hex(bytes);
        store.set(key, v.clone());
        v
    };
    let s = Secrets { superuser: get("pgSuperuserPassword", 24), role: get("pgPassword", 24), secret_key: get("djangoSecretKey", 32) };
    store.save().map_err(|e| format!("could not save {STORE}: {e}"))?;
    Ok(s)
}

/// The development checkout pinned as `local` of the `laicpmsdb-service`
/// entry in modules.lock.json, for development builds only.
fn dev_default() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let lock: serde_json::Value = serde_json::from_str(include_str!("../../../modules.lock.json")).ok()?;
    let local = lock.get("modules")?.as_array()?.iter().find(|m| m.get("name").and_then(|n| n.as_str()) == Some("laicpmsdb-service"))?.get("local")?.as_str()?;
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent()?;
    let p = repo.join(local);
    let p = std::fs::canonicalize(&p).unwrap_or(p);
    Some(p.to_string_lossy().replace('\\', "/"))
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Called from `setup`: work out what this build can do and say so in the log.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let resource = app.path().resource_dir().ok();
    let bundle = service::bundled(resource.as_deref());
    let p = paths(app).ok();
    let mut s = app.state::<LocalService>().status.lock().unwrap_or_else(|e| e.into_inner()).clone();
    s.bundle = bundle.as_ref().and_then(|b| b.version().map(str::to_string));
    s.dev_default = dev_default();
    if let Some(p) = &p {
        s.log_dir = p.logs.to_string_lossy().replace('\\', "/");
        s.data_dir = p.data.to_string_lossy().replace('\\', "/");
    }
    match &bundle {
        Some(b) => log::info!("laicpmsdb service bundle {} at {}", b.version().unwrap_or("?"), b.path().display()),
        None => log::info!(
            "laicpmsdb service bundle: not in this build (modules.lock.json has no release URL for it yet). \
             'This computer' mode needs a laicpmsdb checkout set in Settings{}; otherwise only 'Lab server' mode is available.",
            s.dev_default.as_ref().map(|d| format!(" (development default {d})")).unwrap_or_default()
        ),
    }
    log::info!("PostgreSQL for 'This computer' mode: bundled {}", postgres::bundled_version());
    *app.state::<LocalService>().status.lock().unwrap_or_else(|e| e.into_inner()) = s;
}

fn service_command(inv: &service::Invocation, env: &[(String, String)]) -> Command {
    let mut cmd = process::command(&inv.program);
    cmd.args(&inv.args).current_dir(&inv.cwd);
    for k in service::SCRUB {
        cmd.env_remove(k);
    }
    cmd.envs(env.iter().cloned()).envs(inv.env.iter().cloned());
    cmd
}

/// Run a service command to completion, output appended to the log.
fn run_to_end(state: &LocalService, inv: &service::Invocation, env: &[(String, String)], log: &Path) -> Result<bool, String> {
    let mut cmd = service_command(inv, env);
    process::log_to(&mut cmd, log).map_err(|e| e.to_string())?;
    let mut child = process::spawn(&mut cmd).map_err(|e| format!("could not run {}: {e}", inv.program.display()))?;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Ok(status.success());
        }
        if state.cancel.load(Ordering::SeqCst) {
            process::terminate(&mut child, SERVICE_GRACE);
            return Err("cancelled".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

enum Stage {
    Postgres,
    Service,
}

fn start_blocking<R: Runtime>(app: &AppHandle<R>, cfg: StartConfig) -> Result<(), (Stage, String)> {
    let state = app.state::<LocalService>();
    let cancelled = || state.cancel.load(Ordering::SeqCst);
    let pg_err = |e: String| (Stage::Postgres, e);
    let svc_err = |e: String| (Stage::Service, e);
    let p = paths(app).map_err(pg_err)?;
    std::fs::create_dir_all(&p.base).map_err(|e| pg_err(format!("{}: {e}", p.base.display())))?;

    // Is another UPb Studio (a release app next to a development build) using this database?
    let owner = std::fs::read_to_string(&p.owner).ok();
    if let OwnerState::Held { pid } = assess_owner(owner.as_deref(), std::process::id(), &OsProbe) {
        return Err(pg_err(format!(
            "Another UPb Studio (process {pid}) is running this computer's laicpmsdb. Quit it first, then retry."
        )));
    }
    std::fs::write(&p.owner, std::process::id().to_string()).map_err(|e| pg_err(e.to_string()))?;

    // A service left by a shell that was killed together with its watchdog.
    if let Some(pid) = assess_service(std::fs::read_to_string(&p.service_pid).ok().as_deref(), &OsProbe) {
        log::warn!("[local-service] stopping laicpmsdb pid {pid} left running by a previous UPb Studio");
        process::kill_tree(pid, SERVICE_GRACE);
    }
    let _ = std::fs::remove_file(&p.service_pid);

    // Locate the service before starting anything, so a missing one fails fast.
    let resource = app.path().resource_dir().ok();
    let dev = non_empty(cfg.dev_path.clone()).map(|d| service::expand_home(&d, home().as_deref()));
    let source = service::locate(resource.as_deref(), dev.as_deref()).map_err(svc_err)?;
    let data_root = service::expand_home(non_empty(Some(cfg.data_root.clone())).as_deref().unwrap_or("~/laicpmsdb"), home().as_deref());
    std::fs::create_dir_all(&data_root).map_err(|e| svc_err(format!("could not create the data root {}: {e}", data_root.display())))?;
    if matches!(source, service::Source::Dev { .. }) {
        for d in service::DATA_ROOT_DIRS {
            let _ = std::fs::create_dir_all(data_root.join(d));
        }
    }

    // PostgreSQL binaries: PG_BIN (environment, then Settings) or bundled.
    step(app, "Preparing PostgreSQL…");
    let pg_override = non_empty(std::env::var("PG_BIN").ok())
        .or_else(|| non_empty(cfg.pg_bin.clone()))
        .map(|d| service::expand_home(&d, home().as_deref()));
    let bins = tauri::async_runtime::block_on(postgres::ensure_binaries(&p.install, pg_override.as_deref())).map_err(pg_err)?;
    log::info!("[local-service] PostgreSQL binaries: {} ({})", bins.bin_dir.display(), bins.source);
    let secrets = secrets(app).map_err(pg_err)?;

    if postgres::ensure_initialised(&bins, &p.data, &secrets.superuser, &p.pg_log).map_err(pg_err)? {
        log::info!("[local-service] created the PostgreSQL cluster in {}", p.data.display());
    }
    if let Some(msg) = postgres::clear_previous(&bins, &p.data, &p.pg_log) {
        log::warn!("[local-service] {msg}");
    }
    let pg_port = ports::pick(ports::PG_PREFERRED, ports::PG_LAST).ok_or_else(|| pg_err("no free port for PostgreSQL".into()))?;
    step(app, &format!("Starting PostgreSQL on port {pg_port}…"));
    let mut pg = postgres::start(&bins, &p.data, pg_port, &p.pg_log).map_err(pg_err)?;
    let pg_pid = pg.id();
    if let Some(g) = state.guard.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        g.watch_postgres(pg_pid);
    }
    let ready = postgres::wait_ready(&bins, pg_port, &mut pg, PG_READY_TIMEOUT, &cancelled);
    *state.run.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(Running { bins: bins.clone(), pg: Some(pg), svc: None, source: None, env: vec![], data_root: data_root.clone() });
    ready.map_err(pg_err)?;
    postgres::ensure_database(&bins, pg_port, &secrets.superuser, &secrets.role, &p.pg_log).map_err(|e| {
        pg_err(format!("{e}. If {STORE} was deleted, the database password is lost: move {} aside to start over.", p.data.display()))
    })?;
    update(app, |s| {
        s.postgres = Part {
            running: true,
            port: Some(pg_port),
            pid: Some(pg_pid),
            source: Some(bins.source.clone()),
            version: Some(postgres::bundled_version().into()).filter(|_| bins.source.starts_with("bundled")),
            path: Some(bins.bin_dir.to_string_lossy().replace('\\', "/")),
        }
    });

    // The service.
    let env = service::environment(&service::Environment {
        database_url: &service::database_url(&secrets.role, pg_port),
        data_root: &data_root,
        secret_key: &secrets.secret_key,
    });
    let port = ports::pick(ports::SERVICE_PREFERRED, ports::SERVICE_LAST).ok_or_else(|| svc_err("no free port for laicpmsdb".into()))?;
    let (pre, serve) = service::serve(&source, &data_root, port);
    for inv in &pre {
        step(app, "Updating the laicpmsdb database (migrations)…");
        if !run_to_end(&state, inv, &env, &p.svc_log).map_err(svc_err)? {
            return Err(svc_err("laicpmsdb migrations failed; see laicpmsdb.log".into()));
        }
    }
    step(app, &format!("Starting laicpmsdb on port {port}…"));
    let mut cmd = service_command(&serve, &env);
    process::log_to(&mut cmd, &p.svc_log).map_err(|e| svc_err(e.to_string()))?;
    let svc = process::spawn(&mut cmd).map_err(|e| svc_err(format!("could not start laicpmsdb: {e}")))?;
    let svc_pid = svc.id();
    let _ = std::fs::write(&p.service_pid, svc_pid.to_string());
    if let Some(g) = state.guard.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        g.watch_service(svc_pid);
    }
    if let Some(r) = state.run.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        r.svc = Some(svc);
        r.source = Some(source.clone());
        r.env = env.clone();
    }

    // Health (contract section 4).
    let (path, strict) = source.health();
    let url = format!("http://127.0.0.1:{port}");
    step(app, &format!("Waiting for laicpmsdb to answer at {url}{path}…"));
    let started = Instant::now();
    let version = loop {
        let exited = state
            .run
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .and_then(|r| r.svc.as_mut())
            .and_then(|c| c.try_wait().ok().flatten());
        if let Some(status) = exited {
            return Err(svc_err(format!("laicpmsdb exited during start-up ({status}); see laicpmsdb.log")));
        }
        if cancelled() {
            return Err(svc_err("cancelled".into()));
        }
        if let Ok(r) = health::get(port, path, Duration::from_secs(2)) {
            if health::healthy(&r, strict) {
                break health::version(&r);
            }
        }
        if started.elapsed() > HEALTH_TIMEOUT {
            return Err(svc_err(format!("laicpmsdb did not answer {url}{path} within {} s", HEALTH_TIMEOUT.as_secs())));
        }
        std::thread::sleep(Duration::from_millis(500));
    };
    log::info!("[local-service] laicpmsdb ready at {url} after {:.1} s", started.elapsed().as_secs_f32());
    update(app, |s| {
        s.phase = Phase::Ready;
        s.step = "Running on this computer".into();
        s.url = Some(url.clone());
        s.error = None;
        s.log_tail = None;
        s.service = Part {
            running: true,
            port: Some(port),
            pid: Some(svc_pid),
            source: Some(source.kind().into()),
            version: version.or_else(|| source.version().map(str::to_string)),
            path: Some(source.path().to_string_lossy().replace('\\', "/")),
        };
    });
    Ok(())
}

/// Stop the service, then PostgreSQL. Blocking; safe to call when nothing runs.
fn stop_blocking<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LocalService>();
    let Some(mut r) = state.run.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    let p = paths(app).ok();
    if let Some(mut svc) = r.svc.take() {
        step(app, "Stopping laicpmsdb…");
        process::terminate(&mut svc, SERVICE_GRACE);
        if let Some(g) = state.guard.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            g.forget_service();
        }
        if let Some(p) = p.as_ref() {
            let _ = std::fs::remove_file(&p.service_pid);
        }
    }
    if let (Some(mut pg), Some(p)) = (r.pg.take(), p.as_ref()) {
        step(app, "Stopping PostgreSQL…");
        postgres::stop(&r.bins, &p.data, &mut pg, &p.pg_log);
        if let Some(g) = state.guard.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            g.forget_postgres();
        }
    }
    if let Some(p) = p {
        if std::fs::read_to_string(&p.owner).ok().and_then(|t| t.trim().parse::<u32>().ok()) == Some(std::process::id()) {
            let _ = std::fs::remove_file(&p.owner);
        }
    }
    log::info!("[local-service] stopped");
}

async fn start_task<R: Runtime>(app: AppHandle<R>, cfg: StartConfig) {
    let state = app.state::<LocalService>();
    let current = || state.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // Already under way, or already running: just tell the page where things are.
    let Ok(_op) = state.op.try_lock() else { return emit(&app, current()) };
    if current().phase == Phase::Ready {
        return emit(&app, current());
    }
    state.cancel.store(false, Ordering::SeqCst);
    #[cfg(unix)]
    {
        let mut g = state.guard.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_none() {
            *g = guard::Guard::start();
        }
    }
    update(&app, |s| {
        s.phase = Phase::Starting;
        s.error = None;
        s.log_tail = None;
        s.url = None;
    });
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || start_blocking(&worker, cfg))
        .await
        .unwrap_or_else(|e| Err((Stage::Service, format!("start-up task failed: {e}"))));
    if let Err((stage, error)) = result {
        let cancelled = state.cancel.load(Ordering::SeqCst);
        let worker = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || stop_blocking(&worker)).await;
        let tail = paths(&app).ok().map(|p| process::tail(match stage {
            Stage::Postgres => &p.pg_log,
            Stage::Service => &p.svc_log,
        }, TAIL_LINES));
        if cancelled {
            update(&app, |s| reset(s, Phase::Stopped, "Stopped"));
        } else {
            log::error!("[local-service] start failed: {error}");
            update(&app, |s| {
                reset(s, Phase::Failed, "Could not start");
                s.error = Some(error);
                s.log_tail = tail;
            });
        }
    }
}

fn reset(s: &mut Status, phase: Phase, step: &str) {
    s.phase = phase;
    s.step = step.into();
    s.url = None;
    s.postgres = Part::default();
    s.service = Part::default();
}

async fn stop_task<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LocalService>();
    state.cancel.store(true, Ordering::SeqCst);
    let _op = state.op.lock().await;
    update(app, |s| s.phase = Phase::Stopping);
    let worker = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || stop_blocking(&worker)).await;
    update(app, |s| {
        reset(s, Phase::Stopped, "Stopped");
        s.error = None;
        s.log_tail = None;
    });
}

/// On quit (RunEvent::Exit): stop the service, then PostgreSQL, before the
/// process ends. Waits for a start in progress to notice the cancel flag.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<LocalService>();
    state.cancel.store(true, Ordering::SeqCst);
    let running = state.run.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    if !running && state.op.try_lock().is_ok() {
        return;
    }
    log::info!("[local-service] quitting: stopping laicpmsdb and PostgreSQL");
    let _op = tauri::async_runtime::block_on(state.op.lock());
    stop_blocking(app);
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn local_service_status<R: Runtime>(app: AppHandle<R>) -> Status {
    app.state::<LocalService>().status.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Start in the background; progress arrives as `local-service://status`.
/// Does nothing if already running or starting.
#[tauri::command]
pub fn local_service_start<R: Runtime>(app: AppHandle<R>, config: StartConfig) -> Status {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move { start_task(handle, config).await });
    local_service_status(app)
}

#[tauri::command]
pub async fn local_service_stop<R: Runtime>(app: AppHandle<R>) -> Result<Status, String> {
    stop_task(&app).await;
    Ok(local_service_status(app))
}

fn valid_username(u: &str) -> bool {
    !u.is_empty()
        && u.len() <= 150
        && !u.starts_with('-')
        && u.chars().all(|c| c.is_alphanumeric() || "@.+-_".contains(c))
}

/// First run: create the first staff account (password through a private
/// temporary file, never argv) and optionally load the demo data.
#[tauri::command]
pub async fn local_service_bootstrap<R: Runtime>(
    app: AppHandle<R>,
    username: String,
    email: String,
    password: String,
    load_demo: bool,
) -> Result<Status, String> {
    let username = username.trim().to_string();
    let email = email.trim().to_string();
    if !valid_username(&username) {
        return Err("A user name uses letters, digits and @ . + - _ only.".into());
    }
    if !email.contains('@') {
        return Err("Enter an email address.".into());
    }
    if password.chars().count() < 8 {
        return Err("The password needs at least 8 characters.".into());
    }
    let state = app.state::<LocalService>();
    let _op = state.op.lock().await;
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let state = worker.state::<LocalService>();
        let p = paths(&worker)?;
        let (source, env, data_root) = {
            let run = state.run.lock().unwrap_or_else(|e| e.into_inner());
            let r = run.as_ref().filter(|r| r.svc.is_some()).ok_or("laicpmsdb is not running on this computer")?;
            (r.source.clone().ok_or("laicpmsdb is not running")?, r.env.clone(), r.data_root.clone())
        };
        state.cancel.store(false, Ordering::SeqCst);
        step(&worker, &format!("Creating the account {username}…"));
        let pwfile = p.base.join(format!(".bootstrap-{}", random_hex(8)));
        postgres::write_secret_file(&pwfile, &password).map_err(|e| e.to_string())?;
        let result = service::bootstrap(&source, &data_root, &username, &email, &pwfile)
            .and_then(|inv| run_to_end(&state, &inv, &env, &p.svc_log));
        let _ = std::fs::remove_file(&pwfile);
        let ok = service::bootstrap_output_ok(&source, result?, &process::tail(&p.svc_log, 5));
        if !ok {
            step(&worker, "Running on this computer");
            return Err(format!("Could not create the account.\n{}", process::tail(&p.svc_log, TAIL_LINES)));
        }
        if load_demo {
            step(&worker, "Loading the demo data (a minute or so)…");
            if !run_to_end(&state, &service::load_demo(&source, &data_root), &env, &p.svc_log)? {
                step(&worker, "Running on this computer");
                return Err(format!("Loading the demo data failed.\n{}", process::tail(&p.svc_log, TAIL_LINES)));
            }
        }
        step(&worker, "Running on this computer");
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;
    drop(_op);
    Ok(local_service_status(app.clone()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Logs {
    dir: String,
    postgres: String,
    service: String,
}

#[tauri::command]
pub fn local_service_logs<R: Runtime>(app: AppHandle<R>, lines: Option<usize>) -> Result<Logs, String> {
    let p = paths(&app)?;
    let n = lines.unwrap_or(200).min(5000);
    Ok(Logs {
        dir: p.logs.to_string_lossy().replace('\\', "/"),
        postgres: process::tail(&p.pg_log, n),
        service: process::tail(&p.svc_log, n),
    })
}

/// Show the log folder in Finder or Explorer.
#[tauri::command]
pub fn local_service_open_logs<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = paths(&app)?;
    std::fs::create_dir_all(&p.logs).map_err(|e| e.to_string())?;
    app.opener().open_path(p.logs.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usernames() {
        assert!(valid_username("ada"));
        assert!(valid_username("ada.lovelace@umn.edu"));
        assert!(!valid_username(""));
        assert!(!valid_username("ada lovelace"));
        assert!(!valid_username("--help"), "would read as an option");
        assert!(!valid_username(&"a".repeat(151)));
    }

    #[test]
    fn random_hex_is_hex_and_differs() {
        let a = random_hex(16);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, random_hex(16));
    }

    #[test]
    fn status_serialises_for_the_shell_page() {
        let s = Status { phase: Phase::Ready, url: Some("http://127.0.0.1:8000".into()), ..Default::default() };
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["phase"], "ready");
        assert_eq!(v["url"], "http://127.0.0.1:8000");
        assert!(v.get("logTail").is_some() && v.get("devDefault").is_some());
    }
}
