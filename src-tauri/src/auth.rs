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
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Runtime, State, Url, Webview};
use tokio::sync::watch;

/// Keychain service name (the app identifier in tauri.conf.json).
pub const KEYCHAIN_SERVICE: &str = "edu.umn.upbstudio";

const AUTH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Target {
    /// UPbDB base URL, e.g. `http://127.0.0.1:8000` (no trailing slash).
    pub server: String,
    /// Keychain account name for this server's token.
    pub key: String,
}

impl Target {
    pub(crate) fn base(&self) -> Result<Url, String> {
        let url: Url = self
            .server
            .trim()
            .parse()
            .map_err(|e| format!("invalid server URL {:?}: {e}", self.server))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(format!(
                "server URL must be http or https, not {}",
                url.scheme()
            ));
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
        entry
            .set_password(token)
            .map_err(|e| format!("keychain write failed: {e}"))
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
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(key.into(), token.into());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.remove(key);
        Ok(())
    }
}

pub struct Identity {
    vault: Box<dyn Vault>,
    pub(crate) cache: crate::read_cache::ReadCache,
    http: reqwest::Client,
    offline_copies: Mutex<HashMap<String, String>>,
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
    offline_copy: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl AuthState {
    fn signed_out() -> Self {
        Self {
            signed_in: false,
            account: None,
            offline: false,
            offline_copy: None,
            error: None,
        }
    }
}

/// An API reply for the shell page. Invalid JSON keeps the status and a safe
/// diagnostic in `error`, including when a proxy answers with status 200.
#[derive(Debug, Serialize)]
pub struct ApiReply {
    #[serde(rename = "offlineCopy", skip_serializing_if = "Option::is_none")]
    pub(crate) offline_copy: Option<String>,
    pub(crate) status: u16,
    pub(crate) body: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cached: Option<CachedInfo>,
    #[serde(skip)]
    etag: Option<String>,
    #[serde(rename = "nextCursor", skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
    #[serde(rename = "retryAfter", skip_serializing_if = "Option::is_none")]
    retry_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip)]
    pub(crate) revalidated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedInfo {
    pub as_of: String,
    pub reason: String,
    pub detail: String,
}

impl ApiReply {
    fn from_text(status: u16, text: &str, secrets: &[String]) -> Self {
        match serde_json::from_str(text) {
            Ok(body) => Self {
                status,
                body,
                offline_copy: None,
                cached: None,
                etag: None,
                next_cursor: None,
                retry_after: None,
                revalidated: false,
                error: None,
            },
            Err(_) => {
                let excerpt = reply_excerpt(text, secrets);
                let error = format!("Server returned {status}: {excerpt}");
                Self {
                    status,
                    body: Value::Null,
                    offline_copy: None,
                    cached: None,
                    etag: None,
                    next_cursor: None,
                    retry_after: None,
                    revalidated: false,
                    error: Some(error),
                }
            }
        }
    }

    fn message(&self) -> String {
        self.error
            .clone()
            .unwrap_or_else(|| detail(&self.body, self.status))
    }
}

/// Proxy error pages can echo request credentials. Omit such bodies rather
/// than sending secrets to the page or logs. Bound by characters, not bytes.
fn reply_excerpt(text: &str, secrets: &[String]) -> String {
    let lower = text.to_ascii_lowercase();
    if secrets.iter().any(|s| !s.is_empty() && text.contains(s))
        || [
            "token",
            "bearer ",
            "authorization",
            "password",
            "secret",
            "code=",
            "code:",
            "\"code\"",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
        || text
            .split(|c: char| !c.is_ascii_alphanumeric() && !"_-./+=".contains(c))
            .any(|word| word.len() >= 32 && word.chars().any(|c| c.is_ascii_digit()))
    {
        return "[reply omitted because it may contain credentials]".into();
    }
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "Empty reply; expected JSON.".into();
    }
    let mut chars = collapsed.chars();
    let mut excerpt: String = chars.by_ref().take(200).collect();
    if chars.next().is_some() {
        excerpt.push('…');
    }
    excerpt
}

/// Only host, port and path: query strings and URL credentials may be secret.
fn reply_location(url: &Url) -> String {
    let mut location = url.host().map(|h| h.to_string()).unwrap_or_default();
    if let Some(port) = url.port() {
        location.push_str(&format!(":{port}"));
    }
    location.push_str(url.path());
    location
}

fn body_read_error(
    url: &Url,
    elapsed: Duration,
    status: u16,
    expected: Option<u64>,
    error: &reqwest::Error,
) -> String {
    let reason = if error.is_timeout() {
        "timed out"
    } else {
        let mut source = std::error::Error::source(error);
        let mut closed = false;
        while let Some(cause) = source {
            if let Some(io) = cause.downcast_ref::<std::io::Error>() {
                closed |= matches!(
                    io.kind(),
                    std::io::ErrorKind::UnexpectedEof
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                );
            }
            // Hyper also has an incomplete-message error without an io::Error.
            let description = cause.to_string();
            closed |= description.contains("end of file before message length reached")
                || description.contains("connection closed before message completed");
            source = cause.source();
        }
        if closed {
            "connection closed"
        } else if error.is_decode() {
            "could not decode the reply"
        } else {
            "connection interrupted"
        }
    };
    format_body_read_error(url, elapsed, status, expected, reason)
}

