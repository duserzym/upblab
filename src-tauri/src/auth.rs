//! One identity (plan decision 5): the shell signs in to UPbDB once and
//! hands the bearer token to module webviews through `bridge_token`.
//!
//! - Tokens live in the OS keychain (macOS Keychain, Windows Credential
//!   Manager), one entry per server under the service `edu.umn.upbstudio`;
//!   never in settings.json. An in-memory copy serves `bridge_token`.
//! - The shell page never sees the token. It asks for the account, for API
//!   reads (`api_get`, used by Home) and for a Studio handoff code; all HTTP to
//!   UPbDB is done here, so CORS and mixed-content rules of the shell page
//!   do not apply (same reasoning as `probe`).
//! - The "target" names the server (`server`, its base URL) and the keychain
//!   entry (`key`): the server URL for a lab server, `this-computer` for the
//!   local instance, whose port may change between launches (ADR-0003).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Runtime, State, Url, Webview};
use tokio::sync::watch;

/// Keychain service name (the app identifier in tauri.conf.json).
pub const KEYCHAIN_SERVICE: &str = "edu.umn.upbstudio";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Target {
    /// UPbDB base URL, e.g. `http://127.0.0.1:8000` (no trailing slash).
    pub server: String,
    /// Keychain account name for this server's token.
    pub key: String,
}

impl Target {
    fn base(&self) -> Result<Url, String> {
        let url: Url = self.server.trim().parse().map_err(|e| format!("invalid server URL {:?}: {e}", self.server))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(format!("server URL must be http or https, not {}", url.scheme()));
        }
        if self.key.trim().is_empty() || self.key.len() > 512 {
            return Err("invalid keychain key".into());
        }
        Ok(url)
    }

    /// `<server>/v1/<path>`, keeping any path prefix of the server URL.
    fn endpoint(&self, path: &str) -> Result<Url, String> {
        let base = self.base()?;
        let prefix = base.path().trim_end_matches('/');
        let mut url = base.clone();
        url.set_path(&format!("{prefix}{path}"));
        url.set_query(None);
        url.set_fragment(None);
        Ok(url)
    }
}

/// Where tokens are kept. The keychain in the app; memory in tests, or when
/// `UPBSTUDIO_VAULT=memory` is set (headless runs on a machine without a
/// usable keychain).
pub trait Vault: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, token: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

pub struct KeychainVault;

impl Vault for KeychainVault {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(t) => Ok(Some(t)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("keychain read failed: {e}")),
        }
    }
    fn set(&self, key: &str, token: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())?;
        entry.set_password(token).map_err(|e| format!("keychain write failed: {e}"))
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("keychain delete failed: {e}")),
        }
    }
}

#[derive(Default)]
pub struct MemoryVault(Mutex<HashMap<String, String>>);

impl Vault for MemoryVault {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.get(key).cloned())
    }
    fn set(&self, key: &str, token: &str) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.insert(key.into(), token.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.remove(key);
        Ok(())
    }
}

pub struct Identity {
    vault: Box<dyn Vault>,
    http: reqwest::Client,
    /// The server the shell currently uses, with its token if signed in.
    active: watch::Sender<Option<(Target, Option<String>)>>,
}

impl Default for Identity {
    fn default() -> Self {
        let vault: Box<dyn Vault> = if std::env::var("UPBSTUDIO_VAULT").as_deref() == Ok("memory") {
            log::warn!("UPBSTUDIO_VAULT=memory: tokens are kept in memory only");
            Box::new(MemoryVault::default())
        } else {
            Box::new(KeychainVault)
        };
        Self::with_vault(vault)
    }
}

/// What the shell page learns about the signed-in account.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    signed_in: bool,
    /// UPbDB's `AccountOut` (username, display_name, is_lab_staff, …).
    account: Option<Value>,
    /// Signed in with a stored token, but the server could not be asked who we are.
    offline: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl AuthState {
    fn signed_out() -> Self {
        Self { signed_in: false, account: None, offline: false, error: None }
    }
}

/// An API reply for the shell page: status and JSON body (null when not JSON).
#[derive(Debug, Serialize)]
pub struct ApiReply {
    status: u16,
    body: Value,
}

/// UPbDB errors are `{"detail": "...", "code": "..."}` (sync contract,
/// November 2026): show `detail`, or `message` when `detail` is a list, else a
/// sentence for the status. Mirrors `ui/src/lib/server-error.ts`.
fn detail(body: &Value, status: u16) -> String {
    for key in ["detail", "message"] {
        if let Some(Value::String(s)) = body.get(key) {
            if !s.trim().is_empty() {
                return s.trim().to_owned();
            }
        }
    }
    match status {
        401 => "Sign in again to continue.".into(),
        403 => "Your account does not have access to this.".into(),
        404 => "The server does not have this item.".into(),
        409 => "This changed on the server in the meantime. Reload and try again.".into(),
        400 | 422 => "The server did not accept the request.".into(),
        500..=599 => "The server had a problem. Try again in a moment.".into(),
        _ => format!("The server refused the request (status {status})."),
    }
}

/// Only read endpoints under /v1/, with no tricks in the path.
fn valid_api_path(path: &str) -> bool {
    path.starts_with("/v1/")
        && path.len() < 1024
        && !path.contains("..")
        && !path.contains('#')
        && !path.contains('\\')
        && !path.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl Identity {
    pub fn with_vault(vault: Box<dyn Vault>) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(4))
            .user_agent(concat!("UPbLab/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Self { vault, http, active: watch::Sender::new(None) }
    }

    fn set_active(&self, target: &Target, token: Option<String>) {
        self.active.send_replace(Some((target.clone(), token)));
    }

    /// Token of the active server, if signed in.
    pub fn current_token(&self) -> Option<String> {
        self.active.borrow().as_ref().and_then(|(_, t)| t.clone())
    }

    pub fn current_server(&self) -> Option<String> {
        self.active.borrow().as_ref().map(|(t, _)| t.server.clone())
    }

    /// Wait (briefly) until the shell has said which server it uses: module
    /// webviews may ask for the token while the shell is still starting.
    async fn wait_for_active(&self, timeout: Duration) {
        let mut rx = self.active.subscribe();
        let _ = tokio::time::timeout(timeout, rx.wait_for(|a| a.is_some())).await;
    }

    async fn send_json(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<(u16, Value), String> {
        let res = req.send().await.map_err(|e| {
            if e.is_connect() || e.is_timeout() { format!("server unreachable: {e}") } else { e.to_string() }
        })?;
        let status = res.status().as_u16();
        let text = res.text().await.map_err(|e| e.to_string())?;
        let body = serde_json::from_str(&text).unwrap_or(Value::Null);
        Ok((status, body))
    }

    /// Store a token from login or exchange; returns the account it came with.
    fn adopt(&self, target: &Target, body: Value) -> Result<AuthState, String> {
        let token = body.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()).ok_or("no token in the reply")?;
        self.vault.set(&target.key, token)?;
        self.set_active(target, Some(token.to_string()));
        Ok(AuthState { signed_in: true, account: body.get("account").cloned(), offline: false, error: None })
    }

    pub async fn restore(&self, target: &Target) -> Result<AuthState, String> {
        target.base()?;
        let stored = self.vault.get(&target.key)?;
        // Make the token available to module webviews before validating it.
        self.set_active(target, stored.clone());
        let Some(token) = stored else { return Ok(AuthState::signed_out()) };
        let req = self.http.get(target.endpoint("/v1/accounts/me")?).bearer_auth(&token);
        match self.send_json(req).await {
            Ok((200, account)) => Ok(AuthState { signed_in: true, account: Some(account), offline: false, error: None }),
            Ok((401, _)) => {
                // Revoked or expired, or a different database at this address.
                self.vault.delete(&target.key)?;
                self.set_active(target, None);
                Ok(AuthState { error: Some("Your sign-in expired; please sign in again".into()), ..AuthState::signed_out() })
            }
            Ok((status, body)) => Ok(AuthState { signed_in: true, account: None, offline: true, error: Some(detail(&body, status)) }),
            Err(e) => Ok(AuthState { signed_in: true, account: None, offline: true, error: Some(e) }),
        }
    }

    pub async fn login(&self, target: &Target, username: &str, password: &str) -> Result<AuthState, String> {
        let body = serde_json::json!({ "username": username, "password": password });
        let (status, reply) = self.send_json(self.http.post(target.endpoint("/v1/auth/login")?).json(&body)).await?;
        if status != 200 {
            return Err(detail(&reply, status));
        }
        self.adopt(target, reply)
    }

    /// The one-time code from an ORCID or Google sign-in in the system browser.
    pub async fn exchange(&self, target: &Target, code: &str) -> Result<AuthState, String> {
        let body = serde_json::json!({ "code": code });
        let (status, reply) = self.send_json(self.http.post(target.endpoint("/v1/auth/exchange")?).json(&body)).await?;
        if status != 200 {
            return Err(detail(&reply, status));
        }
        self.adopt(target, reply)
    }

    /// Revoke the token on the server (best effort) and forget it here.
    pub async fn logout(&self, target: &Target) -> Result<AuthState, String> {
        target.base()?;
        let token = self.vault.get(&target.key)?;
        self.vault.delete(&target.key)?;
        self.set_active(target, None);
        if let Some(token) = token {
            if let Err(e) = self.send_json(self.http.post(target.endpoint("/v1/auth/logout")?).bearer_auth(token)).await {
                log::warn!("could not revoke the token on {}: {e}", target.server);
            }
        }
        Ok(AuthState::signed_out())
    }

    /// A single-use, five-minute code for UPbRPy Studio (docs/WORKFLOW.md section 4).
    pub async fn handoff(&self, target: &Target) -> Result<String, String> {
        let token = self.vault.get(&target.key)?.ok_or("not signed in")?;
        let (status, reply) = self
            .send_json(self.http.post(target.endpoint("/v1/auth/handoff")?).bearer_auth(token).json(&serde_json::json!({})))
            .await?;
        if !(200..300).contains(&status) {
            return Err(format!("Could not open the app: {}", detail(&reply, status)));
        }
        reply.get("code").and_then(Value::as_str).map(str::to_string).ok_or_else(|| "no code in the handoff reply".into())
    }

    /// GET a read endpoint as the signed-in account (anonymous when signed out).
    pub async fn get(&self, target: &Target, path_and_query: &str) -> Result<ApiReply, String> {
        let (path, query) = path_and_query.split_once('?').unwrap_or((path_and_query, ""));
        if !valid_api_path(path) {
            return Err(format!("refused API path {path:?}"));
        }
        let mut url = target.endpoint(path)?;
        if !query.is_empty() {
            url.set_query(Some(query));
        }
        let mut req = self.http.get(url).header("Accept", "application/json");
        if let Some(token) = self.vault.get(&target.key)? {
            req = req.bearer_auth(token);
        }
        let (status, body) = self.send_json(req).await?;
        Ok(ApiReply { status, body })
    }
}

/// Origin of a URL as `scheme://host[:port]`.
fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// May this module page receive the token of `server`? Bundled builds (the
/// app's own origin) and pages from the server itself; nothing else.
pub fn may_receive_token(page: &Url, server: &str) -> bool {
    let local = page.scheme() == "tauri"
        || page.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && page.host_str() == Some("localhost") && page.port() == Some(1420));
    if local {
        return true;
    }
    match server.parse::<Url>() {
        Ok(s) => origin(&s) == origin(page),
        Err(_) => false,
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub async fn auth_restore(identity: State<'_, Identity>, target: Target) -> Result<AuthState, String> {
    identity.restore(&target).await
}

#[tauri::command]
pub async fn auth_login(
    identity: State<'_, Identity>,
    target: Target,
    username: String,
    password: String,
) -> Result<AuthState, String> {
    let state = identity.login(&target, username.trim(), &password).await?;
    log::info!("signed in to {} as {}", target.server, username.trim());
    Ok(state)
}

#[tauri::command]
pub async fn auth_exchange(identity: State<'_, Identity>, target: Target, code: String) -> Result<AuthState, String> {
    if code.is_empty() || code.len() > 512 {
        return Err("invalid sign-in code".into());
    }
    let state = identity.exchange(&target, &code).await?;
    log::info!("signed in to {} through the browser", target.server);
    Ok(state)
}

#[tauri::command]
pub async fn auth_logout(identity: State<'_, Identity>, target: Target) -> Result<AuthState, String> {
    let state = identity.logout(&target).await?;
    log::info!("signed out of {}", target.server);
    Ok(state)
}

#[tauri::command]
pub async fn auth_handoff(identity: State<'_, Identity>, target: Target) -> Result<String, String> {
    identity.handoff(&target).await
}

#[tauri::command]
pub async fn api_get(identity: State<'_, Identity>, target: Target, path: String) -> Result<ApiReply, String> {
    identity.get(&target, &path).await
}

/// The bearer token for a module webview (`@lab/bridge` `token()`), or None
/// when signed out or when the page is not one the token is meant for.
pub async fn token_for<R: Runtime>(identity: &Identity, webview: &Webview<R>) -> Option<String> {
    identity.wait_for_active(Duration::from_secs(3)).await;
    let server = identity.current_server()?;
    let page = webview.url().ok()?;
    if !may_receive_token(&page, &server) {
        log::warn!("withheld the token from {} ({})", webview.label(), origin(&page));
        return None;
    }
    identity.current_token()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn identity() -> Identity {
        Identity::with_vault(Box::new(MemoryVault::default()))
    }

    /// A one-route-per-request fake UPbDB: answers `n` requests from `routes`.
    fn fake_server(n: usize, routes: fn(&str, &str, &str) -> (u16, String)) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().take(n) {
                let mut s = stream.unwrap();
                let mut buf = vec![0u8; 16384];
                let mut got = 0;
                // Read headers and a small body.
                loop {
                    let k = s.read(&mut buf[got..]).unwrap();
                    got += k;
                    let text = String::from_utf8_lossy(&buf[..got]).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text
                            .lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length: ").map(|v| v.trim().parse::<usize>().unwrap()))
                            .unwrap_or(0);
                        if got >= end + 4 + len || k == 0 {
                            break;
                        }
                    }
                    if k == 0 {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&buf[..got]).to_string();
                let first = text.lines().next().unwrap_or("").to_string();
                let auth = text
                    .lines()
                    .find_map(|l| l.strip_prefix("authorization: ").or_else(|| l.strip_prefix("Authorization: ")))
                    .unwrap_or("")
                    .to_string();
                let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
                let (status, reply) = routes(&first, &auth, &body);
                let _ = write!(
                    s,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
        });
        format!("http://{addr}")
    }

    fn target(server: &str) -> Target {
        Target { server: server.into(), key: server.into() }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn login_stores_the_token_and_hands_it_out() {
        let server = fake_server(1, |first, _, body| {
            assert!(first.starts_with("POST /v1/auth/login "), "{first}");
            assert!(body.contains("\"username\":\"analyst\""));
            (200, r#"{"token":"tok-1","account":{"username":"analyst","display_name":"Analyst"}}"#.into())
        });
        let id = identity();
        let t = target(&server);
        let s = rt().block_on(id.login(&t, "analyst", "pw")).unwrap();
        assert!(s.signed_in);
        assert_eq!(s.account.unwrap()["username"], "analyst");
        assert_eq!(id.vault.get(&t.key).unwrap().as_deref(), Some("tok-1"));
        assert_eq!(id.current_token().as_deref(), Some("tok-1"));
    }

    #[test]
    fn error_detail_prefers_detail_then_message_then_a_sentence() {
        assert_eq!(
            detail(
                &serde_json::json!({"detail": "Mount changed.", "code": "revision_conflict"}),
                409
            ),
            "Mount changed."
        );
        assert_eq!(
            detail(
                &serde_json::json!({"detail": ["a"], "message": "1 item needs fixing."}),
                422
            ),
            "1 item needs fixing."
        );
        assert_eq!(
            detail(&Value::Null, 503),
            "The server had a problem. Try again in a moment."
        );
        assert!(!detail(&Value::Null, 418).starts_with("HTTP"));
    }

    #[test]
    fn failed_login_reports_the_server_detail() {
        let server = fake_server(1, |_, _, _| (401, r#"{"detail":"Invalid username or password"}"#.into()));
        let err = rt().block_on(identity().login(&target(&server), "x", "y")).unwrap_err();
        assert_eq!(err, "Invalid username or password");
    }

    #[test]
    fn restore_validates_and_clears_a_revoked_token() {
        let server = fake_server(1, |first, auth, _| {
            assert!(first.starts_with("GET /v1/accounts/me "));
            assert_eq!(auth, "Bearer old");
            (401, r#"{"detail":"Unauthorized"}"#.into())
        });
        let id = identity();
        let t = target(&server);
        id.vault.set(&t.key, "old").unwrap();
        let s = rt().block_on(id.restore(&t)).unwrap();
        assert!(!s.signed_in);
        assert_eq!(id.vault.get(&t.key).unwrap(), None);
        assert_eq!(id.current_token(), None);
    }

    #[test]
    fn restore_keeps_the_token_when_the_server_is_down() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let t = target(&format!("http://127.0.0.1:{port}"));
        let id = identity();
        id.vault.set(&t.key, "kept").unwrap();
        let s = rt().block_on(id.restore(&t)).unwrap();
        assert!(s.signed_in && s.offline);
        assert_eq!(id.current_token().as_deref(), Some("kept"));
    }

    #[test]
    fn logout_forgets_and_revokes() {
        let server = fake_server(1, |first, auth, _| {
            assert!(first.starts_with("POST /v1/auth/logout "));
            assert_eq!(auth, "Bearer tok");
            (204, String::new())
        });
        let id = identity();
        let t = target(&server);
        id.vault.set(&t.key, "tok").unwrap();
        rt().block_on(id.logout(&t)).unwrap();
        assert_eq!(id.vault.get(&t.key).unwrap(), None);
        assert_eq!(id.current_token(), None);
    }

    #[test]
    fn handoff_returns_the_code() {
        let server = fake_server(1, |first, auth, _| {
            assert!(first.starts_with("POST /v1/auth/handoff "));
            assert_eq!(auth, "Bearer tok");
            (200, r#"{"code":"abc123","expires_at":"2026-11-03T12:05:00Z"}"#.into())
        });
        let id = identity();
        let t = target(&server);
        id.vault.set(&t.key, "tok").unwrap();
        assert_eq!(rt().block_on(id.handoff(&t)).unwrap(), "abc123");
    }

    #[test]
    fn handoff_needs_a_sign_in() {
        let err = rt().block_on(identity().handoff(&target("http://127.0.0.1:9"))).unwrap_err();
        assert!(err.contains("not signed in"));
    }

    #[test]
    fn api_get_keeps_query_and_server_prefix() {
        let server = fake_server(1, |first, _, _| {
            assert!(first.starts_with("GET /lab/v1/sessions?material=zircon "), "{first}");
            (200, "[]".into())
        });
        let t = target(&format!("{server}/lab"));
        let r = rt().block_on(identity().get(&t, "/v1/sessions?material=zircon")).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, serde_json::json!([]));
    }

    #[test]
    fn api_paths_are_checked() {
        assert!(valid_api_path("/v1/sessions"));
        assert!(valid_api_path("/v1/mounts/0190/atlas"));
        assert!(!valid_api_path("/admin/"));
        assert!(!valid_api_path("/v1/../admin"));
        assert!(!valid_api_path("/v1/a b"));
        assert!(!valid_api_path("http://evil/v1/"));
    }

    #[test]
    fn token_goes_only_to_the_app_origin_and_the_server() {
        let server = "http://127.0.0.1:8000";
        assert!(may_receive_token(&"tauri://localhost/modules/grainatlas/index.html".parse().unwrap(), server));
        assert!(may_receive_token(&"http://tauri.localhost/modules/grainatlas/index.html".parse().unwrap(), server));
        assert!(may_receive_token(&"http://127.0.0.1:8000/app/#/sessions".parse().unwrap(), server));
        assert!(!may_receive_token(&"http://127.0.0.1:8001/app/".parse().unwrap(), server));
        assert!(!may_receive_token(&"https://example.com/".parse().unwrap(), server));
    }

    /// Against a real UPbDB with the demo data, and the real OS keychain:
    /// `UPBSTUDIO_LIVE_SERVER=http://127.0.0.1:8017 cargo test live_ -- --ignored`
    /// (user analyst / upbdb-demo unless UPBSTUDIO_LIVE_USER / _PASSWORD say otherwise).
    #[test]
    #[ignore]
    fn live_sign_in_handoff_and_keychain() {
        let Ok(server) = std::env::var("UPBSTUDIO_LIVE_SERVER") else { return };
        let user = std::env::var("UPBSTUDIO_LIVE_USER").unwrap_or_else(|_| "analyst".into());
        let pw = std::env::var("UPBSTUDIO_LIVE_PASSWORD").unwrap_or_else(|_| "upbdb-demo".into());
        let id = Identity::with_vault(Box::new(KeychainVault));
        let t = Target { server: server.clone(), key: format!("{server} (upbstudio live test)") };
        let rt = rt();
        let s = rt.block_on(id.login(&t, &user, &pw)).unwrap();
        assert_eq!(s.account.as_ref().unwrap()["username"], user.as_str());
        // In the keychain, and restored from there by a fresh Identity.
        assert!(KeychainVault.get(&t.key).unwrap().is_some());
        let fresh = Identity::with_vault(Box::new(KeychainVault));
        let r = rt.block_on(fresh.restore(&t)).unwrap();
        assert!(r.signed_in && !r.offline, "{r:?}");
        let sessions = rt.block_on(fresh.get(&t, "/v1/sessions")).unwrap();
        assert_eq!(sessions.status, 200);
        let first = sessions.body[0]["id"].as_str().unwrap().to_string();
        let runs = rt.block_on(fresh.get(&t, &format!("/v1/sessions/{first}/reductions"))).unwrap();
        assert_eq!(runs.status, 200);
        let mounts = rt.block_on(fresh.get(&t, "/v1/mounts")).unwrap();
        assert_eq!(mounts.status, 200);
        if let Some(m) = mounts.body.get(0).and_then(|m| m["id"].as_str()) {
            let atlas = rt.block_on(fresh.get(&t, &format!("/v1/mounts/{m}/atlas"))).unwrap();
            eprintln!("GET /v1/mounts/{m}/atlas -> {}", atlas.status);
        }
        // The handoff code is what Studio exchanges for its own token.
        let code = rt.block_on(fresh.handoff(&t)).unwrap();
        let studio = Identity::with_vault(Box::new(MemoryVault::default()));
        let st = Target { server: server.clone(), key: "studio".into() };
        let ex = rt.block_on(studio.exchange(&st, &code)).unwrap();
        assert_eq!(ex.account.unwrap()["username"], user.as_str());
        assert!(rt.block_on(studio.exchange(&st, &code)).is_err(), "a handoff code is single-use");
        rt.block_on(studio.logout(&st)).unwrap();
        // Sign-out revokes the token on the server and clears the keychain entry.
        let token = KeychainVault.get(&t.key).unwrap().unwrap();
        rt.block_on(fresh.logout(&t)).unwrap();
        assert_eq!(KeychainVault.get(&t.key).unwrap(), None);
        let other = Identity::with_vault(Box::new(MemoryVault::default()));
        other.vault.set(&t.key, &token).unwrap();
        let after = rt.block_on(other.restore(&t)).unwrap();
        assert!(!after.signed_in, "revoked token must be refused: {after:?}");
        eprintln!("live: signed in as {user}, {} sessions, handoff exchanged once, signed out", sessions.body.as_array().unwrap().len());
    }

    #[test]
    fn targets_are_checked() {
        assert!(Target { server: "file:///x".into(), key: "k".into() }.base().is_err());
        assert!(Target { server: "http://x".into(), key: "".into() }.base().is_err());
        let t = Target { server: "http://h:1/p/".into(), key: "k".into() };
        assert_eq!(t.endpoint("/v1/x").unwrap().as_str(), "http://h:1/p/v1/x");
    }
}