fn format_body_read_error(
    url: &Url,
    elapsed: Duration,
    status: u16,
    expected: Option<u64>,
    reason: &str,
) -> String {
    let expected = expected
        .map(|n| format!(", {n} bytes expected"))
        .unwrap_or_default();
    format!(
        "Reading the reply from {} failed after {:.1} s: {reason} (status {status}{expected})",
        reply_location(url),
        elapsed.as_secs_f64()
    )
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
pub(crate) fn valid_api_path(path: &str) -> bool {
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
            .read_timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(4))
            .user_agent(concat!("UPbLab/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client");
        Self {
            vault,
            cache: crate::read_cache::ReadCache::default(),
            http,
            offline_copies: Mutex::new(HashMap::new()),
            active: watch::Sender::new(None),
        }
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

    pub(crate) fn offline_copy(&self, server: &str) -> Option<String> {
        let normalized = normalized_server(server)?;
        self.offline_copies.lock().ok()?.get(&normalized).cloned()
    }
    fn remember_copy(&self, target: &Target, value: Option<String>) {
        let Some(server) = normalized_server(&target.server) else {
            return;
        };
        let mut copies = self.offline_copies.lock().unwrap();
        if let Some(value) = value {
            if copies.len() >= 32 && !copies.contains_key(&server) {
                if let Some(old) = copies.keys().next().cloned() {
                    copies.remove(&old);
                }
            }
            copies.insert(server, value);
        } else {
            copies.remove(&server);
        }
    }
    pub(crate) fn guard_grainatlas(&self, server: &str) -> Result<(), String> {
        if self.offline_copy(server).is_some() {
            Err("GrainAtlas cannot connect to a read-only copy of UPbDB".into())
        } else {
            Ok(())
        }
    }
    async fn send_json(
        &self,
        target: &Target,
        req: reqwest::RequestBuilder,
    ) -> Result<ApiReply, String> {
        let req = req
            .build()
            .map_err(|_| "Could not prepare the server request.".to_string())?;
        let mut secrets = Vec::new();
        if let Some(auth) = req
            .headers()
            .get(reqwest::header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
        {
            secrets.push(auth.strip_prefix("Bearer ").unwrap_or(auth).to_owned());
        }
        if let Some(body) = req
            .body()
            .and_then(|b| b.as_bytes())
            .and_then(|b| serde_json::from_slice::<Value>(b).ok())
        {
            for key in ["token", "password", "code"] {
                if let Some(secret) = body.get(key).and_then(Value::as_str) {
                    secrets.push(secret.to_owned());
                }
            }
        }
        let started = Instant::now();
        let res = self.http.execute(req).await.map_err(|e| {
            // Do not include reqwest's URL: it can contain a credential or query.
            if e.is_connect() {
                "server unreachable: connection failed".into()
            } else if e.is_timeout() {
                "Timed out waiting for the server's reply.".into()
            } else {
                "Could not send the server request.".to_string()
            }
        })?;
        let offline_copy = res
            .headers()
            .get("X-UPbDB-Offline-Copy")
            .and_then(|h| h.to_str().ok())
            .and_then(clean_offline_copy);
        self.remember_copy(target, offline_copy.clone());
        let next_cursor = res
            .headers()
            .get("X-Next-Cursor")
            .and_then(|h| h.to_str().ok())
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let etag = res
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        let retry_after = res
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        let status = res.status().as_u16();
        let url = res.url().clone();
        // Gzip removes Content-Length because the decoded size is unknown.
        let expected = res.content_length();
        let text = res
            .text()
            .await
            .map_err(|e| body_read_error(&url, started.elapsed(), status, expected, &e))?;
        let mut reply = ApiReply::from_text(status, &text, &secrets);
        reply.offline_copy = offline_copy;
        reply.etag = etag;
        reply.next_cursor = next_cursor;
        reply.retry_after = retry_after;
        Ok(reply)
    }

    /// Store a token from login or exchange; returns the account it came with.
    pub(crate) fn adopt(&self, target: &Target, body: Value) -> Result<AuthState, String> {
        let token = body
            .get("token")
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
            .ok_or("no token in the reply")?;
        // An unsuccessful keychain write must not associate its old token with
        // the newly signed-in account's mirror.
        self.cache.hide(target)?;
        self.vault.set(&target.key, token)?;
        if let Some(account) = body.get("account") {
            self.cache
                .adopt_with_copy(target, account, self.offline_copy(&target.server))
                .map_err(|e| format!("Could not prepare saved data for this account: {e}"))?;
        }
        self.set_active(target, Some(token.to_string()));
        Ok(AuthState {
            signed_in: true,
            account: body.get("account").cloned(),
            offline: false,
            offline_copy: self.offline_copy(&target.server),
            error: None,
        })
    }

    fn save_account(&self, target: &Target, account: &Value) {
        if let Err(e) =
            self.cache
                .adopt_with_copy(target, account, self.offline_copy(&target.server))
        {
            let _ = self.cache.hide(target);
            log::warn!("could not save account: {e}");
        }
    }

    pub async fn restore(&self, target: &Target) -> Result<AuthState, String> {
        target.base()?;
        let stored = self.vault.get(&target.key)?;
        // Withhold credentials until this target has been checked for copy marking.
        self.set_active(target, None);
        let Some(token) = stored else {
            self.cache.hide(target)?;
            return Ok(AuthState::signed_out());
        };
        let req = self
            .http
            .get(target.endpoint("/v1/accounts/me")?)
            .bearer_auth(&token)
            .timeout(AUTH_TIMEOUT);
        match self.send_json(target, req).await {
            Ok(reply) if reply.status == 200 && reply.error.is_none() => {
                self.save_account(target, &reply.body);
                self.cache.store(
                    target,
                    &crate::read_cache::Entry {
                        path: "/v1/accounts/me".into(),
                        body: reply.body.clone(),
                        stored_at: crate::read_cache::now(),
                        checked_at: None,
                        etag: reply.etag.clone(),
                        next_cursor: None,
                        offline_copy: reply.offline_copy.clone(),
                    },
                    self.cache.epoch(),
                );
                self.set_active(target, Some(token.clone()));
                Ok(AuthState {
                    signed_in: true,
                    account: Some(reply.body),
                    offline: false,
                    offline_copy: reply.offline_copy,
                    error: None,
                })
            }
            Ok(reply) if reply.status == 401 => {
                // Revoked or expired, or a different database at this address.
                self.cache.hide(target)?;
                self.vault.delete(&target.key)?;
                self.set_active(target, None);
                Ok(AuthState {
                    error: Some("Your sign-in expired; please sign in again".into()),
                    ..AuthState::signed_out()
                })
            }
            Ok(reply) => {
                self.set_active(target, Some(token.clone()));
                Ok(AuthState {
                    offline_copy: reply.offline_copy.clone(),
                    signed_in: true,
                    account: self.cache.account(target),
                    offline: true,
                    error: Some(reply.message()),
                })
            }
            Err(e) => {
                let offline_copy = self.cache.account_copy(target).or_else(|| {
                    self.cache
                        .load(target, "/v1/accounts/me")
                        .and_then(|e| e.offline_copy)
                });
                if offline_copy.is_some() {
                    self.remember_copy(target, offline_copy.clone());
                }
                self.set_active(target, Some(token.clone()));
                Ok(AuthState {
                    offline_copy,
                    signed_in: true,
                    account: self.cache.account(target),
                    offline: true,
                    error: Some(e),
                })
            }
        }
    }

    pub async fn login(
        &self,
        target: &Target,
        username: &str,
        password: &str,
    ) -> Result<AuthState, String> {
        let body = serde_json::json!({ "username": username, "password": password });
        let reply = self
            .send_json(
                target,
                self.http
                    .post(target.endpoint("/v1/auth/login")?)
                    .json(&body)
                    .timeout(AUTH_TIMEOUT),
            )
            .await?;
        if reply.status != 200 || reply.error.is_some() {
            return Err(reply.message());
        }
        self.adopt(target, reply.body)
    }

    /// The one-time code from an ORCID or Google sign-in in the system browser.
    pub async fn exchange(&self, target: &Target, code: &str) -> Result<AuthState, String> {
        let body = serde_json::json!({ "code": code });
        let reply = self
            .send_json(
                target,
                self.http
                    .post(target.endpoint("/v1/auth/exchange")?)
                    .json(&body)
                    .timeout(AUTH_TIMEOUT),
            )
            .await?;
        if reply.status != 200 || reply.error.is_some() {
            return Err(reply.message());
        }
        self.adopt(target, reply.body)
    }

    /// Revoke the token on the server (best effort) and forget it here.
    pub async fn logout(&self, target: &Target) -> Result<AuthState, String> {
        target.base()?;
        let token = self.vault.get(&target.key)?;
        self.cache.hide(target)?;
        self.vault.delete(&target.key)?;
        self.set_active(target, None);
        if let Some(token) = token {
            if let Err(e) = self
                .send_json(
                    target,
                    self.http
                        .post(target.endpoint("/v1/auth/logout")?)
                        .bearer_auth(token)
                        .timeout(AUTH_TIMEOUT),
                )
                .await
            {
                log::warn!("could not revoke the token on {}: {e}", target.server);
            }
        }
        Ok(AuthState::signed_out())
    }

    /// A single-use, five-minute code for UPbRPy Studio (docs/WORKFLOW.md section 4).
    pub async fn handoff(&self, target: &Target) -> Result<String, String> {
        self.handoff_with_oversight(target, false).await
    }
    async fn handoff_with_oversight(
        &self,
        target: &Target,
        on_behalf: bool,
    ) -> Result<String, String> {
        let token = self.vault.get(&target.key)?.ok_or("not signed in")?;
        let mut req = self
            .http
            .post(target.endpoint("/v1/auth/handoff")?)
            .bearer_auth(token)
            .json(&serde_json::json!({}))
            .timeout(AUTH_TIMEOUT);
        if on_behalf {
            req = req.header("X-UPbDB-Oversight", "on-behalf");
        }
        let reply = self.send_json(target, req).await?;
        if reply.status == 403
            && reply.body.get("code").and_then(Value::as_str) == Some("oversight_confirm")
        {
            return Err(
                serde_json::json!({ "status": reply.status, "body": reply.body }).to_string(),
            );
        }
        if !(200..300).contains(&reply.status) || reply.error.is_some() {
            return Err(format!("Could not open the app: {}", reply.message()));
        }
        reply
            .body
            .get("code")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "no code in the handoff reply".into())
    }

    /// Authenticated shell write. Consent is supplied for this operation only.
    pub async fn write(
        &self,
        target: &Target,
        path: &str,
        method: &str,
        body: Value,
        on_behalf: bool,
        idempotency_key: Option<String>,
    ) -> Result<ApiReply, String> {
        let req = self.write_request(
            target,
            path,
            method,
            &body,
            on_behalf,
            idempotency_key.as_deref(),
        )?;
        let mut reply = self.send_json(target, req).await?;
        if reply.status == 204 {
            reply.error = None;
        }
        Ok(reply)
    }

    fn write_request(
        &self,
        target: &Target,
        path: &str,
        method: &str,
        body: &Value,
        on_behalf: bool,
        idempotency_key: Option<&str>,
    ) -> Result<reqwest::RequestBuilder, String> {
        if let Some(key) = idempotency_key {
            if key.is_empty() || key.len() > 255 || !key.bytes().all(|b| (b'!'..=b'~').contains(&b))
            {
                return Err(
                    "Idempotency-Key must be 1–255 printable ASCII characters without whitespace."
                        .into(),
                );
            }
        }
        let (base, query) = path.split_once('?').unwrap_or((path, ""));
        if !valid_api_path(base)
            || url::form_urlencoded::parse(query.as_bytes()).any(|(key, _)| key == "as")
        {
            return Err("Refused write path or view-as query".into());
        }
        let method = match method {
            "POST" => reqwest::Method::POST,
            "PATCH" => reqwest::Method::PATCH,
            "PUT" => reqwest::Method::PUT,
            "DELETE" => reqwest::Method::DELETE,
            _ => return Err("Refused write method".into()),
        };
        let token = self.vault.get(&target.key)?.ok_or("not signed in")?;
        let mut url = target.endpoint(base)?;
        if !query.is_empty() {
            url.set_query(Some(query));
        }
        let mut req = self
            .http
            .request(method, url)
            .bearer_auth(token)
            .header("Accept", "application/json")
            .json(body);
        if on_behalf {
            req = req.header("X-UPbDB-Oversight", "on-behalf");
        }
        if let Some(key) = idempotency_key {
            req = req.header("Idempotency-Key", key);
        }
        Ok(req)
    }

    /// GET a read endpoint as the signed-in account (anonymous when signed out).
    pub async fn get(&self, target: &Target, path_and_query: &str) -> Result<ApiReply, String> {
        let (path, query) = path_and_query
            .split_once('?')
            .unwrap_or((path_and_query, ""));
        if !valid_api_path(path) {
            return Err(format!("refused API path {path:?}"));
        }
        let mut url = target.endpoint(path)?;
        if !query.is_empty() {
            url.set_query(Some(query));
        }
        let epoch = self.cache.epoch();
        let token = self.vault.get(&target.key)?;
        let saved = if token.is_some() {
            self.cache.load(target, path_and_query)
        } else {
            None
        };
        let mut req = self.http.get(url).header("Accept", "application/json");
        if let Some(token) = &token {
            req = req.bearer_auth(token);
        }
        if let Some(etag) = saved.as_ref().and_then(|e| e.etag.as_ref()) {
            req = req.header(reqwest::header::IF_NONE_MATCH, etag);
        }
        let fallback = |entry: crate::read_cache::Entry, reason: &str, detail: String| {
            if entry.offline_copy.is_some() {
                self.remember_copy(target, entry.offline_copy.clone());
            }
            ApiReply {
                offline_copy: entry.offline_copy.clone(),
                status: 200,
                cached: Some(CachedInfo {
                    as_of: entry.as_of(),
                    reason: reason.into(),
                    detail,
                }),
                body: entry.body,
                error: None,
                etag: None,
                next_cursor: entry.next_cursor,
                retry_after: None,
                revalidated: false,
            }
        };
        let response = self.send_json(target, req).await;
        if self.cache.epoch() != epoch || self.vault.get(&target.key)? != token {
            return Err("The account or saved data changed during the request. Try again.".into());
        }
        match response {
            Ok(reply) if reply.status == 304 && saved.is_some() => {
                let mut entry = saved.unwrap();
                entry.checked_at = Some(crate::read_cache::now());
                entry.offline_copy = reply.offline_copy;
                self.cache.revalidate(target, &entry, epoch);
                Ok(ApiReply {
                    offline_copy: entry.offline_copy,
                    status: 200,
                    body: entry.body,
                    cached: None,
                    error: None,
                    etag: entry.etag,
                    next_cursor: entry.next_cursor,
                    retry_after: None,
                    revalidated: true,
                })
            }
            Ok(reply)
                if matches!(reply.status, 502..=504)
                    || (reply.status >= 500 && reply.error.is_some()) =>
            {
                if let Some(entry) = saved {
                    Ok(fallback(
                        entry,
                        "server_error",
                        format!("Server returned {}: {}", reply.status, reply.message()),
                    ))
                } else {
                    Ok(reply)
                }
            }
            Ok(reply) => {
                if reply.status == 401 {
                    self.cache.hide(target)?;
                    self.vault.delete(&target.key)?;
                    self.set_active(target, None);
                }
                if reply.status == 200 && reply.error.is_none() && token.is_some() {
                    if path == "/v1/accounts/me" {
                        self.save_account(target, &reply.body);
                    }
                    self.cache.store(
                        target,
                        &crate::read_cache::Entry {
                            offline_copy: reply.offline_copy.clone(),
                            path: path_and_query.into(),
                            etag: reply.etag.clone(),
                            stored_at: crate::read_cache::now(),
                            checked_at: None,
                            body: reply.body.clone(),
                            next_cursor: reply.next_cursor.clone(),
                        },
                        epoch,
                    );
                }
                Ok(reply)
            }
            Err(error) => match saved {
                Some(entry) => Ok(fallback(entry, "unreachable", error)),
                None => Err(error),
            },
        }
    }
}

fn normalized_server(server: &str) -> Option<String> {
    let mut url: Url = server.trim().parse().ok()?;
    url.set_query(None);
    url.set_fragment(None);
    Some(url.as_str().trim_end_matches('/').to_owned())
}
fn clean_offline_copy(text: &str) -> Option<String> {
    let clean: String = text.chars().filter(|c| !c.is_control()).collect();
    let clean: String = clean.trim().chars().take(200).collect();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
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
        || (cfg!(debug_assertions)
            && page.host_str() == Some("localhost")
            && page.port() == Some(1420));
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
pub async fn auth_restore(
    identity: State<'_, Identity>,
    target: Target,
) -> Result<AuthState, String> {
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
pub async fn auth_exchange(
    identity: State<'_, Identity>,
    target: Target,
    code: String,
) -> Result<AuthState, String> {
    if code.is_empty() || code.len() > 512 {
        return Err("invalid sign-in code".into());
    }
    let state = identity.exchange(&target, &code).await?;
    log::info!("signed in to {} through the browser", target.server);
    Ok(state)
}

#[tauri::command]
pub async fn auth_logout(
    identity: State<'_, Identity>,
    target: Target,
) -> Result<AuthState, String> {
    let state = identity.logout(&target).await?;
    log::info!("signed out of {}", target.server);
    Ok(state)
}

#[tauri::command]
pub async fn auth_handoff(
    identity: State<'_, Identity>,
    oversight: State<'_, crate::bridge::OversightState>,
    target: Target,
    on_behalf: Option<bool>,
) -> Result<String, String> {
    oversight.writable()?;
    if on_behalf.unwrap_or(false) {
        identity.handoff_with_oversight(&target, true).await
    } else {
        identity.handoff(&target).await
    }
}

#[tauri::command]
pub async fn api_get(
    identity: State<'_, Identity>,
    target: Target,
    path: String,
) -> Result<ApiReply, String> {
    identity.get(&target, &path).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Backward-compatible named IPC arguments, including optional key.
pub async fn api_write(
    identity: State<'_, Identity>,
    oversight: State<'_, crate::bridge::OversightState>,
    target: Target,
    path: String,
    method: String,
    body: Value,
    on_behalf: bool,
    idempotency_key: Option<String>,
) -> Result<ApiReply, String> {
    oversight.writable()?;
    identity
        .write(&target, &path, &method, body, on_behalf, idempotency_key)
        .await
}

/// The bearer token for a module webview (`@lab/bridge` `token()`), or None
/// when signed out or when the page is not one the token is meant for.
pub async fn token_for<R: Runtime>(identity: &Identity, webview: &Webview<R>) -> Option<String> {
    identity.wait_for_active(Duration::from_secs(3)).await;
    let server = identity.current_server()?;
    let page = webview.url().ok()?;
    if !may_receive_token(&page, &server) {
        log::warn!(
            "withheld the token from {} ({})",
            webview.label(),
            origin(&page)
        );
        return None;
    }
    identity.current_token()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn identity() -> Identity {
        Identity::with_vault(Box::new(MemoryVault::default()))
    }

    /// A one-route-per-request fake UPbDB: answers `n` requests from `routes`.
    pub(crate) fn fake_server(n: usize, routes: fn(&str, &str, &str) -> (u16, String)) -> String {
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
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
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
                    .find_map(|l| {
                        l.strip_prefix("authorization: ")
                            .or_else(|| l.strip_prefix("Authorization: "))
                    })
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
        Target {
            server: server.into(),
            key: server.into(),
        }
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    /// GET-only server for partial, stalled or encoded response bodies.
    pub(crate) fn raw_server(
        reply: impl FnOnce(std::net::TcpStream, String) + Send + 'static,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                if stream.read(&mut byte).unwrap() == 0 {
                    return;
                }
                request.push(byte[0]);
            }
            reply(stream, String::from_utf8(request).unwrap());
        });
        format!("http://{addr}")
    }

    #[test]
    fn offline_copy_guard_normalizes_targets_and_preserves_embedded_module_access() {
        let id = identity();
        let target = target("https://copy.invalid/");
        id.remember_copy(&target, clean_offline_copy("  invented\t copy\u{7f}  "));
        id.set_active(&target, Some("invented-token".into()));
        assert_eq!(
            id.current_server().as_deref(),
            Some("https://copy.invalid/")
        );
        assert_eq!(id.current_token().as_deref(), Some("invented-token"));
        assert_eq!(
            id.offline_copy("https://copy.invalid").as_deref(),
            Some("invented copy")
        );
        assert!(id.guard_grainatlas("https://copy.invalid").is_err());
        assert!(id.guard_grainatlas("https://another.invalid").is_ok());
        let page = "tauri://localhost/modules/grainatlas/index.html"
            .parse()
            .unwrap();
        assert!(may_receive_token(&page, &target.server));
        let page = "https://copy.invalid/app/".parse().unwrap();
        assert!(may_receive_token(&page, &target.server));
        assert_eq!(
            clean_offline_copy(&"é".repeat(210))
                .unwrap()
                .chars()
                .count(),
            200
        );
        assert!(clean_offline_copy(" \t ").is_none());
        id.remember_copy(&target, None);
        assert!(id.guard_grainatlas("https://copy.invalid").is_ok());
    }

    #[test]
    fn offline_copy_header_restores_caches_and_guards_only_standalone_grainatlas() {
        const MARKER: &str = "offline copy as of 2026-11-17 21:49 UTC, read-only";
        let server = raw_server(|mut stream, _| {
            let body = r#"{"id":"invented","username":"analyst"}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nX-UPbDB-Offline-Copy:  {MARKER}  \r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let dir = tempfile::tempdir().unwrap();
        let id = identity();
        id.cache.configure(dir.path().into());
        let t = target(&server);
        id.vault.set(&t.key, "invented-token").unwrap();
        let state = rt().block_on(id.restore(&t)).unwrap();
        assert_eq!(state.offline_copy.as_deref(), Some(MARKER));
        assert_eq!(serde_json::to_value(state).unwrap()["offlineCopy"], MARKER);
        assert!(id.guard_grainatlas(&format!("{server}/")).is_err());
        assert!(id.guard_grainatlas("https://other.invalid").is_ok());
        let page = "tauri://localhost/modules/grainatlas/index.html"
            .parse()
            .unwrap();
        assert!(may_receive_token(&page, &server));
        assert_eq!(id.current_token().as_deref(), Some("invented-token"));
        let page = "tauri://localhost/app/index.html".parse().unwrap();
        assert!(may_receive_token(&page, &server));
        let reply = rt().block_on(id.get(&t, "/v1/accounts/me")).unwrap();
        assert_eq!(reply.offline_copy.as_deref(), Some(MARKER));
        assert!(reply.cached.is_some());
        assert_eq!(serde_json::to_value(reply).unwrap()["offlineCopy"], MARKER);
        // A fresh process restores the copy marker for the standalone launch guard.
        let fresh = identity();
        fresh.cache.configure(dir.path().into());
        fresh.vault.set(&t.key, "invented-token").unwrap();
        assert_eq!(
            rt().block_on(fresh.restore(&t))
                .unwrap()
                .offline_copy
                .as_deref(),
            Some(MARKER)
        );
        assert!(fresh.guard_grainatlas(&server).is_err());
        assert_eq!(
            clean_offline_copy("  a\tb\u{7f}c  ").as_deref(),
            Some("abc")
        );
        assert_eq!(
            clean_offline_copy(&"é".repeat(210))
                .unwrap()
                .chars()
                .count(),
            200
        );
        assert!(serde_json::to_value(ApiReply::from_text(200, "{}", &[]))
            .unwrap()
            .get("offlineCopy")
            .is_none());
    }

    #[test]
    fn offline_copy_get_header_is_saved_and_live_reply_clears_guard() {
        let server = raw_server(|mut stream, _| {
            write!(stream, "HTTP/1.1 200 OK\r\nX-UPbDB-Offline-Copy: invented read-only\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]").unwrap();
        });
        let id = identity();
        let dir = tempfile::tempdir().unwrap();
        id.cache.configure(dir.path().into());
        let t = target(&server);
        id.adopt(
            &t,
            serde_json::json!({"token":"invented", "account":{"id":"one"}}),
        )
        .unwrap();
        assert_eq!(
            rt().block_on(id.get(&t, "/v1/sessions"))
                .unwrap()
                .offline_copy
                .as_deref(),
            Some("invented read-only")
        );
        assert!(id
            .cache
            .load(&t, "/v1/sessions")
            .unwrap()
            .offline_copy
            .is_some());
        id.remember_copy(&t, None);
        assert!(id.guard_grainatlas(&server).is_ok());
    }

    #[test]
    fn non_json_reply_keeps_status_and_a_short_excerpt() {
        let reply = ApiReply::from_text(502, "<html>\n  Bad gateway\t Try later. </html>", &[]);
        assert_eq!(reply.status, 502);
        assert_eq!(reply.body, Value::Null);
        assert_eq!(
            reply.error.as_deref(),
            Some("Server returned 502: <html> Bad gateway Try later. </html>")
        );
        assert_eq!(
            serde_json::to_value(&reply).unwrap()["error"],
            reply.error.unwrap()
        );
        assert_eq!(
            reply_excerpt(&"é".repeat(201), &[]),
            format!("{}…", "é".repeat(200))
        );
        assert!(ApiReply::from_text(200, "not JSON", &[]).error.is_some());
        assert_eq!(
            ApiReply::from_text(204, "", &[]).message(),
            "Server returned 204: Empty reply; expected JSON."
        );
        assert!(ApiReply::from_text(200, "null", &[]).error.is_none());
    }

    #[test]
    fn non_json_api_response_reaches_the_page() {
        let server = fake_server(1, |_, _, _| {
            (502, "<html>\n  Bad gateway\t Try later. </html>".into())
        });
        let reply = rt()
            .block_on(identity().get(&target(&server), "/v1/mounts/demo/results"))
            .unwrap();
        assert_eq!(reply.status, 502);
        assert_eq!(reply.body, Value::Null);
        assert_eq!(
            reply.error.as_deref(),
            Some("Server returned 502: <html> Bad gateway Try later. </html>")
        );
        assert_eq!(
            serde_json::to_value(&reply).unwrap()["error"],
            reply.error.unwrap()
        );
    }

    #[test]
    fn excerpts_omit_credentials() {
        for text in [
            "Bearer demo-credential",
            "token=demo-credential",
            "password: invented",
            "code=one-use",
        ] {
            assert_eq!(
                reply_excerpt(text, &[]),
                "[reply omitted because it may contain credentials]"
            );
        }
        assert_eq!(
            reply_excerpt(
                "Request echoed demo-credential",
                &["demo-credential".into()]
            ),
            "[reply omitted because it may contain credentials]"
        );
    }

    #[test]
    fn non_json_response_omits_the_request_token() {
        let server = fake_server(1, |_, _, _| (502, "Request echoed demo-credential".into()));
        let id = identity();
        let t = target(&server);
        id.vault.set(&t.key, "demo-credential").unwrap();
        let reply = rt().block_on(id.get(&t, "/v1/mounts")).unwrap();
        assert!(!reply.message().contains("demo-credential"));
    }

    #[test]
    fn body_read_error_wording_keeps_context_without_url_credentials() {
        let url = "https://user:password@lab.example:8443/v1/results?token=hidden#fragment"
            .parse()
            .unwrap();
        assert_eq!(
            format_body_read_error(&url, Duration::from_secs(30), 200, Some(919000), "timed out"),
            "Reading the reply from lab.example:8443/v1/results failed after 30.0 s: timed out (status 200, 919000 bytes expected)"
        );
        assert_eq!(
            format_body_read_error(&url, Duration::from_millis(1500), 502, None, "connection closed"),
            "Reading the reply from lab.example:8443/v1/results failed after 1.5 s: connection closed (status 502)"
        );
    }

    #[test]
    fn body_read_timeout_reports_location_elapsed_status_and_size() {
        let server = raw_server(|mut stream, _| {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 919000\r\n\r\n{")
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let mut id = identity();
        id.http = reqwest::Client::builder()
            .read_timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let err = rt()
            .block_on(id.get(&target(&server), "/v1/mounts/demo/results?token=hidden"))
            .unwrap_err();
        assert!(
            err.starts_with(&format!(
                "Reading the reply from {}/v1/mounts/demo/results failed after ",
                server.trim_start_matches("http://")
            )),
            "{err}"
        );
        assert!(
            err.contains(" s: timed out (status 200, 919000 bytes expected)"),
            "{err}"
        );
        assert!(!err.contains("decoding response body"));
        assert!(!err.contains("hidden"));
        assert!(!err.contains("server unreachable"));
    }

    #[test]
    fn closed_body_reports_the_connection_and_handles_unknown_length() {
        let server = raw_server(|mut stream, _| {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{")
                .unwrap();
        });
        let err = rt()
            .block_on(identity().get(&target(&server), "/v1/results"))
            .unwrap_err();
        assert!(err.contains("connection closed (status 200)"), "{err}");
    }

    #[test]
    fn progressing_body_can_take_longer_than_the_read_timeout() {
        let server = raw_server(|mut stream, _| {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n")
                .unwrap();
            for byte in b"[1,2,3] " {
                stream.write_all(&[*byte]).unwrap();
                stream.flush().unwrap();
                thread::sleep(Duration::from_millis(50));
            }
        });
        let mut id = identity();
        id.http = reqwest::Client::builder()
            .read_timeout(Duration::from_millis(200))
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let started = Instant::now();
        let reply = rt()
            .block_on(id.get(&target(&server), "/v1/results"))
            .unwrap();
        assert!(started.elapsed() > Duration::from_millis(200));
        assert_eq!(reply.body, serde_json::json!([1, 2, 3]));
    }

    #[test]
    fn login_stores_the_token_and_hands_it_out() {
        let server = fake_server(1, |first, _, body| {
            assert!(first.starts_with("POST /v1/auth/login "), "{first}");
            assert!(body.contains("\"username\":\"analyst\""));
            (
                200,
                r#"{"token":"tok-1","account":{"username":"analyst","display_name":"Analyst"}}"#
                    .into(),
            )
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
        let server = fake_server(1, |_, _, _| {
            (401, r#"{"detail":"Invalid username or password"}"#.into())
        });
        let err = rt()
            .block_on(identity().login(&target(&server), "x", "y"))
            .unwrap_err();
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
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
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
            (
                200,
                r#"{"code":"abc123","expires_at":"2026-11-03T12:05:00Z"}"#.into(),
            )
        });
        let id = identity();
        let t = target(&server);
        id.vault.set(&t.key, "tok").unwrap();
        assert_eq!(rt().block_on(id.handoff(&t)).unwrap(), "abc123");
    }

    #[test]
    fn handoff_needs_a_sign_in() {
        let err = rt()
            .block_on(identity().handoff(&target("http://127.0.0.1:9")))
            .unwrap_err();
        assert!(err.contains("not signed in"));
    }

    #[test]
    fn api_get_keeps_query_and_server_prefix() {
        let server = fake_server(1, |first, _, _| {
            assert!(
                first.starts_with("GET /lab/v1/sessions?material=zircon "),
                "{first}"
            );
            (200, "[]".into())
        });
        let t = target(&format!("{server}/lab"));
        let r = rt()
            .block_on(identity().get(&t, "/v1/sessions?material=zircon"))
            .unwrap();
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
        assert!(may_receive_token(
            &"tauri://localhost/modules/grainatlas/index.html"
                .parse()
                .unwrap(),
            server
        ));
        assert!(may_receive_token(
            &"http://tauri.localhost/modules/grainatlas/index.html"
                .parse()
                .unwrap(),
            server
        ));
        assert!(may_receive_token(
            &"http://127.0.0.1:8000/app/#/sessions".parse().unwrap(),
            server
        ));
        assert!(!may_receive_token(
            &"http://127.0.0.1:8001/app/".parse().unwrap(),
            server
        ));
        assert!(!may_receive_token(
            &"https://example.com/".parse().unwrap(),
            server
        ));
    }

    /// Against a real UPbDB with the demo data, and the real OS keychain:
    /// `UPBSTUDIO_LIVE_SERVER=http://127.0.0.1:8017 cargo test live_ -- --ignored`
    /// (user analyst / upbdb-demo unless UPBSTUDIO_LIVE_USER / _PASSWORD say otherwise).
    #[test]
    #[ignore]
    fn live_sign_in_handoff_and_keychain() {
        let Ok(server) = std::env::var("UPBSTUDIO_LIVE_SERVER") else {
            return;
        };
        let user = std::env::var("UPBSTUDIO_LIVE_USER").unwrap_or_else(|_| "analyst".into());
        let pw = std::env::var("UPBSTUDIO_LIVE_PASSWORD").unwrap_or_else(|_| "upbdb-demo".into());
        let id = Identity::with_vault(Box::new(KeychainVault));
        let t = Target {
            server: server.clone(),
            key: format!("{server} (upbstudio live test)"),
        };
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
        let runs = rt
            .block_on(fresh.get(&t, &format!("/v1/sessions/{first}/reductions")))
            .unwrap();
        assert_eq!(runs.status, 200);
        let mounts = rt.block_on(fresh.get(&t, "/v1/mounts")).unwrap();
        assert_eq!(mounts.status, 200);
        if let Some(m) = mounts.body.get(0).and_then(|m| m["id"].as_str()) {
            let atlas = rt
                .block_on(fresh.get(&t, &format!("/v1/mounts/{m}/atlas")))
                .unwrap();
            eprintln!("GET /v1/mounts/{m}/atlas -> {}", atlas.status);
        }
        // The handoff code is what Studio exchanges for its own token.
        let code = rt.block_on(fresh.handoff(&t)).unwrap();
        let studio = Identity::with_vault(Box::new(MemoryVault::default()));
        let st = Target {
            server: server.clone(),
            key: "studio".into(),
        };
        let ex = rt.block_on(studio.exchange(&st, &code)).unwrap();
        assert_eq!(ex.account.unwrap()["username"], user.as_str());
        assert!(
            rt.block_on(studio.exchange(&st, &code)).is_err(),
            "a handoff code is single-use"
        );
        rt.block_on(studio.logout(&st)).unwrap();
        // Sign-out revokes the token on the server and clears the keychain entry.
        let token = KeychainVault.get(&t.key).unwrap().unwrap();
        rt.block_on(fresh.logout(&t)).unwrap();
        assert_eq!(KeychainVault.get(&t.key).unwrap(), None);
        let other = Identity::with_vault(Box::new(MemoryVault::default()));
        other.vault.set(&t.key, &token).unwrap();
        let after = rt.block_on(other.restore(&t)).unwrap();
        assert!(!after.signed_in, "revoked token must be refused: {after:?}");
        eprintln!(
            "live: signed in as {user}, {} sessions, handoff exchanged once, signed out",
            sessions.body.as_array().unwrap().len()
        );
    }

    #[test]
    fn targets_are_checked() {
        assert!(Target {
            server: "file:///x".into(),
            key: "k".into()
        }
        .base()
        .is_err());
        assert!(Target {
            server: "http://x".into(),
            key: "".into()
        }
        .base()
        .is_err());
        let t = Target {
            server: "http://h:1/p/".into(),
            key: "k".into(),
        };
        assert_eq!(t.endpoint("/v1/x").unwrap().as_str(), "http://h:1/p/v1/x");
    }
    #[test]
    fn write_idempotency_header_is_optional_and_validated_before_network() {
        let id = identity();
        let t = target("https://invented.invalid");
        id.adopt(
            &t,
            serde_json::json!({"token": "invented", "account": {"username": "synthetic"}}),
        )
        .unwrap();
        for key in [None, Some("synthetic-key-1")] {
            let req = id
                .write_request(
                    &t,
                    "/v1/fractions/demo",
                    "PATCH",
                    &serde_json::json!({}),
                    false,
                    key,
                )
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(
                req.headers()
                    .get("Idempotency-Key")
                    .map(|h| h.to_str().unwrap()),
                key
            );
        }
        for key in [
            "".to_string(),
            "a b".into(),
            "a\t".into(),
            "a\n".into(),
            "é".into(),
            "x".repeat(256),
        ] {
            let error = rt()
                .block_on(id.write(
                    &t,
                    "/v1/fractions/demo",
                    "PATCH",
                    serde_json::json!({}),
                    false,
                    Some(key),
                ))
                .unwrap_err();
            assert!(error.starts_with("Idempotency-Key"));
        }
    }

    #[test]
    fn writes_refuse_view_as_queries_and_unrecognized_methods_before_sending() {
        let id = identity();
        let t = target("https://invented.invalid");
        for path in [
            "/v1/samples/demo?as=cedar",
            "/v1/samples/demo?%61s=cedar",
            "/v1/samples/demo?as=",
            "/outside",
        ] {
            assert!(rt()
                .block_on(id.write(&t, path, "PATCH", serde_json::json!({}), false, None))
                .is_err());
        }
        assert!(rt()
            .block_on(id.write(
                &t,
                "/v1/samples/demo",
                "GET",
                serde_json::json!({}),
                true,
                None
            ))
            .is_err());
    }
}
